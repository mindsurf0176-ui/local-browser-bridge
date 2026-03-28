import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { AppError } from "../errors";
import type {
  BrowserAdapter,
  BrowserAttachModeDiagnostics,
  BrowserDiagnostics,
  BrowserNativeIdentity,
  BrowserSessionAction,
  BrowserSourceCandidate,
  BrowserTabTarget,
  SessionActionResult,
  TabIdentity,
  TabMetadata
} from "../types";

const execFileAsync = promisify(execFile);
const CHROME_PREFIX = "Chrome/Chromium session actions are not implemented in this phase.";
const DEFAULT_DEBUG_PORTS = [9222, 9223, 9333];
const DEVTOOLS_VERSION_PATH = "/json/version";
const DEVTOOLS_LIST_PATH = "/json/list";
const DEBUG_URL_ENV = "LOCAL_BROWSER_BRIDGE_CHROME_DEBUG_URL";
const RELAY_STATE_PATH_ENV = "LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH";
const DEFAULT_RELAY_STATE_PATHS = [
  join(process.cwd(), ".local-browser-bridge", "chrome-relay-state.json"),
  join(homedir(), ".local-browser-bridge", "chrome-relay-state.json")
];

interface ChromeDiscoveryResult {
  candidates: BrowserSourceCandidate[];
  selectedBaseUrl?: string;
  selectedSourceLabel?: string;
}

interface ChromeListTarget {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
  openerId?: string;
  browserContextId?: string;
}

interface ChromeRelayStateTabProbe {
  id?: string;
  url?: string;
  title?: string;
}

interface ChromeRelayStateProbe {
  version?: string;
  updatedAt?: string;
  extensionInstalled?: boolean;
  connected?: boolean;
  userGestureRequired?: boolean;
  shareRequired?: boolean;
  resumable?: boolean;
  expiresAt?: string;
  resumeRequiresUserGesture?: boolean;
  sharedTab?: ChromeRelayStateTabProbe | null;
}

interface ChromeRelayAttachResolution {
  tab: TabMetadata;
  trustedAt?: string;
  resumable?: boolean;
  expiresAt?: string;
  resumeRequiresUserGesture?: boolean;
}

interface ChromeRelayProbeResult {
  checkedPaths: string[];
  sourcePath?: string;
  source: "configured" | "conventional";
  probe?: ChromeRelayStateProbe;
  error?: "invalid";
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

function createIdentity(native: BrowserNativeIdentity, url: string, title: string): TabIdentity {
  const parsedUrl = normalizeUrl(url);
  const origin = parsedUrl?.origin ?? "";
  const pathname = parsedUrl?.pathname ?? "";
  const urlKey = parsedUrl ? `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}` : url.trim();
  const titleKey = normalizeTitle(title);
  const signature = createHash("sha256")
    .update(JSON.stringify({ browser: "chrome", targetId: native.targetId, urlKey, titleKey }))
    .digest("hex")
    .slice(0, 24);

  return {
    signature,
    urlKey,
    titleKey,
    origin,
    pathname,
    native
  };
}

function toTabMetadata(target: ChromeListTarget, index: number): TabMetadata {
  const title = String(target.title ?? "");
  const url = String(target.url ?? "");
  const targetId = String(target.id ?? `tab-${index + 1}`);
  const native: BrowserNativeIdentity = {
    kind: "chrome-devtools-target",
    targetId,
    targetType: typeof target.type === "string" ? target.type : undefined,
    attached: typeof target.attached === "boolean" ? target.attached : undefined,
    openerId: typeof target.openerId === "string" ? target.openerId : undefined,
    browserContextId: typeof target.browserContextId === "string" ? target.browserContextId : undefined
  };

  return {
    browser: "chrome",
    windowIndex: 1,
    tabIndex: index + 1,
    title,
    url,
    attachedAt: new Date().toISOString(),
    identity: createIdentity(native, url, title),
    isFrontWindow: index === 0,
    isActiveInWindow: index === 0
  };
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response.json();
}

function pushCandidate(target: BrowserSourceCandidate[], candidate: BrowserSourceCandidate): void {
  const key = JSON.stringify({
    kind: candidate.kind,
    label: candidate.label,
    baseUrl: candidate.baseUrl,
    devtoolsActivePortPath: candidate.devtoolsActivePortPath,
    pid: candidate.pid,
    port: candidate.port
  });

  if (!target.some((item) => JSON.stringify({
    kind: item.kind,
    label: item.label,
    baseUrl: item.baseUrl,
    devtoolsActivePortPath: item.devtoolsActivePortPath,
    pid: item.pid,
    port: item.port
  }) === key)) {
    target.push(candidate);
  }
}

function chromeProfilePaths(): Array<{ label: string; path: string }> {
  const home = homedir();
  return [
    {
      label: "Google Chrome DevToolsActivePort",
      path: join(home, "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort")
    },
    {
      label: "Google Chrome Canary DevToolsActivePort",
      path: join(home, "Library", "Application Support", "Google", "Chrome Canary", "DevToolsActivePort")
    },
    {
      label: "Chromium DevToolsActivePort",
      path: join(home, "Library", "Application Support", "Chromium", "DevToolsActivePort")
    }
  ];
}

async function discoverFromEnv(): Promise<BrowserSourceCandidate[]> {
  const baseUrl = process.env[DEBUG_URL_ENV]?.trim();
  if (!baseUrl) {
    return [];
  }

  return [{
    kind: "devtools-http",
    label: `${DEBUG_URL_ENV} override`,
    baseUrl,
    chosen: false,
    notes: ["Explicit override from environment variable."]
  }];
}

async function discoverFromDevtoolsFiles(): Promise<BrowserSourceCandidate[]> {
  const candidates: BrowserSourceCandidate[] = [];

  for (const profile of chromeProfilePaths()) {
    try {
      const raw = await readFile(profile.path, "utf8");
      const [portLine] = raw.split(/\r?\n/);
      const port = Number(portLine?.trim());

      if (!Number.isFinite(port) || port <= 0) {
        pushCandidate(candidates, {
          kind: "profile-devtools-file",
          label: profile.label,
          devtoolsActivePortPath: profile.path,
          notes: ["DevToolsActivePort exists but did not contain a usable port."]
        });
        continue;
      }

      pushCandidate(candidates, {
        kind: "profile-devtools-file",
        label: profile.label,
        devtoolsActivePortPath: profile.path,
        port,
        host: "127.0.0.1",
        baseUrl: `http://127.0.0.1:${port}`
      });
    } catch {
      // Ignore missing/unreadable files.
    }
  }

  return candidates;
}

function relayStateCandidatePaths(): Array<{ path: string; source: "configured" | "conventional" }> {
  const configured = process.env[RELAY_STATE_PATH_ENV]?.trim();
  if (configured) {
    return [{ path: configured, source: "configured" }];
  }

  return DEFAULT_RELAY_STATE_PATHS.map((path) => ({ path, source: "conventional" as const }));
}

function toRelayProbe(raw: unknown): ChromeRelayStateProbe | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const sharedTabRaw = record.sharedTab;
  const sharedTab =
    sharedTabRaw && typeof sharedTabRaw === "object" && !Array.isArray(sharedTabRaw)
      ? (() => {
          const sharedTabRecord = sharedTabRaw as Record<string, unknown>;
          return {
            id: typeof sharedTabRecord.id === "string" ? sharedTabRecord.id : undefined,
            url: typeof sharedTabRecord.url === "string" ? sharedTabRecord.url : undefined,
            title: typeof sharedTabRecord.title === "string" ? sharedTabRecord.title : undefined
          };
        })()
      : sharedTabRaw === null
        ? null
        : undefined;

  return {
    version: typeof record.version === "string" ? record.version : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    extensionInstalled: typeof record.extensionInstalled === "boolean" ? record.extensionInstalled : undefined,
    connected: typeof record.connected === "boolean" ? record.connected : undefined,
    userGestureRequired: typeof record.userGestureRequired === "boolean" ? record.userGestureRequired : undefined,
    shareRequired: typeof record.shareRequired === "boolean" ? record.shareRequired : undefined,
    resumable: typeof record.resumable === "boolean" ? record.resumable : undefined,
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : undefined,
    resumeRequiresUserGesture: typeof record.resumeRequiresUserGesture === "boolean" ? record.resumeRequiresUserGesture : undefined,
    sharedTab
  };
}

async function loadRelayProbe(): Promise<ChromeRelayProbeResult> {
  const candidates = relayStateCandidatePaths();
  const checkedPaths = candidates.map((candidate) => candidate.path);

  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(await readFile(candidate.path, "utf8")) as unknown;
      const probe = toRelayProbe(raw);
      if (!probe) {
        return {
          checkedPaths,
          sourcePath: candidate.path,
          source: candidate.source,
          error: "invalid"
        };
      }

      return {
        checkedPaths,
        sourcePath: candidate.path,
        source: candidate.source,
        probe
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("ENOENT")) {
        continue;
      }

      return {
        checkedPaths,
        sourcePath: candidate.path,
        source: candidate.source,
        error: "invalid"
      };
    }
  }

  return {
    checkedPaths,
    source: process.env[RELAY_STATE_PATH_ENV]?.trim() ? "configured" : "conventional"
  };
}

function buildRelayDiagnostics(probeResult: ChromeRelayProbeResult): BrowserAttachModeDiagnostics {
  const blockers: BrowserAttachModeDiagnostics["blockers"] = [];
  const notes: string[] = [];
  const probe = probeResult.probe;

  if (probeResult.sourcePath) {
    notes.push(`Relay state probe loaded from ${probeResult.sourcePath}.`);
  } else if (probeResult.checkedPaths.length > 0) {
    notes.push(`Relay state probe not found. Checked: ${probeResult.checkedPaths.join(", ")}.`);
  }

  if (probe?.version) {
    notes.push(`Relay probe version: ${probe.version}.`);
  }
  if (probe?.updatedAt) {
    notes.push(`Relay probe updatedAt: ${probe.updatedAt}.`);
  }
  if (probe?.expiresAt) {
    notes.push(`Relay scope expiresAt: ${probe.expiresAt}.`);
  }
  if (probe?.sharedTab?.url || probe?.sharedTab?.title) {
    notes.push(`Relay shared tab detected: ${probe.sharedTab.title ?? "untitled"} ${probe.sharedTab.url ?? ""}`.trim());
  }
  if (probe?.resumeRequiresUserGesture === true) {
    notes.push("Relay resume requires the user to share the tab again.");
  }

  let state: BrowserAttachModeDiagnostics["state"] = "unavailable";
  let ready = false;

  if (probeResult.error === "invalid") {
    blockers.push({
      code: "relay_probe_invalid",
      message: "The local Chrome relay state probe file exists but could not be parsed as a supported JSON object."
    });
  } else if (!probe) {
    blockers.push({
      code: "relay_probe_not_configured",
      message:
        "No local Chrome relay state probe was found. Set LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH or write .local-browser-bridge/chrome-relay-state.json."
    });
  } else if (probe.extensionInstalled === false) {
    blockers.push({
      code: "relay_extension_not_installed",
      message: "The local relay probe reports that the Chrome relay extension is not installed."
    });
  } else if (probe.connected === false) {
    blockers.push({
      code: "relay_extension_disconnected",
      message: "The local relay probe reports that the extension is installed but not currently connected to the bridge."
    });
  } else if (probe.userGestureRequired === true || probe.shareRequired === true) {
    state = "attention-required";
    blockers.push({
      code: probe.userGestureRequired === true ? "relay_toolbar_not_clicked" : "relay_share_required",
      message:
        probe.userGestureRequired === true
          ? "The user must click the relay extension toolbar button before a tab can be shared."
          : "The relay extension is connected, but the current tab still needs to be explicitly shared."
    });
  } else if (!probe.sharedTab) {
    blockers.push({
      code: "relay_no_shared_tab",
      message: "The relay extension is connected, but no shared tab is currently available."
    });
  } else if (isExpiredIsoTimestamp(probe.expiresAt)) {
    blockers.push({
      code: "relay_attach_scope_expired",
      message: "The relayed tab scope has expired and must be shared again before attach can succeed."
    });
  } else {
    state = "ready";
    ready = true;
  }

  return {
    mode: "relay",
    source: "extension-relay",
    scope: "tab",
    supported: true,
    ready,
    state,
    blockers,
    notes
  };
}

function isExpiredIsoTimestamp(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function toRelayTabMetadata(probe: ChromeRelayStateProbe): TabMetadata {
  const title = probe.sharedTab?.title ?? "";
  const url = probe.sharedTab?.url ?? "";
  const targetId = probe.sharedTab?.id ?? `relay-${createHash("sha256").update(`${url}:${title}`).digest("hex").slice(0, 12)}`;
  const native: BrowserNativeIdentity = {
    kind: "chrome-devtools-target",
    targetId,
    targetType: "page",
    attached: true
  };

  return {
    browser: "chrome",
    windowIndex: 1,
    tabIndex: 1,
    title,
    url,
    attachedAt: new Date().toISOString(),
    identity: createIdentity(native, url, title),
    isFrontWindow: true,
    isActiveInWindow: true
  };
}

function toRelayAttachError(result: ChromeRelayProbeResult): AppError {
  const diagnostics = buildRelayDiagnostics(result);
  const blocker = diagnostics.blockers[0];
  return new AppError(
    blocker?.message ?? "Chrome relay attach is not available for the current tab.",
    blocker?.code === "relay_attach_target_out_of_scope" ? 409 : 503,
    blocker?.code ?? "relay_no_shared_tab"
  );
}

export async function resolveChromeRelayAttach(target: BrowserTabTarget): Promise<ChromeRelayAttachResolution> {
  const result = await loadRelayProbe();
  const probe = result.probe;

  if (!probe || result.error === "invalid") {
    throw toRelayAttachError(result);
  }

  if (target.type !== "front") {
    throw new AppError(
      "Chrome relay attach is scoped to the currently shared tab only; use the front tab target or omit an explicit target.",
      409,
      "relay_attach_target_out_of_scope"
    );
  }

  const diagnostics = buildRelayDiagnostics(result);
  if (!diagnostics.ready) {
    throw toRelayAttachError(result);
  }

  return {
    tab: toRelayTabMetadata(probe),
    trustedAt: probe.updatedAt,
    resumable: probe.resumable,
    expiresAt: probe.expiresAt,
    resumeRequiresUserGesture: probe.resumeRequiresUserGesture
  };
}

export async function resumeChromeRelaySession(session: import("../types").AttachmentSession): Promise<import("../types").ResumedSession> {
  const result = await loadRelayProbe();
  const probe = result.probe;

  if (!probe || result.error === "invalid") {
    throw toRelayAttachError(result);
  }
  if (session.attach.expiresAt && isExpiredIsoTimestamp(session.attach.expiresAt)) {
    throw new AppError(
      "The saved Chrome relay session has expired and the tab must be shared again before it can be resumed.",
      409,
      "relay_attach_scope_expired"
    );
  }
  if (session.attach.resumable === false || session.attach.resumeRequiresUserGesture === true) {
    throw new AppError(
      "The saved Chrome relay session is not resumable without the user sharing the tab again.",
      409,
      "relay_share_required"
    );
  }

  const diagnostics = buildRelayDiagnostics(result);
  if (!diagnostics.ready) {
    throw toRelayAttachError(result);
  }

  const tab = toRelayTabMetadata(probe);
  if (session.target.type === "signature" && session.target.signature !== tab.identity.signature) {
    throw new AppError(
      "The currently shared relay tab does not match the saved Chrome relay session. Share the original tab again before resuming.",
      409,
      "relay_attach_target_out_of_scope"
    );
  }

  return {
    session,
    tab,
    resumedAt: new Date().toISOString(),
    resolution: {
      strategy: "signature",
      matched: true,
      attachMode: session.attach.mode,
      semantics: session.semantics.resume
    }
  };
}

async function discoverFromProcessFlags(): Promise<BrowserSourceCandidate[]> {
  const candidates: BrowserSourceCandidate[] = [];

  try {
    const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="]);
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || !/(chrome|chromium)/i.test(line)) {
        continue;
      }

      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        continue;
      }

      const pid = Number(match[1]);
      const command = match[2];
      const portMatch = command.match(/--remote-debugging-port=(\d+)/);
      if (!portMatch) {
        continue;
      }

      const host = command.match(/--remote-debugging-address=([^\s]+)/)?.[1] ?? "127.0.0.1";
      const port = Number(portMatch[1]);
      pushCandidate(candidates, {
        kind: "process-flag",
        label: `Process flag pid ${pid}`,
        pid,
        command,
        host,
        port,
        baseUrl: `http://${host}:${port}`
      });
    }
  } catch {
    // Ignore ps failures.
  }

  return candidates;
}

function fallbackPortCandidates(): BrowserSourceCandidate[] {
  return DEFAULT_DEBUG_PORTS.map((port) => ({
    kind: "fallback-port",
    label: `Fallback localhost port ${port}`,
    host: "127.0.0.1",
    port,
    baseUrl: `http://127.0.0.1:${port}`
  }));
}

async function discoverChromeEndpoint(): Promise<ChromeDiscoveryResult> {
  const candidates: BrowserSourceCandidate[] = [];

  for (const candidate of await discoverFromEnv()) {
    pushCandidate(candidates, candidate);
  }
  for (const candidate of await discoverFromProcessFlags()) {
    pushCandidate(candidates, candidate);
  }
  for (const candidate of await discoverFromDevtoolsFiles()) {
    pushCandidate(candidates, candidate);
  }
  for (const candidate of fallbackPortCandidates()) {
    pushCandidate(candidates, candidate);
  }

  let selectedBaseUrl: string | undefined;
  let selectedSourceLabel: string | undefined;

  for (const candidate of candidates) {
    if (!candidate.baseUrl) {
      candidate.reachable = false;
      continue;
    }

    try {
      await fetchJson(`${candidate.baseUrl}${DEVTOOLS_VERSION_PATH}`);
      candidate.reachable = true;
      candidate.chosen = true;
      selectedBaseUrl = candidate.baseUrl;
      selectedSourceLabel = candidate.label;
      break;
    } catch (error) {
      candidate.reachable = false;
      candidate.notes = [error instanceof Error ? error.message : "Endpoint probe failed."];
    }
  }

  return { candidates, selectedBaseUrl, selectedSourceLabel };
}

function inspectUnavailableError(candidates: BrowserSourceCandidate[]): AppError {
  const attempted = candidates
    .map((candidate) => candidate.baseUrl ?? candidate.devtoolsActivePortPath ?? candidate.label)
    .slice(0, 6)
    .join(", ");

  return new AppError(
    `Chrome/Chromium tab inspection needs an existing local DevTools HTTP endpoint. No reachable endpoint was found${attempted ? ` (checked: ${attempted}).` : "."}`,
    503,
    "inspect_unavailable"
  );
}

function unsupportedRuntimeOperation(operation: string, code: string): AppError {
  return new AppError(
    `${CHROME_PREFIX} ${operation} is not implemented yet in the current Chrome adapter.`,
    501,
    code
  );
}

export class ChromeAdapter implements BrowserAdapter {
  readonly browser = "chrome" as const;

  private async listInspectableTabs(): Promise<{ tabs: TabMetadata[]; discovery: ChromeDiscoveryResult }> {
    const discovery = await discoverChromeEndpoint();
    if (!discovery.selectedBaseUrl) {
      throw inspectUnavailableError(discovery.candidates);
    }

    let payload: ChromeListTarget[];
    try {
      payload = (await fetchJson(`${discovery.selectedBaseUrl}${DEVTOOLS_LIST_PATH}`)) as ChromeListTarget[];
    } catch (error) {
      throw new AppError(
        `Chrome/Chromium DevTools endpoint was found at ${discovery.selectedBaseUrl}, but tab listing failed. ${error instanceof Error ? error.message : "Unknown error."}`,
        503,
        "inspect_unavailable"
      );
    }

    const tabs = payload
      .filter((target) => target.type === "page")
      .map((target, index) => toTabMetadata(target, index));

    return { tabs, discovery };
  }

  async listTabs(): Promise<TabMetadata[]> {
    const { tabs } = await this.listInspectableTabs();
    return tabs;
  }

  async resolveTab(target: BrowserTabTarget): Promise<TabMetadata> {
    const { tabs } = await this.listInspectableTabs();
    if (tabs.length === 0) {
      throw new AppError(
        "Chrome/Chromium DevTools endpoint is reachable, but it reported no inspectable page targets.",
        404,
        "tab_not_found"
      );
    }

    if (target.type === "front") {
      return tabs[0];
    }

    if (target.type === "indexed") {
      const matchedTab = tabs.find(
        (tab) => tab.windowIndex === target.windowIndex && tab.tabIndex === target.tabIndex
      );
      if (!matchedTab) {
        throw new AppError(
          `Chrome tab not found for window ${target.windowIndex}, tab ${target.tabIndex}.`,
          404,
          "tab_not_found"
        );
      }

      return matchedTab;
    }

    const exactSignature = tabs.find((tab) => tab.identity.signature === target.signature);
    if (exactSignature) {
      return exactSignature;
    }

    const exactUrlTitle = tabs.find(
      (tab) => tab.url === (target.url ?? "") && normalizeTitle(tab.title) === normalizeTitle(target.title ?? "")
    );
    if (exactUrlTitle) {
      return exactUrlTitle;
    }

    const exactUrl = target.url ? tabs.find((tab) => tab.url === target.url) : undefined;
    if (exactUrl) {
      return exactUrl;
    }

    const lastKnown =
      target.lastKnownWindowIndex && target.lastKnownTabIndex
        ? tabs.find(
            (tab) =>
              tab.windowIndex === target.lastKnownWindowIndex && tab.tabIndex === target.lastKnownTabIndex
          )
        : undefined;
    if (lastKnown) {
      return lastKnown;
    }

    throw new AppError(`Chrome tab not found for signature ${target.signature}.`, 404, "tab_not_found");
  }

  async performSessionAction(action: BrowserSessionAction): Promise<SessionActionResult> {
    if (action.action === "activate") {
      throw unsupportedRuntimeOperation("Activation", "activation_unavailable");
    }

    if (action.action === "navigate") {
      throw unsupportedRuntimeOperation("Navigation", "navigation_unavailable");
    }

    if (action.action === "screenshot") {
      throw unsupportedRuntimeOperation("Screenshot capture", "screenshot_unavailable");
    }

    throw new AppError(`Unsupported Chrome session action: ${action.action}`, 400, "unsupported_action");
  }

  async getDiagnostics(): Promise<BrowserDiagnostics> {
    const [osascriptAvailable, screencaptureAvailable, discovery, relayProbe] = await Promise.all([
      commandAvailable("osascript"),
      commandAvailable("screencapture"),
      discoverChromeEndpoint(),
      loadRelayProbe()
    ]);

    const inspectTabs = Boolean(discovery.selectedBaseUrl);
    const reachableCandidates = discovery.candidates.filter((candidate) => candidate.reachable).length;

    const direct: BrowserAttachModeDiagnostics = {
      mode: "direct",
      source: "user-browser",
      scope: "browser",
      supported: true,
      ready: inspectTabs,
      state: inspectTabs ? (reachableCandidates > 1 ? "degraded" : "ready") : "unavailable",
      blockers: inspectTabs
        ? reachableCandidates > 1
          ? [{
              code: "direct_degraded_discovery_partial",
              message: "A usable DevTools endpoint was found, but other discovered candidates were unreachable or incomplete."
            }]
          : []
        : [{
            code: "direct_unavailable_attach_endpoint_missing",
            message: "No running local Chrome/Chromium DevTools HTTP endpoint could be discovered for direct user-browser attach."
          }],
      notes: inspectTabs
        ? ["Direct attach currently uses read-only DevTools discovery and preserves Chrome as chrome-readonly in emitted sessions."]
        : ["Start Chrome/Chromium with a discoverable local DevTools endpoint to make direct attach ready."]
    };

    const relay = buildRelayDiagnostics(relayProbe);

    return {
      browser: this.browser,
      checkedAt: new Date().toISOString(),
      runtime: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        safariRunning: false
      },
      host: {
        osascriptAvailable,
        screencaptureAvailable,
        safariApplicationAvailable: false
      },
      supportedFeatures: {
        inspectTabs,
        attach: inspectTabs || relay.ready,
        activate: false,
        navigate: false,
        screenshot: false,
        savedSessions: inspectTabs || relay.ready,
        cli: true,
        httpApi: true
      },
      constraints: [
        "Safari remains the primary production adapter in this phase.",
        "Chrome/Chromium direct attach currently depends on an already-running local DevTools HTTP endpoint.",
        "This Chrome adapter is intentionally read-only: sessions can be attached and resumed, but activate/navigate/screenshot remain unavailable.",
        "Chrome relay attach is limited to the currently shared tab surfaced by the local relay probe."
      ],
      attach: {
        direct,
        relay
      },
      adapter: {
        mode: inspectTabs ? "chrome-devtools-readonly" : "stub",
        discovery: {
          selectedBaseUrl: discovery.selectedBaseUrl,
          selectedSourceLabel: discovery.selectedSourceLabel,
          candidates: discovery.candidates
        }
      }
    };
  }
}
