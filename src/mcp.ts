import { createInterface } from "node:readline";
import { connectConnectionRoute, doctorConnectionRoute, normalizeConnectionRouteName, type ConnectionRouteName } from "./connection-ux";
import { AppError, toErrorPayload } from "./errors";
import { AttachService } from "./service/attach-service";
import type { AttachmentSession, BrowserAttachMode, BrowserDiagnostics, SupportedBrowser } from "./types";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_NAME = "local-browser-bridge";

type SupportedProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];
type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

interface RuntimeTruth {
  actionable: boolean;
  readOnly: boolean;
  sharedTabScoped: boolean;
  runtimeActions: {
    activate: boolean;
    navigate: boolean;
    screenshot: boolean;
  };
  unsupportedRuntimeActions: Array<"activate" | "navigate" | "screenshot">;
  notes: string[];
}

type McpOutcome = "success" | "blocked" | "unsupported" | "error";

interface McpReason {
  code: string;
  message: string;
  retryable?: boolean;
  userActionRequired?: boolean;
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === "object" && value !== null && (value as { jsonrpc?: unknown }).jsonrpc === "2.0"
    && typeof (value as { method?: unknown }).method === "string";
}

function negotiateProtocolVersion(requested: unknown): SupportedProtocolVersion {
  if (typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested as SupportedProtocolVersion)) {
    return requested as SupportedProtocolVersion;
  }

  return SUPPORTED_PROTOCOL_VERSIONS[0];
}

function writeMessage(output: NodeJS.WritableStream, payload: unknown): void {
  output.write(JSON.stringify(payload) + "\n");
}

function parseRouteArguments(args: Record<string, unknown> | undefined): { route: ConnectionRouteName; sessionId?: string } {
  const route = normalizeConnectionRouteName(typeof args?.route === "string" ? args.route : undefined);
  const sessionId = typeof args?.sessionId === "string" && args.sessionId.trim() ? args.sessionId.trim() : undefined;

  return sessionId ? { route, sessionId } : { route };
}

function routeDescriptor(route: ConnectionRouteName): { browser: SupportedBrowser; attachMode: BrowserAttachMode } {
  if (route === "safari") {
    return { browser: "safari", attachMode: "direct" };
  }

  return {
    browser: "chrome",
    attachMode: route === "chrome-relay" ? "relay" : "direct"
  };
}

function routeTruth(route: { browser: "safari" | "chrome"; attachMode: BrowserAttachMode }, session?: AttachmentSession): RuntimeTruth {
  const runtimeActions = session
    ? {
        activate: session.capabilities.activate,
        navigate: session.capabilities.navigate,
        screenshot: session.capabilities.screenshot
      }
    : route.browser === "safari"
      ? { activate: true, navigate: true, screenshot: true }
      : { activate: false, navigate: false, screenshot: false };
  const unsupportedRuntimeActions = (Object.entries(runtimeActions) as Array<[keyof typeof runtimeActions, boolean]>)
    .filter(([, supported]) => !supported)
    .map(([name]) => name);
  const readOnly = session ? session.status.state === "read-only" : route.browser === "chrome";
  const sharedTabScoped = session
    ? session.browser === "chrome" && session.attach.mode === "relay"
    : route.browser === "chrome" && route.attachMode === "relay";
  const actionable = session ? session.status.canAct : route.browser === "safari";
  const notes = route.browser === "safari"
    ? ["Safari is actionable in this product surface."]
    : sharedTabScoped
      ? [
          "Chrome relay remains read-only in this phase.",
          "Chrome relay only covers the currently shared tab."
        ]
      : ["Chrome direct remains read-only in this phase."];

  return {
    actionable,
    readOnly,
    sharedTabScoped,
    runtimeActions,
    unsupportedRuntimeActions,
    notes
  };
}

function toolText(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function toolResult(payload: Record<string, unknown>, isError = false): McpToolCallResult {
  return {
    content: [{ type: "text", text: toolText(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {})
  };
}

function errorToolResult(code: string, message: string, details?: unknown): McpToolCallResult {
  return toolResult(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details })
      }
    },
    true
  );
}

function summarizeTabs(browser: SupportedBrowser, count: number): string {
  const label = browser === "safari" ? "Safari" : "Chrome direct";
  const suffix = count === 1 ? "tab" : "tabs";
  return `Listed ${count} ${label} ${suffix}.`;
}

function browserTabsRelayBlockedResult(): McpToolCallResult {
  const route = routeDescriptor("chrome-relay");
  const reason = {
    code: "shared_tab_scope_only",
    message: "Chrome relay is shared-tab scoped and not browser-wide tab enumeration."
  } satisfies McpReason;
  return toolResult({
    tool: "browser_tabs",
    ok: false,
    blocked: true,
    outcome: "unsupported",
    status: "unsupported",
    category: "shared-tab-scope",
    reason,
    summary: "Chrome relay is shared-tab scoped and does not support browser-wide tab enumeration.",
    prompt: "Use browser_connect for the currently shared tab, or retry browser_tabs with safari or chrome-direct.",
    truth: routeTruth(route),
    supportedRoutes: ["safari", "chrome-direct"],
    blockedReason: reason
  });
}

function invalidParams(message: string, data?: unknown) {
  return {
    code: -32602,
    message,
    ...(data === undefined ? {} : { data })
  };
}

function requestIdOrNull(message: JsonRpcRequest): JsonRpcId {
  return message.id ?? null;
}

function isBrowserConnectFailure(payload: { ok: boolean; connected: boolean }): boolean {
  return !payload.ok || !payload.connected;
}

function firstDiagnosticBlocker(
  diagnostics: BrowserDiagnostics,
  route: { browser: SupportedBrowser; attachMode: BrowserAttachMode }
): { code: string; message: string } | undefined {
  if (route.browser === "safari") {
    return [
      ...(diagnostics.preflight?.inspect.blockers ?? []),
      ...(diagnostics.preflight?.automation.blockers ?? []),
      ...(diagnostics.preflight?.screenshot.blockers ?? [])
    ][0];
  }

  return (route.attachMode === "relay" ? diagnostics.attach?.relay?.blockers : diagnostics.attach?.direct?.blockers)?.[0];
}

function isUnsupportedReasonCode(code: string | undefined): boolean {
  return code === "shared_tab_scope_only"
    || code === "unsupported_action"
    || code === "unsupported_browser"
    || code === "activation_unavailable"
    || code === "navigation_unavailable"
    || code === "screenshot_unavailable"
    || code === "relay_transport_not_implemented";
}

function doctorResultFields(payload: Awaited<ReturnType<typeof doctorConnectionRoute>>): Record<string, unknown> {
  const reason = payload.blocked ? firstDiagnosticBlocker(payload.diagnostics, payload.route) : undefined;

  return {
    outcome: payload.blocked ? "blocked" : "success",
    status: payload.blocked ? "blocked" : "ready",
    category: payload.blocked ? "route-blocked" : "route-ready",
    ...(reason ? { reason } : {})
  };
}

function connectResultFields(payload: Awaited<ReturnType<typeof connectConnectionRoute>>): Record<string, unknown> {
  if (payload.ok && payload.connected) {
    return {
      outcome: "success",
      status: "connected",
      category: "session-connected"
    };
  }

  if (payload.blocked) {
    const reason = firstDiagnosticBlocker(payload.diagnostics, payload.route);
    return {
      outcome: "blocked",
      status: "blocked",
      category: "connection-blocked",
      ...(reason ? { reason } : {})
    };
  }

  const reason = payload.error
    ? {
        code: payload.error.code ?? "unknown_error",
        message: payload.error.message,
        ...(payload.errorUx?.retryable === undefined ? {} : { retryable: payload.errorUx.retryable }),
        ...(payload.errorUx?.userActionRequired === undefined ? {} : { userActionRequired: payload.errorUx.userActionRequired })
      } satisfies McpReason
    : undefined;
  const unsupported = isUnsupportedReasonCode(reason?.code);

  return {
    outcome: unsupported ? "unsupported" : "error",
    status: unsupported ? "unsupported" : "failed",
    category: unsupported ? "connection-unsupported" : "connection-failed",
    ...(reason ? { reason } : {})
  };
}

function tabsSuccessResultFields(): Record<string, unknown> {
  return {
    outcome: "success",
    status: "listed",
    category: "tab-list"
  };
}

function errorResultFields(code: string, message: string, details?: unknown): Record<string, unknown> {
  const unsupported = isUnsupportedReasonCode(code);
  const reason: McpReason = {
    code,
    message
  };

  return {
    outcome: unsupported ? "unsupported" : "error",
    status: unsupported ? "unsupported" : "failed",
    category: unsupported ? "tool-unsupported" : "tool-error",
    reason,
    ...(details === undefined ? {} : { errorDetails: details })
  };
}

export function createMcpServer(
  service: Pick<AttachService, "getCapabilities" | "diagnostics" | "attach" | "resumeSession" | "listTabs"> = new AttachService()
) {
  let initialized = false;
  let protocolVersion: SupportedProtocolVersion = SUPPORTED_PROTOCOL_VERSIONS[0];

  return {
    async handleMessage(message: JsonRpcMessage): Promise<unknown | undefined> {
      if (message.method === "notifications/initialized") {
        initialized = true;
        return undefined;
      }

      if (!isRequest(message)) {
        return undefined;
      }

      if (message.method === "initialize") {
        protocolVersion = negotiateProtocolVersion(message.params?.protocolVersion);
        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          result: {
            protocolVersion,
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: SERVER_NAME,
              version: "0.1.0"
            },
            instructions:
              "Use browser_doctor before browser_connect when route readiness is unclear. browser_tabs is available for Safari and Chrome direct. Chrome relay is read-only, limited to the currently shared tab, and does not support browser-wide tab enumeration."
          }
        };
      }

      if (message.method === "ping") {
        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          result: {}
        };
      }

      if (!initialized) {
        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          error: {
            code: -32002,
            message: "Server not initialized."
          }
        };
      }

      if (message.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          result: {
            tools: [
              {
                name: "browser_doctor",
                title: "Browser Doctor",
                description:
                  "Check whether the requested route is ready before connect. Safari can be actionable. Chrome direct stays read-only. Chrome relay stays read-only and only covers the currently shared tab.",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    route: {
                      type: "string",
                      enum: ["safari", "chrome-direct", "chrome-relay"]
                    },
                    sessionId: {
                      type: "string",
                      description: "Optional saved session ID to check resume readiness instead of a fresh attach."
                    }
                  },
                  required: ["route"]
                }
              },
              {
                name: "browser_tabs",
                title: "Browser Tabs",
                description:
                  "List tabs only for browser-wide safe contexts. Safari and Chrome direct can enumerate tabs. Chrome relay returns a structured blocked result because relay is shared-tab scoped, not browser-wide.",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    route: {
                      type: "string",
                      enum: ["safari", "chrome-direct", "chrome-relay"]
                    }
                  },
                  required: ["route"]
                }
              },
              {
                name: "browser_connect",
                title: "Browser Connect",
                description:
                  "Attach or resume the requested route-first session. Returns explicit read-only, shared-tab scope, and unsupported runtime action metadata.",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    route: {
                      type: "string",
                      enum: ["safari", "chrome-direct", "chrome-relay"]
                    },
                    sessionId: {
                      type: "string",
                      description: "Optional saved session ID to resume."
                    }
                  },
                  required: ["route"]
                }
              }
            ]
          }
        };
      }

      if (message.method !== "tools/call") {
        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          error: {
            code: -32601,
            message: `Method not found: ${message.method}`
          }
        };
      }

      const toolName = typeof message.params?.name === "string" ? message.params.name : undefined;
      const args = typeof message.params?.arguments === "object" && message.params.arguments !== null
        ? message.params.arguments as Record<string, unknown>
        : undefined;

      if (!toolName) {
        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          error: invalidParams("tools/call requires a string params.name.")
        };
      }

      try {
        if (toolName === "browser_doctor") {
          const route = parseRouteArguments(args);
          const payload = await doctorConnectionRoute(service, route);
          return {
            jsonrpc: "2.0",
            id: requestIdOrNull(message),
            result: toolResult({
              tool: "browser_doctor",
              ok: payload.ok,
              blocked: payload.blocked,
              ...doctorResultFields(payload),
              summary: payload.summary,
              prompt: payload.prompt,
              nextStep: payload.nextStep,
              truth: routeTruth(payload.route),
              envelope: payload
            })
          };
        }

        if (toolName === "browser_connect") {
          const route = parseRouteArguments(args);
          const payload = await connectConnectionRoute(service, route);
          return {
            jsonrpc: "2.0",
            id: requestIdOrNull(message),
            result: toolResult(
              {
                tool: "browser_connect",
                ok: payload.ok,
                connected: payload.connected,
                ...connectResultFields(payload),
                summary: payload.summary,
                prompt: payload.prompt,
                nextStep: payload.nextStep,
                truth: routeTruth(payload.route, payload.session),
                envelope: payload
              },
              isBrowserConnectFailure(payload)
            )
          };
        }

        if (toolName === "browser_tabs") {
          const routeName = parseRouteArguments(args).route;
          if (routeName === "chrome-relay") {
            return {
              jsonrpc: "2.0",
              id: requestIdOrNull(message),
              result: browserTabsRelayBlockedResult()
            };
          }

          const route = routeDescriptor(routeName);
          const tabs = await service.listTabs(route.browser);
          return {
            jsonrpc: "2.0",
            id: requestIdOrNull(message),
            result: toolResult({
              tool: "browser_tabs",
              ok: true,
              blocked: false,
              ...tabsSuccessResultFields(),
              summary: summarizeTabs(route.browser, tabs.length),
              truth: routeTruth(route),
              count: tabs.length,
              tabs
            })
          };
        }

        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          error: invalidParams(`Unsupported tool: ${toolName}`)
        };
      } catch (error) {
        const { payload } = toErrorPayload(error);
        return {
          jsonrpc: "2.0",
          id: requestIdOrNull(message),
          result: toolResult(
            {
              ok: false,
              error: {
                code: payload.error.code,
                message: payload.error.message,
                ...(payload.error.details === undefined ? {} : { details: payload.error.details })
              },
              ...errorResultFields(payload.error.code, payload.error.message, payload.error.details)
            },
            true
          )
        };
      }
    }
  };
}

export function runMcpStdioServer(options: {
  service?: Pick<AttachService, "getCapabilities" | "diagnostics" | "attach" | "resumeSession" | "listTabs">;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
} = {}): void {
  const server = createMcpServer(options.service);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;
  const reader = createInterface({ input, crlfDelay: Infinity });
  let chain = Promise.resolve();

  reader.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    chain = chain.then(async () => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isJsonRpcMessage(parsed)) {
          throw new AppError("Message must be a JSON-RPC 2.0 request or notification.", 400, "invalid_request");
        }
        const response = await server.handleMessage(parsed);
        if (response !== undefined) {
          writeMessage(output, response);
        }
      } catch (errorValue) {
        writeMessage(output, {
          jsonrpc: "2.0",
          id: null,
          error:
            errorValue instanceof SyntaxError
              ? {
                  code: -32700,
                  message: "Parse error"
                }
              : errorValue instanceof AppError
                ? invalidParams(errorValue.message, { code: errorValue.code })
                : invalidParams("Invalid JSON-RPC message.")
        });
      }
    }).catch((errorValue) => {
      error.write(`${errorValue instanceof Error ? errorValue.stack ?? errorValue.message : String(errorValue)}\n`);
    });
  });
}

export { SUPPORTED_PROTOCOL_VERSIONS };
