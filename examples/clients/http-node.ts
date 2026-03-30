/**
 * Practical HTTP consumer demo for local-browser-bridge.
 *
 * This models a generic local client integration:
 * 1) fetch stable capabilities
 * 2) fetch browser diagnostics for the selected path
 * 3) choose an explicit route: safari | chrome-direct | chrome-relay
 * 4) attach or resume
 * 5) render user-facing messaging from kind + attach.mode + semantics + diagnostics
 *
 * Copy-paste run:
 *   terminal 1 -> npm run serve
 *   terminal 2 -> npx tsx examples/clients/http-node.ts safari
 *   terminal 2 -> npx tsx examples/clients/http-node.ts chrome-direct
 *   terminal 2 -> npx tsx examples/clients/http-node.ts chrome-relay
 *
 * Optional:
 *   LOCAL_BROWSER_BRIDGE_SESSION_ID=<session-id> npx tsx examples/clients/http-node.ts chrome-relay
 *
 * Notes:
 * - Safari is the actionable path.
 * - Chrome direct is read-only.
 * - Chrome relay is read-only and shared-tab scoped.
 * - Stable labels in this demo remain: "Safari (actionable)", "Chrome (direct, read-only)", and "Chrome (shared tab, read-only)".
 * - Example documented prompts include "Chrome direct attach needs a local DevTools endpoint..." and "Chrome relay only works for a tab you explicitly share...".
 * - This demo does not silently fall back between Chrome direct and relay.
 * - Relay behavior is derived from the returned contract fields, not from consumer-specific assumptions.
 */

const {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession
} = require("../../dist/src") as typeof import("../../src");

type RouteName = "safari" | "chrome-direct" | "chrome-relay";
type SessionKind = "safari-actionable" | "chrome-readonly";
type BrowserName = "safari" | "chrome";
type AttachMode = "direct" | "relay";
type ReadinessState = "ready" | "degraded" | "attention-required" | "unavailable";

type BrowserCapability = {
  browser: BrowserName;
  kind: SessionKind;
  operations: {
    attach: boolean;
    diagnostics: boolean;
    resumeSession: boolean;
    activate: boolean;
    navigate: boolean;
    screenshot: boolean;
  };
};

type CapabilitiesPayload = {
  capabilities: {
    schemaVersion: number;
    browsers: BrowserCapability[];
  };
};

type ReadinessBlocker = {
  code: string;
  message: string;
};

type BrowserDiagnostics = {
  browser: BrowserName;
  checkedAt: string;
  preflight?: {
    inspect: { ready: boolean; blockers: ReadinessBlocker[] };
    automation: { ready: boolean; blockers: ReadinessBlocker[] };
    screenshot: { ready: boolean; blockers: ReadinessBlocker[] };
  };
  attach?: {
    direct: {
      mode: "direct";
      ready: boolean;
      state: ReadinessState;
      blockers: ReadinessBlocker[];
    };
    relay: {
      mode: "relay";
      ready: boolean;
      state: ReadinessState;
      blockers: ReadinessBlocker[];
    };
  };
};

type DiagnosticsPayload = {
  diagnostics: BrowserDiagnostics;
};

type BridgeSession = {
  id: string;
  schemaVersion: number;
  browser: BrowserName;
  kind: SessionKind;
  attach: {
    mode: AttachMode;
    scope: "browser" | "tab";
    resumable?: boolean;
    expiresAt?: string;
    resumeRequiresUserGesture?: boolean;
  };
  semantics: {
    inspect: "browser-tabs" | "shared-tab-only";
    resume: "saved-browser-target" | "current-shared-tab";
    tabReference: {
      windowIndex: "browser-position" | "synthetic-shared-tab-position";
      tabIndex: "browser-position" | "synthetic-shared-tab-position";
    };
    notes?: string[];
  };
  capabilities: {
    resume: boolean;
    activate: boolean;
    navigate: boolean;
    screenshot: boolean;
  };
  status: {
    state: string;
    canAct: boolean;
  };
};

type SessionPayload = {
  session: BridgeSession;
};

type ResumedSessionPayload = {
  resumedSession: {
    session: BridgeSession;
  };
};

type BridgeErrorPayload = {
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: {
      context?: {
        browser?: BrowserName;
        attachMode?: AttachMode;
        operation?: "attach" | "resumeSession";
      };
      relay?: {
        branch?:
          | "click-toolbar-button"
          | "share-tab"
          | "share-original-tab-again"
          | "use-current-shared-tab"
          | "install-extension"
          | "reconnect-extension"
          | "configure-relay-probe"
          | "repair-relay-probe"
          | "unsupported";
        retryable?: boolean;
        userActionRequired?: boolean;
        phase?: "diagnostics" | "target-selection" | "session-precondition" | "shared-tab-match";
        sharedTabScope?: "current-shared-tab";
        currentSharedTabMatches?: boolean;
        resumable?: boolean;
        resumeRequiresUserGesture?: boolean;
        expiresAt?: string;
        sessionId?: string;
      };
    };
  };
};

type ConsumerRoute = {
  name: RouteName;
  browser: BrowserName;
  attachMode: AttachMode;
  label: string;
  expectedKind: SessionKind;
  readiness: {
    ready: boolean;
    state: ReadinessState | "ready";
    blockers: ReadinessBlocker[];
  };
  prompt?: string;
};

const baseUrl = process.env.LOCAL_BROWSER_BRIDGE_URL ?? "http://127.0.0.1:3000";
const requestedRoute = normalizeRoute(process.argv[2] ?? "safari");
const resumeSessionId = process.env.LOCAL_BROWSER_BRIDGE_SESSION_ID;

class BridgeHttpError extends Error {
  readonly payload: BridgeErrorPayload;

  constructor(payload: BridgeErrorPayload) {
    super(payload.error.message);
    this.name = "BridgeHttpError";
    this.payload = payload;
  }
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = (await response.json()) as BridgeErrorPayload;
    throw new BridgeHttpError(payload);
  }

  return (await response.json()) as T;
}

function normalizeRoute(value: string): RouteName {
  if (value === "safari" || value === "chrome-direct" || value === "chrome-relay") {
    return value;
  }

  throw new Error("Usage: npx tsx examples/clients/http-node.ts safari|chrome-direct|chrome-relay");
}

function assertSchemaVersion(schemaVersion: number): void {
  if (schemaVersion !== 1) {
    throw new Error(`Unsupported local-browser-bridge schemaVersion: ${schemaVersion}`);
  }
}

function findBrowserCapability(capabilities: CapabilitiesPayload["capabilities"], browser: BrowserName): BrowserCapability {
  const browserCapability = capabilities.browsers.find((entry) => entry.browser === browser);
  if (!browserCapability) {
    throw new Error(`Browser not advertised by the bridge: ${browser}`);
  }
  return browserCapability;
}

function firstBlockerPrompt(blockers: ReadinessBlocker[]): string | undefined {
  return blockers[0]?.message;
}

function buildRoute(
  routeName: RouteName,
  browserCapability: BrowserCapability,
  diagnostics: BrowserDiagnostics
): ConsumerRoute {
  const browser = routeName === "safari" ? "safari" : "chrome";
  const attachMode = routeName === "chrome-relay" ? "relay" : "direct";
  const ux = interpretBrowserAttachUxFromDiagnostics({
    browser,
    attachMode,
    diagnostics
  });

  if (routeName === "safari") {
    return {
      name: routeName,
      browser: "safari",
      attachMode: "direct",
      label: ux.label,
      expectedKind: "safari-actionable",
      readiness: {
        ready: Boolean(diagnostics.preflight?.inspect.ready && diagnostics.preflight?.automation.ready),
        state: diagnostics.preflight?.inspect.ready && diagnostics.preflight?.automation.ready ? "ready" : "unavailable",
        blockers: [...(diagnostics.preflight?.inspect.blockers ?? []), ...(diagnostics.preflight?.automation.blockers ?? [])]
      },
      prompt: ux.prompt ?? firstBlockerPrompt([
        ...(diagnostics.preflight?.inspect.blockers ?? []),
        ...(diagnostics.preflight?.automation.blockers ?? []),
        ...(diagnostics.preflight?.screenshot.blockers ?? [])
      ])
    };
  }

  if (routeName === "chrome-direct") {
    return {
      name: routeName,
      browser: "chrome",
      attachMode: "direct",
      label: ux.label,
      expectedKind: browserCapability.kind,
      readiness: {
        ready: Boolean(diagnostics.attach?.direct.ready),
        state: diagnostics.attach?.direct.state ?? "unavailable",
        blockers: diagnostics.attach?.direct.blockers ?? []
      },
      prompt: ux.prompt ?? firstBlockerPrompt(diagnostics.attach?.direct.blockers ?? [])
    };
  }

  return {
    name: routeName,
    browser: "chrome",
    attachMode: "relay",
    label: ux.label,
    expectedKind: browserCapability.kind,
    readiness: {
      ready: Boolean(diagnostics.attach?.relay.ready),
      state: diagnostics.attach?.relay.state ?? "unavailable",
      blockers: diagnostics.attach?.relay.blockers ?? []
    },
    prompt: ux.prompt ?? firstBlockerPrompt(diagnostics.attach?.relay.blockers ?? [])
  };
}

function describeCapabilities(browserCapability: BrowserCapability): string {
  return [
    `kind=${browserCapability.kind}`,
    `attach=${browserCapability.operations.attach}`,
    `resume=${browserCapability.operations.resumeSession}`,
    `activate=${browserCapability.operations.activate}`,
    `navigate=${browserCapability.operations.navigate}`,
    `screenshot=${browserCapability.operations.screenshot}`
  ].join(", ");
}

function describeSession(session: BridgeSession, operation: "attach" | "resumeSession"): void {
  const ux = interpretBrowserAttachUxFromSession({ session, operation });
  console.log(`Attached session ${session.id}`);
  console.log(`Session kind: ${session.kind}`);
  console.log(`Session attach mode: ${session.attach.mode}`);
  console.log(`Session state: ${session.status.state}`);
  console.log(`Flow state: ${ux.state}`);

  switch (session.kind) {
    case "safari-actionable":
      console.log(`User-facing label: ${ux.label}`);
      console.log("Show activate/navigate/screenshot only when the exact session capability bit is true.");
      console.log(
        `Runtime actions: activate=${session.capabilities.activate}, navigate=${session.capabilities.navigate}, screenshot=${session.capabilities.screenshot}`
      );
      break;
    case "chrome-readonly":
      if (session.attach.mode === "direct") {
        console.log(`User-facing label: ${ux.label}`);
        console.log("Show inspect/resume UI only. Hide activate/navigate/screenshot.");
      } else {
        console.log(`User-facing label: ${ux.label}`);
        console.log("Describe this as a shared-tab session, not a browser-wide Chrome session.");
        console.log("Derive relay behavior from attach.mode=relay plus the returned semantics fields.");
        console.log(`Inspect semantics: ${session.semantics.inspect}`);
        console.log("After resume, trust the returned session metadata for the current shared-tab grant.");
        console.log(`Resume semantics: ${session.semantics.resume}`);
        console.log(
          `Tab reference semantics: windowIndex=${session.semantics.tabReference.windowIndex}, tabIndex=${session.semantics.tabReference.tabIndex}`
        );
        if (ux.scopeNote) {
          console.log(ux.scopeNote);
        }
        if (ux.prompt) {
          console.log(`Resume prompt: ${ux.prompt}`);
        }
      }
      break;
    default: {
      const unexpectedKind: never = session.kind;
      throw new Error(`Unhandled session kind: ${unexpectedKind}`);
    }
  }
}

async function attachOrResume(route: ConsumerRoute): Promise<BridgeSession> {
  if (resumeSessionId) {
    console.log(`Resuming saved session ${resumeSessionId} for ${route.label}`);
    const resumed = await readJson<ResumedSessionPayload>(`/v1/sessions/${encodeURIComponent(resumeSessionId)}/resume`, {
      method: "POST"
    });
    return resumed.resumedSession.session;
  }

  console.log(`Attaching via ${route.label}`);
  const attached = await readJson<SessionPayload>("/v1/attach", {
    method: "POST",
    body: JSON.stringify({
      browser: route.browser,
      attach: { mode: route.attachMode }
    })
  });
  return attached.session;
}

async function main(): Promise<void> {
  const capabilitiesPayload = await readJson<CapabilitiesPayload>("/v1/capabilities");
  assertSchemaVersion(capabilitiesPayload.capabilities.schemaVersion);

  const selectedBrowser = requestedRoute === "safari" ? "safari" : "chrome";
  const browserCapability = findBrowserCapability(capabilitiesPayload.capabilities, selectedBrowser);
  const diagnosticsPayload = await readJson<DiagnosticsPayload>(
    `/v1/diagnostics?browser=${encodeURIComponent(selectedBrowser)}`
  );

  const route = buildRoute(requestedRoute, browserCapability, diagnosticsPayload.diagnostics);

  console.log(`Requested route: ${route.name}`);
  console.log(`Capabilities: ${describeCapabilities(browserCapability)}`);
  console.log(`Selected path: ${route.label}`);
  console.log(`Diagnostics readiness: state=${route.readiness.state}, ready=${route.readiness.ready}`);

  if (route.prompt) {
    console.log(`User prompt: ${route.prompt}`);
  }

  if (browserCapability.kind !== route.expectedKind) {
    throw new Error(`Route ${route.name} expected ${route.expectedKind}, got ${browserCapability.kind}`);
  }

  if (!route.readiness.ready) {
    console.log("Attach skipped because the selected path is not ready.");
    return;
  }

  const operation = resumeSessionId ? "resumeSession" : "attach";
  const session = await attachOrResume(route);
  assertSchemaVersion(session.schemaVersion);
  describeSession(session, operation);
}

main().catch((error: unknown) => {
  if (error instanceof BridgeHttpError) {
    const bridgeError = error.payload.error;
    const relay = bridgeError.details?.relay;
    const ux = interpretBrowserAttachUxFromError({ details: bridgeError.details });
    if (relay?.branch) {
      console.error(`Relay failure branch: ${relay.branch}`);
    }
    if (relay?.phase) {
      console.error(`Relay failure phase: ${relay.phase}`);
    }
    if (ux?.state) {
      console.error(`Relay UX state: ${ux.state}`);
    }
    if (ux?.relayFailureCategory) {
      console.error(`Relay failure category: ${ux.relayFailureCategory}`);
    }
    if (typeof ux?.userActionRequired === "boolean") {
      console.error(`Relay failure user action required: ${ux.userActionRequired}`);
    }
    if (typeof ux?.retryable === "boolean") {
      console.error(`Relay failure retryable: ${ux.retryable}`);
    }
    if (ux?.retryGuidance) {
      console.error(ux.retryGuidance);
    }
    if (ux?.scopeNote) {
      console.error(ux.scopeNote);
    }
    if (ux?.prompt) {
      console.error(`Relay user prompt: ${ux.prompt}`);
    }
    console.error(bridgeError.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
