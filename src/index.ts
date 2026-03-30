/**
 * Stable consumer-facing entrypoint for reusable local-browser-bridge helpers.
 *
 * These exports stay transport-neutral and agent-agnostic so local clients can
 * consume the documented attach/resume and relay-failure interpretation helpers
 * without reaching into incidental sample code paths.
 */
export {
  chromeRelayBranchPrompt,
  chromeRelayRetryGuidance,
  chromeRelayScopeNote,
  interpretChromeRelayFailure,
  type ChromeRelayFailureCategory,
  type ChromeRelayFailureInterpretation
} from "./chrome-relay-error-helper";

export {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession,
  type BrowserAttachUxInterpretation,
  type BrowserAttachUxState
} from "./browser-attach-ux-helper";

export {
  connectViaBridge,
  createBridgeAdapter,
  sessionFromBridgeResult,
  type BridgeAdapter,
  type BridgeAttachRoute,
  type BridgeConnectionResult,
  type BridgeResumeRoute,
  type BridgeRoute,
  type BridgeSessionResult
} from "./reference-adapter";

export {
  connectCodexViaCli,
  connectCodexViaHttp,
  normalizeCodexRoute,
  type CodexRouteInput,
  type CodexRouteName,
  type ConnectCodexViaCliOptions,
  type ConnectCodexViaHttpOptions
} from "./codex";

export {
  createHttpBridgeAdapter,
  type CreateHttpBridgeAdapterOptions,
  type HttpAttachEnvelope,
  type HttpBridgeExecutor,
  type HttpBridgeRequest,
  type HttpBridgeResponse,
  type HttpCapabilitiesEnvelope,
  type HttpDiagnosticsEnvelope,
  type HttpResumeEnvelope
} from "./http-reference-adapter";

export {
  createCliBridgeAdapter,
  type CliBridgeCommand,
  type CliBridgeCommandResult,
  type CliBridgeExecutor,
  type CreateCliBridgeAdapterOptions
} from "./cli-reference-adapter";

export {
  normalizeClaudeCodeRoute,
  prepareClaudeCodeRoute,
  type ClaudeCodePreparedRoute,
  type ClaudeCodeRouteInput,
  type ClaudeCodeRouteName
} from "./claude-code";

export type {
  AttachmentSession,
  BrowserAttachMode,
  BrowserAttachReadinessState,
  BrowserDiagnostics,
  ChromeRelayErrorDetails,
  ChromeRelayFailureBranch,
  ChromeRelayFailureOperation,
  ChromeRelaySharedTabScope,
  SupportedBrowser
} from "./types";
