import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  type BrowserAttachUxInterpretation
} from "./browser-attach-ux-helper";
import { normalizeClaudeCodeRoute, prepareClaudeCodeRoute, type ClaudeCodeRouteName } from "./claude-code";
import { AppError, toErrorPayload } from "./errors";
import { createBridgeAdapter } from "./reference-adapter";
import type { AttachService } from "./service/attach-service";
import type {
  AttachmentSession,
  BridgeCapabilitiesContract,
  BrowserAttachMode,
  BrowserDiagnostics,
  ChromeRelayFailureOperation,
  ErrorPayload,
  SupportedBrowser
} from "./types";

export type ConnectionRouteName = ClaudeCodeRouteName;

export interface ConnectionRouteInput {
  route: ConnectionRouteName;
  sessionId?: string;
}

export interface ConnectionNextStep {
  action: "connect" | "fix-blocker" | "session-ready" | "retry" | "review-error";
  prompt: string;
  command?: string;
}

export type ConnectionOutcome = "success" | "blocked" | "unsupported" | "error";

export type ConnectionStatus = "ready" | "connected" | "blocked" | "unsupported" | "failed";

export type ConnectionCategory =
  | "route-ready"
  | "route-blocked"
  | "session-connected"
  | "connection-blocked"
  | "connection-unsupported"
  | "connection-failed";

export interface ConnectionReason {
  code: string;
  message: string;
  retryable?: boolean;
  userActionRequired?: boolean;
}

interface ConnectionRouteDescriptor {
  name: ConnectionRouteName;
  browser: SupportedBrowser;
  attachMode: BrowserAttachMode;
  sessionId?: string;
}

interface ConnectionEnvelopeBase {
  ok: boolean;
  command: "doctor" | "connect";
  route: ConnectionRouteDescriptor;
  operation: ChromeRelayFailureOperation;
  outcome: ConnectionOutcome;
  status: ConnectionStatus;
  category: ConnectionCategory;
  reason?: ConnectionReason;
  summary: string;
  prompt?: string;
  nextStep: ConnectionNextStep;
  capabilities: BridgeCapabilitiesContract;
  diagnostics: BrowserDiagnostics;
  routeUx: BrowserAttachUxInterpretation;
}

export interface ConnectionDoctorEnvelope extends ConnectionEnvelopeBase {
  blocked: boolean;
}

export interface ConnectionConnectEnvelope extends ConnectionEnvelopeBase {
  blocked: boolean;
  connected: boolean;
  session?: AttachmentSession;
  sessionUx?: BrowserAttachUxInterpretation;
  error?: ErrorPayload["error"];
  errorUx?: BrowserAttachUxInterpretation;
}

type ServiceBridgeAdapter = ReturnType<typeof createServiceBridgeAdapter>;

export function normalizeConnectionRouteName(value: string | undefined): ConnectionRouteName {
  if (value === "safari" || value === "chrome-direct" || value === "chrome-relay") {
    return value;
  }

  throw new AppError("--route must be safari, chrome-direct, or chrome-relay.", 400, "invalid_route");
}

export function createServiceBridgeAdapter(
  service: Pick<AttachService, "getCapabilities" | "diagnostics" | "attach" | "resumeSession">
) {
  return createBridgeAdapter({
    async getCapabilities() {
      return service.getCapabilities();
    },
    async getDiagnostics(browser) {
      return service.diagnostics(browser);
    },
    async attach(route) {
      return service.attach(route.browser, {
        attach: route.attachMode ? { mode: route.attachMode } : undefined
      });
    },
    async resume(sessionId) {
      return service.resumeSession(sessionId);
    }
  });
}

function toDescriptor(input: ConnectionRouteInput): ConnectionRouteDescriptor {
  const route = normalizeClaudeCodeRoute(input);
  return {
    name: input.route,
    browser: route.browser,
    attachMode: route.attachMode ?? "direct",
    ...(input.sessionId ? { sessionId: input.sessionId } : {})
  };
}

function connectCommand(input: ConnectionRouteInput): string {
  return input.sessionId
    ? `local-browser-bridge connect --route ${input.route} --session-id ${input.sessionId}`
    : `local-browser-bridge connect --route ${input.route}`;
}

function routeTruthNote(routeUx: Pick<BrowserAttachUxInterpretation, "readOnly" | "sharedTabScoped">): string {
  if (routeUx.sharedTabScoped) {
    return " It remains read-only and only covers the currently shared tab.";
  }

  if (routeUx.readOnly) {
    return " It remains read-only.";
  }

  return " It is actionable.";
}

function summarizeDoctor(routeUx: BrowserAttachUxInterpretation): string {
  if (routeUx.state === "blocked") {
    return `${routeUx.label} is not ready yet.${routeTruthNote(routeUx)}`;
  }

  return `${routeUx.label} is ready for ${routeUx.operation === "resumeSession" ? "resume" : "attach"}.${routeTruthNote(routeUx)}`;
}

function summarizeSession(session: AttachmentSession, sessionUx: BrowserAttachUxInterpretation): string {
  const verb = sessionUx.operation === "resumeSession" ? "Resumed" : "Connected";
  return `${verb} ${sessionUx.label} session ${session.id}.${routeTruthNote(sessionUx)}`;
}

function summarizeFailure(routeUx: BrowserAttachUxInterpretation | undefined, error: ErrorPayload["error"]): string {
  if (!routeUx) {
    return `Connection failed: ${error.message}`;
  }

  return `${routeUx.label} could not connect.${routeTruthNote(routeUx)}`;
}

function nextStepForDoctor(input: ConnectionRouteInput, routeUx: BrowserAttachUxInterpretation): ConnectionNextStep {
  if (routeUx.state === "blocked") {
    return {
      action: "fix-blocker",
      prompt: routeUx.prompt ?? "Resolve the reported blocker, then retry doctor or connect."
    };
  }

  return {
    action: "connect",
    prompt: `Run ${connectCommand(input)} to continue.`,
    command: connectCommand(input)
  };
}

function nextStepForSession(session: AttachmentSession, sessionUx: BrowserAttachUxInterpretation): ConnectionNextStep {
  if (session.status.canAct) {
    return {
      action: "session-ready",
      prompt: `Use session ${session.id} for follow-up actions like activate, navigate, or screenshot.`
    };
  }

  return {
    action: "session-ready",
    prompt: `Use session ${session.id} for inspect/resume flows and keep the read-only scope explicit.`
  };
}

function nextStepForFailure(routeUx: BrowserAttachUxInterpretation | undefined, error: ErrorPayload["error"]): ConnectionNextStep {
  if (routeUx?.userActionRequired || routeUx?.state === "user-action-required") {
    return {
      action: "fix-blocker",
      prompt: routeUx.prompt ?? routeUx.retryGuidance ?? error.message
    };
  }

  if (routeUx?.retryable) {
    return {
      action: "retry",
      prompt: routeUx.retryGuidance ?? routeUx.prompt ?? error.message
    };
  }

  return {
    action: "review-error",
    prompt: routeUx?.prompt ?? error.message
  };
}

function firstDiagnosticBlocker(
  diagnostics: BrowserDiagnostics,
  route: ConnectionRouteDescriptor
): ConnectionReason | undefined {
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
    || code === "unsupported_route";
}

function toErrorReason(
  error: ErrorPayload["error"],
  errorUx?: Pick<BrowserAttachUxInterpretation, "retryable" | "userActionRequired">
): ConnectionReason {
  return {
    code: error.code,
    message: error.message,
    ...(typeof errorUx?.retryable === "boolean" ? { retryable: errorUx.retryable } : {}),
    ...(typeof errorUx?.userActionRequired === "boolean" ? { userActionRequired: errorUx.userActionRequired } : {})
  };
}

async function loadRouteState(
  adapter: ServiceBridgeAdapter,
  input: ConnectionRouteInput
): Promise<{
  descriptor: ConnectionRouteDescriptor;
  capabilities: BridgeCapabilitiesContract;
  diagnostics: BrowserDiagnostics;
  operation: ChromeRelayFailureOperation;
  routeUx: BrowserAttachUxInterpretation;
}> {
  const descriptor = toDescriptor(input);
  const capabilities = await adapter.getCapabilities();
  const diagnostics = await adapter.getDiagnostics(descriptor.browser);
  const operation: ChromeRelayFailureOperation = input.sessionId ? "resumeSession" : "attach";
  const routeUx = interpretBrowserAttachUxFromDiagnostics({
    browser: descriptor.browser,
    attachMode: descriptor.attachMode,
    diagnostics,
    operation
  });

  return {
    descriptor,
    capabilities,
    diagnostics,
    operation,
    routeUx
  };
}

export async function doctorConnectionRoute(
  service: Pick<AttachService, "getCapabilities" | "diagnostics" | "attach" | "resumeSession">,
  input: ConnectionRouteInput
): Promise<ConnectionDoctorEnvelope> {
  const adapter = createServiceBridgeAdapter(service);
  const state = await loadRouteState(adapter, input);

  return {
    ok: state.routeUx.state !== "blocked",
    command: "doctor",
    route: state.descriptor,
    operation: state.operation,
    outcome: state.routeUx.state === "blocked" ? "blocked" : "success",
    status: state.routeUx.state === "blocked" ? "blocked" : "ready",
    category: state.routeUx.state === "blocked" ? "route-blocked" : "route-ready",
    ...(state.routeUx.state === "blocked" ? { reason: firstDiagnosticBlocker(state.diagnostics, state.descriptor) } : {}),
    summary: summarizeDoctor(state.routeUx),
    prompt: state.routeUx.prompt,
    nextStep: nextStepForDoctor(input, state.routeUx),
    capabilities: state.capabilities,
    diagnostics: state.diagnostics,
    routeUx: state.routeUx,
    blocked: state.routeUx.state === "blocked"
  };
}

export async function connectConnectionRoute(
  service: Pick<AttachService, "getCapabilities" | "diagnostics" | "attach" | "resumeSession">,
  input: ConnectionRouteInput
): Promise<ConnectionConnectEnvelope> {
  const adapter = createServiceBridgeAdapter(service);
  const state = await loadRouteState(adapter, input);

  try {
    const prepared = await prepareClaudeCodeRoute(adapter, input);

    if (prepared.blocked) {
      return {
        ok: false,
        command: "connect",
        route: state.descriptor,
        operation: state.operation,
        outcome: "blocked",
        status: "blocked",
        category: "connection-blocked",
        reason: firstDiagnosticBlocker(prepared.diagnostics, state.descriptor),
        summary: summarizeDoctor(prepared.routeUx),
        prompt: prepared.prompt,
        nextStep: nextStepForDoctor(input, prepared.routeUx),
        capabilities: prepared.capabilities as BridgeCapabilitiesContract,
        diagnostics: prepared.diagnostics,
        routeUx: prepared.routeUx,
        blocked: true,
        connected: false
      };
    }

    const connection = prepared.connection!;
    return {
      ok: true,
      command: "connect",
      route: state.descriptor,
      operation: state.operation,
      outcome: "success",
      status: "connected",
      category: "session-connected",
      summary: summarizeSession(connection.session, connection.sessionUx),
      prompt: prepared.prompt,
      nextStep: nextStepForSession(connection.session, connection.sessionUx),
      capabilities: connection.capabilities as BridgeCapabilitiesContract,
      diagnostics: connection.diagnostics,
      routeUx: connection.routeUx,
      blocked: false,
      connected: true,
      session: connection.session,
      sessionUx: connection.sessionUx
    };
  } catch (error) {
    const { payload } = toErrorPayload(error);
    const errorUx = interpretBrowserAttachUxFromError({
      details: payload.error.details as Parameters<typeof interpretBrowserAttachUxFromError>[0]["details"],
      browser: state.descriptor.browser,
      attachMode: state.descriptor.attachMode,
      operation: state.operation
    });

    return {
      ok: false,
      command: "connect",
      route: state.descriptor,
      operation: state.operation,
      outcome: isUnsupportedReasonCode(payload.error.code) ? "unsupported" : "error",
      status: isUnsupportedReasonCode(payload.error.code) ? "unsupported" : "failed",
      category: isUnsupportedReasonCode(payload.error.code) ? "connection-unsupported" : "connection-failed",
      reason: toErrorReason(payload.error, errorUx),
      summary: summarizeFailure(errorUx, payload.error),
      prompt: errorUx?.prompt ?? payload.error.message,
      nextStep: nextStepForFailure(errorUx, payload.error),
      capabilities: state.capabilities,
      diagnostics: state.diagnostics,
      routeUx: state.routeUx,
      blocked: false,
      connected: false,
      error: payload.error,
      errorUx
    };
  }
}
