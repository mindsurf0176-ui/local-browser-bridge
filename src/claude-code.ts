import {
  sessionFromBridgeResult,
  type BridgeAdapter,
  type BridgeConnectionResult,
  type BridgeRoute,
  type BridgeSessionResult
} from "./reference-adapter";
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromSession,
  type BrowserAttachUxInterpretation
} from "./browser-attach-ux-helper";
import type { BridgeCapabilitiesContract, BrowserAttachMode, BrowserDiagnostics, SupportedBrowser } from "./types";

export type ClaudeCodeRouteName = "safari" | "chrome-direct" | "chrome-relay";

export interface ClaudeCodeRouteInput {
  route: ClaudeCodeRouteName;
  sessionId?: string;
}

export interface ClaudeCodePreparedRoute<
  TCapabilities = BridgeCapabilitiesContract,
  TResult extends BridgeSessionResult = BridgeSessionResult
> {
  blocked: boolean;
  capabilities: TCapabilities;
  diagnostics: BrowserDiagnostics;
  operation: "attach" | "resumeSession";
  route: BridgeRoute;
  routeUx: BrowserAttachUxInterpretation;
  prompt?: string;
  connection?: BridgeConnectionResult<TCapabilities, TResult>;
}

function toBrowser(route: ClaudeCodeRouteName): SupportedBrowser {
  return route === "safari" ? "safari" : "chrome";
}

function toAttachMode(route: ClaudeCodeRouteName): BrowserAttachMode {
  return route === "chrome-relay" ? "relay" : "direct";
}

export function normalizeClaudeCodeRoute(input: ClaudeCodeRouteInput): BridgeRoute {
  const browser = toBrowser(input.route);
  const attachMode = toAttachMode(input.route);

  return input.sessionId ? { browser, attachMode, sessionId: input.sessionId } : { browser, attachMode };
}

export async function prepareClaudeCodeRoute<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends BridgeSessionResult = BridgeSessionResult
>(
  adapter: BridgeAdapter<TCapabilities, TAttachResult, TResumeResult>,
  input: ClaudeCodeRouteInput
): Promise<ClaudeCodePreparedRoute<TCapabilities, TAttachResult | TResumeResult>> {
  const route = normalizeClaudeCodeRoute(input);
  const capabilities = await adapter.getCapabilities();
  const diagnostics = await adapter.getDiagnostics(route.browser);
  const operation = "sessionId" in route ? "resumeSession" : "attach";
  const routeUx = interpretBrowserAttachUxFromDiagnostics({
    browser: route.browser,
    attachMode: route.attachMode ?? "direct",
    diagnostics,
    operation
  });

  if (routeUx.state === "blocked") {
    return {
      blocked: true,
      capabilities,
      diagnostics,
      operation,
      route,
      routeUx,
      prompt: routeUx.prompt
    };
  }

  const result = "sessionId" in route ? await adapter.resume(route.sessionId) : await adapter.attach(route);
  const session = sessionFromBridgeResult(result);
  const sessionUx = interpretBrowserAttachUxFromSession({
    session,
    operation
  });
  const connection: BridgeConnectionResult<TCapabilities, TAttachResult | TResumeResult> = {
    capabilities,
    diagnostics,
    operation,
    route,
    routeUx,
    result,
    session,
    sessionUx
  };

  return {
    blocked: false,
    capabilities,
    diagnostics,
    operation,
    route,
    routeUx,
    prompt: connection.sessionUx.prompt ?? connection.routeUx.prompt,
    connection
  };
}
