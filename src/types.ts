export type SupportedBrowser = "safari" | "chrome";

export type StableContractSchemaVersion = 1;

export type SessionKind = "safari-actionable" | "chrome-readonly";

export type BridgeTargetMode = "front" | "indexed" | "signature";

export type SessionResumeStrategy =
  | "front"
  | "indexed"
  | "native_identity"
  | "signature"
  | "url"
  | "url_title"
  | "last_known_index";

export type BridgeOperation =
  | "capabilities"
  | "diagnostics"
  | "inspectFrontTab"
  | "inspectTab"
  | "listTabs"
  | "attach"
  | "resumeSession"
  | "activate"
  | "navigate"
  | "screenshot";

export type BrowserAttachMode = "direct" | "relay";

export type BrowserAttachSource = "user-browser" | "extension-relay";

export type BrowserAttachScope = "browser" | "tab";

export type BrowserAttachReadinessState = "ready" | "degraded" | "attention-required" | "unavailable";

export type BrowserAttachBlockerCode =
  | "direct_unavailable_attach_endpoint_missing"
  | "direct_degraded_discovery_partial"
  | "relay_probe_not_configured"
  | "relay_probe_invalid"
  | "relay_extension_not_installed"
  | "relay_extension_disconnected"
  | "relay_toolbar_not_clicked"
  | "relay_share_required"
  | "relay_no_shared_tab"
  | "relay_attach_target_out_of_scope"
  | "relay_attach_scope_expired"
  | "relay_transport_not_implemented";

export interface TabIdentity {
  signature: string;
  urlKey: string;
  titleKey: string;
  origin: string;
  pathname: string;
  native?: BrowserNativeIdentity;
}

export interface BrowserNativeIdentity {
  kind: "chrome-devtools-target";
  targetId: string;
  targetType?: string;
  attached?: boolean;
  openerId?: string;
  browserContextId?: string;
}

export interface TabMetadata {
  browser: SupportedBrowser;
  windowIndex: number;
  tabIndex: number;
  title: string;
  url: string;
  attachedAt: string;
  identity: TabIdentity;
  isFrontWindow?: boolean;
  isActiveInWindow?: boolean;
}

export interface FrontTabTarget {
  type: "front";
}

export interface IndexedTabTarget {
  type: "indexed";
  windowIndex: number;
  tabIndex: number;
}

export interface SignatureTabTarget {
  type: "signature";
  signature: string;
  url?: string;
  title?: string;
  lastKnownWindowIndex?: number;
  lastKnownTabIndex?: number;
  native?: BrowserNativeIdentity;
}

export type BrowserTabTarget = FrontTabTarget | IndexedTabTarget | SignatureTabTarget;

export interface AttachmentSessionCapabilities {
  resume: true;
  activate: boolean;
  navigate: boolean;
  screenshot: boolean;
}

export interface AttachmentSessionStatus {
  state: "actionable" | "read-only";
  canAct: boolean;
}

export interface AttachModeDescriptor {
  mode: BrowserAttachMode;
  source: BrowserAttachSource;
  scope: BrowserAttachScope;
  supported: boolean;
  readiness?: BrowserAttachReadinessState;
}

export interface SessionAttachMetadata {
  mode: BrowserAttachMode;
  source: BrowserAttachSource;
  scope: BrowserAttachScope;
  resumable?: boolean;
  expiresAt?: string;
  resumeRequiresUserGesture?: boolean;
  trustedAt?: string;
}

export type SessionInspectSemantics = "browser-tabs" | "shared-tab-only";

export type SessionResumeSemantics = "saved-browser-target" | "current-shared-tab";

export type SessionTabReferenceSemantics = "browser-position" | "synthetic-shared-tab-position";

export interface AttachmentSessionSemantics {
  inspect: SessionInspectSemantics;
  list: "saved-session";
  resume: SessionResumeSemantics;
  tabReference: {
    windowIndex: SessionTabReferenceSemantics;
    tabIndex: SessionTabReferenceSemantics;
  };
  notes?: string[];
}

export interface AttachRequest {
  target?: BrowserTabTarget;
  attach?: {
    mode?: BrowserAttachMode;
  };
}

export interface AttachmentSession {
  schemaVersion: StableContractSchemaVersion;
  id: string;
  kind: SessionKind;
  browser: SupportedBrowser;
  target: BrowserTabTarget;
  tab: TabMetadata;
  frontTab: TabMetadata;
  attach: SessionAttachMetadata;
  semantics: AttachmentSessionSemantics;
  capabilities: AttachmentSessionCapabilities;
  status: AttachmentSessionStatus;
  createdAt: string;
}

export interface ResumedSession {
  session: AttachmentSession;
  tab: TabMetadata;
  resumedAt: string;
  resolution: {
    strategy: SessionResumeStrategy;
    matched: boolean;
    attachMode: BrowserAttachMode;
    semantics: SessionResumeSemantics;
  };
}

export interface ScreenshotOptions {
  outputPath?: string;
}

export interface ActivateOptions {
  preferredWindowOrder?: "front" | "preserve";
}

export interface NavigateOptions {
  url: string;
  preferredWindowOrder?: "front" | "preserve";
}

export interface BrowserSessionAction<TAction extends string = string, TOptions = unknown> {
  action: TAction;
  target: BrowserTabTarget;
  options?: TOptions;
}

export interface ScreenshotAction extends BrowserSessionAction<"screenshot", ScreenshotOptions> {
  options?: ScreenshotOptions;
}

export interface ActivateAction extends BrowserSessionAction<"activate", ActivateOptions> {
  options?: ActivateOptions;
}

export interface NavigateAction extends BrowserSessionAction<"navigate", NavigateOptions> {
  options: NavigateOptions;
}

export interface ActivationArtifact {
  action: "activate";
  browser: SupportedBrowser;
  tab: TabMetadata;
  activatedAt: string;
  implementation: {
    browserNative: false;
    engine: string;
    selectedTarget: boolean;
    broughtAppToFront: boolean;
    reorderedWindowToFront: boolean;
  };
}

export interface ScreenshotArtifact {
  action: "screenshot";
  browser: SupportedBrowser;
  tab: TabMetadata;
  outputPath: string;
  format: "png";
  capturedAt: string;
  implementation: {
    browserNative: false;
    engine: string;
    scope: "window" | "display" | "region";
    activatedTarget: boolean;
    includesBrowserChrome: boolean;
  };
}

export interface NavigationArtifact {
  action: "navigate";
  browser: SupportedBrowser;
  requestedUrl: string;
  previousTab: TabMetadata;
  tab: TabMetadata;
  navigatedAt: string;
  implementation: {
    browserNative: false;
    engine: string;
    selectedTarget: boolean;
    broughtAppToFront: boolean;
    reusedExistingTab: true;
  };
}

export type SessionActionResult = ActivationArtifact | ScreenshotArtifact | NavigationArtifact;

export interface SessionScreenshot {
  session: AttachmentSession;
  screenshot: ScreenshotArtifact;
}

export interface SessionActivation {
  session: AttachmentSession;
  activation: ActivationArtifact;
}

export interface SessionNavigation {
  session: AttachmentSession;
  navigation: NavigationArtifact;
}

export interface BrowserSourceCandidate {
  kind: "devtools-http" | "profile-devtools-file" | "process-flag" | "fallback-port";
  label: string;
  baseUrl?: string;
  devtoolsActivePortPath?: string;
  port?: number;
  host?: string;
  pid?: number;
  command?: string;
  reachable?: boolean;
  chosen?: boolean;
  notes?: string[];
}

export type BrowserReadinessCheck = "inspect" | "automation" | "screenshot";

export interface BrowserReadinessBlocker {
  code:
    | "host_tool_missing"
    | "browser_application_missing"
    | "browser_not_running"
    | "browser_no_windows"
    | "browser_no_tabs"
    | "automation_permission_denied"
    | "screen_recording_permission_denied"
    | "runtime_error";
  message: string;
  scope: "host" | "runtime" | "permission";
  checks: BrowserReadinessCheck[];
}

export interface BrowserReadinessStatus {
  ready: boolean;
  checks: BrowserReadinessCheck[];
  blockers: BrowserReadinessBlocker[];
}

export interface BrowserAttachReadinessBlocker {
  code: BrowserAttachBlockerCode;
  message: string;
}

export interface BrowserAttachModeDiagnostics {
  mode: BrowserAttachMode;
  source: BrowserAttachSource;
  scope: BrowserAttachScope;
  supported: boolean;
  ready: boolean;
  state: BrowserAttachReadinessState;
  blockers: BrowserAttachReadinessBlocker[];
  notes?: string[];
}

export interface BrowserDiagnostics {
  browser: SupportedBrowser;
  checkedAt: string;
  runtime: {
    platform: NodeJS.Platform;
    arch: string;
    nodeVersion: string;
    safariRunning: boolean;
  };
  host: {
    osascriptAvailable: boolean;
    screencaptureAvailable: boolean;
    safariApplicationAvailable: boolean;
  };
  supportedFeatures: {
    inspectTabs: boolean;
    attach: boolean;
    activate: boolean;
    navigate: boolean;
    screenshot: boolean;
    savedSessions: boolean;
    cli: boolean;
    httpApi: boolean;
  };
  constraints: string[];
  preflight?: {
    inspect: BrowserReadinessStatus;
    automation: BrowserReadinessStatus;
    screenshot: BrowserReadinessStatus;
  };
  attach?: {
    direct: BrowserAttachModeDiagnostics;
    relay: BrowserAttachModeDiagnostics;
  };
  adapter?: {
    mode: "apple-events" | "chrome-devtools-readonly" | "stub";
    discovery?: {
      selectedBaseUrl?: string;
      selectedSourceLabel?: string;
      candidates: BrowserSourceCandidate[];
    };
  };
}

export interface CapabilityContractSchema {
  path: string;
  version: string;
}

export interface ProductDirection {
  localOnly: true;
  agentAgnostic: true;
  browserStrategy: "safari-first";
  architectureStrategy: "bridge-first";
}

export interface BridgeTransportCapability {
  available: boolean;
  format: "json";
}

export interface CliTransportCapability extends BridgeTransportCapability {
  binary: string;
  aliasBinaries: string[];
  command: string;
}

export interface HttpTransportCapability extends BridgeTransportCapability {
  baseUrl: string;
  capabilitiesPath: string;
}

export interface BrowserCapabilityDescriptor {
  kind: SessionKind;
  browser: string;
  adapter: string;
  available: boolean;
  maturity: "primary" | "stub" | "experimental-readonly";
  platforms: string[];
  bridge: {
    browserNative: boolean;
    implementation: string;
  };
  targeting: {
    modes: BridgeTargetMode[];
    sessionResumeStrategies: SessionResumeStrategy[];
  };
  operations: Record<BridgeOperation, boolean>;
  attachModes?: AttachModeDescriptor[];
  transports: {
    cli: boolean;
    http: boolean;
  };
  constraints: string[];
}

export interface BridgeCapabilitiesContract {
  schemaVersion: StableContractSchemaVersion;
  schema: CapabilityContractSchema;
  generatedAt: string;
  product: {
    name: string;
    displayName: string;
    version: string;
    summary: string;
    direction: ProductDirection;
    manifestoPath: string;
  };
  transports: {
    cli: CliTransportCapability;
    http: HttpTransportCapability;
  };
  targeting: {
    modes: BridgeTargetMode[];
    sessionResumeStrategies: SessionResumeStrategy[];
  };
  browsers: BrowserCapabilityDescriptor[];
}

export interface BrowserAdapter {
  readonly browser: SupportedBrowser;
  listTabs(): Promise<TabMetadata[]>;
  resolveTab(target: BrowserTabTarget): Promise<TabMetadata>;
  performSessionAction(action: BrowserSessionAction): Promise<SessionActionResult>;
  getDiagnostics(): Promise<BrowserDiagnostics>;
}
