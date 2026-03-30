import {
  chromeRelayBranchPrompt,
  chromeRelayRetryGuidance,
  chromeRelayScopeNote,
  interpretChromeRelayFailure,
  type ChromeRelayFailureInterpretation
} from "./chrome-relay-error-helper";

/**
 * Stable consumer utility for mapping diagnostics, sessions, and structured
 * relay failures into a small attach/resume UX interpretation surface.
 */
import type {
  AttachmentSession,
  BrowserAttachMode,
  BrowserAttachReadinessState,
  BrowserDiagnostics,
  ChromeRelayErrorDetails,
  ChromeRelayFailureOperation,
  SupportedBrowser
} from "./types";

export type BrowserAttachUxState =
  | "ready"
  | "blocked"
  | "attached"
  | "resumed"
  | "user-action-required"
  | "retryable-failure"
  | "non-retryable-failure";

export interface BrowserAttachUxInterpretation {
  state: BrowserAttachUxState;
  browser: SupportedBrowser;
  attachMode: BrowserAttachMode;
  operation: ChromeRelayFailureOperation;
  label: string;
  readOnly: boolean;
  sharedTabScoped: boolean;
  readiness: BrowserAttachReadinessState | "ready" | undefined;
  prompt: string | undefined;
  scopeNote: string | undefined;
  retryGuidance: string | undefined;
  retryable: boolean | undefined;
  userActionRequired: boolean | undefined;
  relayFailureCategory: ChromeRelayFailureInterpretation["category"] | undefined;
}

function labelFor(browser: SupportedBrowser, attachMode: BrowserAttachMode): string {
  if (browser === "safari") {
    return "Safari (actionable)";
  }

  if (attachMode === "relay") {
    return "Chrome (shared tab, read-only)";
  }

  return "Chrome (direct, read-only)";
}

function isReadOnly(browser: SupportedBrowser, attachMode: BrowserAttachMode): boolean {
  return browser === "chrome" || attachMode === "relay";
}

function isSharedTabScoped(browser: SupportedBrowser, attachMode: BrowserAttachMode): boolean {
  return browser === "chrome" && attachMode === "relay";
}

function firstBlockerPrompt(blockers: Array<{ code: string; message: string }>): string | undefined {
  const first = blockers[0]?.code;
  if (!first) {
    return undefined;
  }

  switch (first) {
    case "automation_permission_denied":
      return "Safari needs macOS Automation permission before I can control tabs. Grant access, then try again.";
    case "screen_recording_permission_denied":
      return "Safari screenshots also require Screen Recording permission on this Mac.";
    case "browser_not_running":
      return "Safari is not open yet. Open Safari with a normal tab, then retry.";
    case "browser_no_windows":
      return "Safari has no open browser windows yet. Open a normal Safari window, then retry.";
    case "browser_no_tabs":
      return "Safari has open windows, but there is no normal inspectable tab yet. Focus or open a regular Safari tab, then retry.";
    case "direct_unavailable_attach_endpoint_missing":
      return "Chrome direct attach needs a local DevTools endpoint that is already available on this machine. Once Chrome is running in that mode, I can inspect tabs in read-only mode.";
    case "relay_toolbar_not_clicked":
      return "To connect this Chrome tab, click the relay extension button on the tab you want to share.";
    case "relay_share_required":
      return "Chrome relay only works for a tab you explicitly share. Share the tab first, then retry.";
    case "relay_no_shared_tab":
      return "Chrome relay is connected, but there is no shared tab right now. Share the target tab, then retry.";
    case "relay_attach_scope_expired":
      return "That shared-tab grant is no longer active. Click the relay extension again on the original tab, then retry resume.";
    default:
      return blockers[0]?.message;
  }
}

export function interpretBrowserAttachUxFromDiagnostics(args: {
  browser: SupportedBrowser;
  attachMode: BrowserAttachMode;
  diagnostics: BrowserDiagnostics;
  operation?: ChromeRelayFailureOperation;
}): BrowserAttachUxInterpretation {
  const operation = args.operation ?? "attach";
  const label = labelFor(args.browser, args.attachMode);
  const readOnly = isReadOnly(args.browser, args.attachMode);
  const sharedTabScoped = isSharedTabScoped(args.browser, args.attachMode);

  if (args.browser === "safari") {
    const blockers = [
      ...(args.diagnostics.preflight?.inspect.blockers ?? []),
      ...(args.diagnostics.preflight?.automation.blockers ?? [])
    ];
    const ready = Boolean(args.diagnostics.preflight?.inspect.ready && args.diagnostics.preflight?.automation.ready);
    return {
      state: ready ? "ready" : "blocked",
      browser: args.browser,
      attachMode: args.attachMode,
      operation,
      label,
      readOnly,
      sharedTabScoped,
      readiness: ready ? "ready" : "unavailable",
      prompt: firstBlockerPrompt([
        ...blockers,
        ...(args.diagnostics.preflight?.screenshot.blockers ?? [])
      ]),
      scopeNote: undefined,
      retryGuidance: undefined,
      retryable: undefined,
      userActionRequired: undefined,
      relayFailureCategory: undefined
    };
  }

  const modeDiagnostics = args.attachMode === "relay" ? args.diagnostics.attach?.relay : args.diagnostics.attach?.direct;
  return {
    state: modeDiagnostics?.ready ? "ready" : "blocked",
    browser: args.browser,
    attachMode: args.attachMode,
    operation,
    label,
    readOnly,
    sharedTabScoped,
    readiness: modeDiagnostics?.state ?? "unavailable",
    prompt: firstBlockerPrompt(modeDiagnostics?.blockers ?? []),
    scopeNote: sharedTabScoped ? "Scope note: Chrome relay is still limited to the currently shared tab and remains read-only." : undefined,
    retryGuidance: undefined,
    retryable: undefined,
    userActionRequired: undefined,
    relayFailureCategory: undefined
  };
}

export function interpretBrowserAttachUxFromSession(args: {
  session: Pick<AttachmentSession, "browser" | "attach" | "status" | "kind" | "semantics">;
  operation?: ChromeRelayFailureOperation;
}): BrowserAttachUxInterpretation {
  const operation = args.operation ?? "attach";
  const { session } = args;
  const label = labelFor(session.browser, session.attach.mode);
  const sharedTabScoped = session.browser === "chrome" && session.attach.mode === "relay";

  return {
    state: operation === "resumeSession" ? "resumed" : "attached",
    browser: session.browser,
    attachMode: session.attach.mode,
    operation,
    label,
    readOnly: session.status.state === "read-only",
    sharedTabScoped,
    readiness: undefined,
    prompt:
      sharedTabScoped && session.attach.resumeRequiresUserGesture
        ? "That shared-tab grant is no longer active. Click the relay extension again on the original tab, then retry resume."
        : undefined,
    scopeNote:
      sharedTabScoped || session.semantics.inspect === "shared-tab-only"
        ? "Scope note: Chrome relay is still limited to the currently shared tab and remains read-only."
        : undefined,
    retryGuidance: undefined,
    retryable: session.attach.resumable,
    userActionRequired: session.attach.resumeRequiresUserGesture,
    relayFailureCategory: undefined
  };
}

export function interpretBrowserAttachUxFromError(args: {
  details: ChromeRelayErrorDetails | Pick<ChromeRelayErrorDetails, "relay"> | null | undefined;
  browser?: SupportedBrowser;
  attachMode?: BrowserAttachMode;
  operation?: ChromeRelayFailureOperation;
}): BrowserAttachUxInterpretation | undefined {
  const interpretation = interpretChromeRelayFailure(args.details);
  if (!interpretation) {
    return undefined;
  }

  const browser = args.browser ?? "chrome";
  const attachMode = args.attachMode ?? "relay";
  const operation =
    args.operation ??
    (args.details && "context" in args.details ? args.details.context.operation : undefined) ??
    "attach";

  return {
    state: interpretation.userActionRequired
      ? "user-action-required"
      : interpretation.retryable === false
        ? "non-retryable-failure"
        : "retryable-failure",
    browser,
    attachMode,
    operation,
    label: labelFor(browser, attachMode),
    readOnly: interpretation.readOnly,
    sharedTabScoped: interpretation.scopeLimitedToCurrentSharedTab,
    readiness: undefined,
    prompt: chromeRelayBranchPrompt(interpretation.branch),
    scopeNote: chromeRelayScopeNote(interpretation),
    retryGuidance: chromeRelayRetryGuidance(interpretation),
    retryable: interpretation.retryable,
    userActionRequired: interpretation.userActionRequired,
    relayFailureCategory: interpretation.category,
  };
}
