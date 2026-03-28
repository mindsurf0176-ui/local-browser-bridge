import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { AppError } from "../errors";
import type {
  ActivationArtifact,
  BrowserDiagnostics,
  BrowserAdapter,
  BrowserReadinessBlocker,
  BrowserReadinessCheck,
  BrowserReadinessStatus,
  BrowserSessionAction,
  BrowserTabTarget,
  NavigationArtifact,
  ScreenshotArtifact,
  SessionActionResult,
  TabIdentity,
  TabMetadata
} from "../types";

const execFileAsync = promisify(execFile);

type SafariOperation = "inspect" | "activate" | "navigate" | "screenshot";

type SafariInspectableTabRecord = Omit<TabMetadata, "attachedAt" | "identity">;

type SafariInspectionSnapshot = {
  tabs: SafariInspectableTabRecord[];
  windowCount: number;
  inspectableWindowCount: number;
  tabCount: number;
};

type SafariWindowProbe = SafariInspectionSnapshot & {
  running: boolean;
  probeError?: string;
};

type SafariWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  reorderedWindowToFront: boolean;
};

const inspectWindowsScript = `
function enumerateInspectableSafariWindows() {
  const safari = Application("Safari");
  if (!safari.running()) {
    throw new Error("Safari is not running.");
  }

  const windows = safari.windows();
  if (!windows || windows.length === 0) {
    throw new Error("Safari has no open windows.");
  }

  const payload = [];
  let inspectableWindowCount = 0;

  for (let windowOffset = 0; windowOffset < windows.length; windowOffset += 1) {
    const safariWindow = windows[windowOffset];
    let currentTab = null;
    let currentTabIndex = -1;
    let tabs = null;

    try {
      currentTab = safariWindow.currentTab();
      currentTabIndex = currentTab ? Number(currentTab.index()) : -1;
      tabs = safariWindow.tabs();
    } catch (_error) {
      continue;
    }

    if (!tabs || typeof tabs.length !== "number") {
      continue;
    }

    inspectableWindowCount += 1;
    for (let tabOffset = 0; tabOffset < tabs.length; tabOffset += 1) {
      const tab = tabs[tabOffset];
      payload.push({
        browser: "safari",
        windowIndex: windowOffset + 1,
        tabIndex: Number(tab.index()),
        title: String(tab.name() || ""),
        url: String(tab.url() || ""),
        isFrontWindow: windowOffset === 0,
        isActiveInWindow: Number(tab.index()) === currentTabIndex
      });
    }
  }

  return {
    tabs: payload,
    windowCount: windows.length,
    inspectableWindowCount,
    tabCount: payload.length
  };
}

function run() {
  return JSON.stringify(enumerateInspectableSafariWindows());
}
`;

const focusWindowScript = `
function normalizeWindowBounds(rawBounds) {
  if (!rawBounds) {
    return null;
  }

  const toFiniteNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const fromArray = Array.isArray(rawBounds)
    ? rawBounds
    : typeof rawBounds.length === "number"
      ? Array.prototype.slice.call(rawBounds)
      : null;

  if (fromArray && fromArray.length >= 4) {
    const left = toFiniteNumber(fromArray[0]);
    const top = toFiniteNumber(fromArray[1]);
    const right = toFiniteNumber(fromArray[2]);
    const bottom = toFiniteNumber(fromArray[3]);

    if (left !== null && top !== null && right !== null && bottom !== null) {
      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      };
    }
  }

  const x = toFiniteNumber(rawBounds.x);
  const y = toFiniteNumber(rawBounds.y);
  const width = toFiniteNumber(rawBounds.width);
  const height = toFiniteNumber(rawBounds.height);
  if (x !== null && y !== null && width !== null && height !== null) {
    return { x, y, width, height };
  }

  const left = toFiniteNumber(rawBounds.left);
  const top = toFiniteNumber(rawBounds.top);
  const right = toFiniteNumber(rawBounds.right);
  const bottom = toFiniteNumber(rawBounds.bottom);
  if (left !== null && top !== null && right !== null && bottom !== null) {
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  return null;
}

function run(argv) {
  const requestedWindowIndex = Number(argv[0]);
  const requestedTabIndex = Number(argv[1]);
  const preferredWindowOrder = String(argv[2] || "front");
  const safari = Application("Safari");
  if (!safari.running()) {
    throw new Error("Safari is not running.");
  }

  const windows = safari.windows();
  if (!windows || windows.length === 0) {
    throw new Error("Safari has no open windows.");
  }

  const safariWindow = windows[requestedWindowIndex - 1];
  if (!safariWindow) {
    throw new Error("Safari target window is no longer available.");
  }

  const tabs = safariWindow.tabs();
  let targetTab = null;
  for (let index = 0; index < tabs.length; index += 1) {
    const candidate = tabs[index];
    if (Number(candidate.index()) === requestedTabIndex) {
      targetTab = candidate;
      break;
    }
  }

  if (!targetTab) {
    throw new Error("Safari target tab is no longer available.");
  }

  safari.activate();
  safariWindow.currentTab = targetTab;

  let reorderedWindowToFront = false;
  if (preferredWindowOrder !== "preserve") {
    safariWindow.index = 1;
    reorderedWindowToFront = true;
  }

  delay(0.2);

  const normalizedBounds = normalizeWindowBounds(safariWindow.bounds());
  if (!normalizedBounds || !(normalizedBounds.width > 0) || !(normalizedBounds.height > 0)) {
    throw new Error("Safari target window bounds are unavailable or invalid for screenshot capture.");
  }

  return JSON.stringify({
    x: normalizedBounds.x,
    y: normalizedBounds.y,
    width: normalizedBounds.width,
    height: normalizedBounds.height,
    reorderedWindowToFront
  });
}
`;

const navigateWindowScript = `
function run(argv) {
  const requestedWindowIndex = Number(argv[0]);
  const requestedTabIndex = Number(argv[1]);
  const requestedUrl = String(argv[2] || "");
  const preferredWindowOrder = String(argv[3] || "front");
  if (!requestedUrl) {
    throw new Error("navigate requires a URL.");
  }

  const safari = Application("Safari");
  if (!safari.running()) {
    throw new Error("Safari is not running.");
  }

  const windows = safari.windows();
  if (!windows || windows.length === 0) {
    throw new Error("Safari has no open windows.");
  }

  const safariWindow = windows[requestedWindowIndex - 1];
  if (!safariWindow) {
    throw new Error("Safari target window is no longer available.");
  }

  const tabs = safariWindow.tabs();
  let targetTab = null;
  for (let index = 0; index < tabs.length; index += 1) {
    const candidate = tabs[index];
    if (Number(candidate.index()) === requestedTabIndex) {
      targetTab = candidate;
      break;
    }
  }

  if (!targetTab) {
    throw new Error("Safari target tab is no longer available.");
  }

  safari.activate();
  safariWindow.currentTab = targetTab;

  let reorderedWindowToFront = false;
  if (preferredWindowOrder !== "preserve") {
    safariWindow.index = 1;
    reorderedWindowToFront = true;
  }

  targetTab.url = requestedUrl;
  delay(0.2);

  return JSON.stringify({
    browser: "safari",
    windowIndex: requestedWindowIndex,
    tabIndex: requestedTabIndex,
    title: String(targetTab.name() || ""),
    url: String(targetTab.url() || requestedUrl),
    isFrontWindow: safariWindow.index() === 1,
    isActiveInWindow: Number(safariWindow.currentTab().index()) === requestedTabIndex,
    reorderedWindowToFront
  });
}
`;

const safariWindowProbeScript = `
function enumerateInspectableSafariWindows() {
  const safari = Application("Safari");
  const windows = safari.windows();
  const payload = [];
  let inspectableWindowCount = 0;

  for (let windowOffset = 0; windowOffset < windows.length; windowOffset += 1) {
    const safariWindow = windows[windowOffset];
    let currentTab = null;
    let currentTabIndex = -1;
    let tabs = null;

    try {
      currentTab = safariWindow.currentTab();
      currentTabIndex = currentTab ? Number(currentTab.index()) : -1;
      tabs = safariWindow.tabs();
    } catch (_error) {
      continue;
    }

    if (!tabs || typeof tabs.length !== "number") {
      continue;
    }

    inspectableWindowCount += 1;
    for (let tabOffset = 0; tabOffset < tabs.length; tabOffset += 1) {
      const tab = tabs[tabOffset];
      payload.push({
        browser: "safari",
        windowIndex: windowOffset + 1,
        tabIndex: Number(tab.index()),
        title: String(tab.name() || ""),
        url: String(tab.url() || ""),
        isFrontWindow: windowOffset === 0,
        isActiveInWindow: Number(tab.index()) === currentTabIndex
      });
    }
  }

  return {
    tabs: payload,
    windowCount: windows.length,
    inspectableWindowCount,
    tabCount: payload.length
  };
}

function run() {
  const safari = Application("Safari");
  if (!safari.running()) {
    return JSON.stringify({ running: false, windowCount: 0, inspectableWindowCount: 0, tabCount: 0 });
  }

  try {
    return JSON.stringify({ running: true, ...enumerateInspectableSafariWindows() });
  } catch (error) {
    const windows = safari.windows();
    return JSON.stringify({
      running: true,
      windowCount: windows ? windows.length : 0,
      inspectableWindowCount: 0,
      tabCount: 0,
      probeError: String(error && error.message ? error.message : error)
    });
  }
}
`;

function normalizeUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function createIdentity(url: string, title: string): TabIdentity {
  const parsedUrl = normalizeUrl(url);
  const origin = parsedUrl?.origin ?? "";
  const pathname = parsedUrl?.pathname ?? "";
  const urlKey = parsedUrl ? `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}` : url.trim();
  const titleKey = normalizeTitle(title);
  const signature = createHash("sha256")
    .update(JSON.stringify({ browser: "safari", urlKey, titleKey }))
    .digest("hex")
    .slice(0, 24);

  return {
    signature,
    urlKey,
    titleKey,
    origin,
    pathname
  };
}

function withAttachedAt(tab: Omit<TabMetadata, "attachedAt" | "identity">): TabMetadata {
  return {
    ...tab,
    identity: createIdentity(tab.url, tab.title),
    attachedAt: new Date().toISOString()
  };
}

export function parseSafariInspectionSnapshot(raw: string): SafariInspectionSnapshot {
  const parsed = JSON.parse(raw.trim()) as SafariInspectionSnapshot | SafariInspectableTabRecord[];
  if (Array.isArray(parsed)) {
    return {
      tabs: parsed,
      windowCount: 0,
      inspectableWindowCount: 0,
      tabCount: parsed.length
    };
  }

  return {
    tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
    windowCount: typeof parsed.windowCount === "number" ? parsed.windowCount : 0,
    inspectableWindowCount:
      typeof parsed.inspectableWindowCount === "number" ? parsed.inspectableWindowCount : 0,
    tabCount: typeof parsed.tabCount === "number" ? parsed.tabCount : Array.isArray(parsed.tabs) ? parsed.tabs.length : 0
  };
}

export function isValidSafariWindowBounds(bounds: Partial<SafariWindowBounds> | null | undefined): bounds is SafariWindowBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.x) &&
      Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      Number(bounds.width) > 0 &&
      Number(bounds.height) > 0
  );
}

async function activateSafariTarget(tab: TabMetadata, preferredWindowOrder: "front" | "preserve" = "front") {
  const { stdout } = await execFileAsync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    focusWindowScript,
    String(tab.windowIndex),
    String(tab.tabIndex),
    preferredWindowOrder
  ]);

  const parsed = JSON.parse(stdout.trim()) as Partial<SafariWindowBounds>;
  if (!isValidSafariWindowBounds(parsed)) {
    throw new Error("Safari target window bounds are unavailable or invalid for screenshot capture.");
  }

  return parsed;
}

async function navigateSafariTarget(
  tab: TabMetadata,
  url: string,
  preferredWindowOrder: "front" | "preserve" = "front"
) {
  const { stdout } = await execFileAsync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    navigateWindowScript,
    String(tab.windowIndex),
    String(tab.tabIndex),
    url,
    preferredWindowOrder
  ]);

  const parsed = JSON.parse(stdout.trim()) as Omit<TabMetadata, "attachedAt" | "identity"> & {
    reorderedWindowToFront: boolean;
  };
  const { reorderedWindowToFront, ...nextTab } = parsed;

  return {
    tab: withAttachedAt(nextTab),
    reorderedWindowToFront
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

async function safariApplicationAvailable(): Promise<boolean> {
  try {
    await execFileAsync("open", ["-Ra", "Safari"]);
    return true;
  } catch {
    return false;
  }
}

async function safariRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-l",
      "JavaScript",
      "-e",
      'Application("Safari").running() ? "true" : "false"'
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function screenRecordingPermissionGranted(): Promise<boolean | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync("swift", [
      "-e",
      'import CoreGraphics\nprint(CGPreflightScreenCaptureAccess() ? "true" : "false")'
    ]);
    const normalized = stdout.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function safariWindowProbe(): Promise<SafariWindowProbe> {
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", safariWindowProbeScript]);
  return JSON.parse(stdout.trim()) as SafariWindowProbe;
}

function readinessBlocker(
  code: BrowserReadinessBlocker["code"],
  message: string,
  scope: BrowserReadinessBlocker["scope"],
  checks: BrowserReadinessCheck[]
): BrowserReadinessBlocker {
  return { code, message, scope, checks };
}

function readinessStatus(checks: BrowserReadinessCheck[], blockers: BrowserReadinessBlocker[]): BrowserReadinessStatus {
  const relevantBlockers = blockers.filter((blocker) => blocker.checks.some((check) => checks.includes(check)));
  return {
    ready: relevantBlockers.length === 0,
    checks,
    blockers: relevantBlockers
  };
}

export function buildSafariPreflight(args: {
  osascriptAvailable: boolean;
  screencaptureAvailable: boolean;
  applicationAvailable: boolean;
  safariRunning: boolean;
  screenRecordingPermissionGranted?: boolean;
  windowCount?: number;
  inspectableWindowCount?: number;
  tabCount?: number;
  probeError?: unknown;
}): NonNullable<BrowserDiagnostics["preflight"]> {
  const blockers: BrowserReadinessBlocker[] = [];

  if (!args.osascriptAvailable) {
    blockers.push(
      readinessBlocker(
        "host_tool_missing",
        "The host macOS runtime does not have osascript available, so Safari inspection and automation cannot run.",
        "host",
        ["inspect", "automation", "screenshot"]
      )
    );
  }

  if (!args.applicationAvailable) {
    blockers.push(
      readinessBlocker(
        "browser_application_missing",
        "Safari.app is not discoverable on this host.",
        "host",
        ["inspect", "automation", "screenshot"]
      )
    );
  }

  if (!args.safariRunning) {
    blockers.push(
      readinessBlocker(
        "browser_not_running",
        "Safari is not running, so attach and runtime actions are unavailable until Safari is opened.",
        "runtime",
        ["inspect", "automation", "screenshot"]
      )
    );
  }

  if (typeof args.windowCount === "number" && args.safariRunning && args.windowCount < 1) {
    blockers.push(
      readinessBlocker(
        "browser_no_windows",
        "Safari is running but has no open windows, so there is no tab to inspect or act on.",
        "runtime",
        ["inspect", "automation", "screenshot"]
      )
    );
  }

  const hasInspectableWindows = typeof args.inspectableWindowCount === "number" ? args.inspectableWindowCount > 0 : undefined;
  const hasInspectableTabs = typeof args.tabCount === "number" ? args.tabCount > 0 : undefined;
  const windowsWithoutInspectableTabs =
    typeof args.windowCount === "number" &&
    args.windowCount > 0 &&
    (hasInspectableTabs === false || hasInspectableWindows === false) &&
    !blockers.some((blocker) => blocker.code === "browser_no_windows");

  if (windowsWithoutInspectableTabs) {
    blockers.push(
      readinessBlocker(
        "browser_no_tabs",
        hasInspectableWindows === false
          ? "Safari has open windows, but none expose inspectable tabs to Apple Events right now. Safari special or transient windows are being skipped until a normal browser tab is available."
          : "Safari has open windows, but no inspectable tabs are currently available to attach or act on.",
        "runtime",
        ["inspect", "automation", "screenshot"]
      )
    );
  }

  if (args.probeError) {
    const classified = classifySafariRuntimeError("inspect", args.probeError);
    if (classified.code === "automation_permission_denied") {
      blockers.push(
        readinessBlocker(
          "automation_permission_denied",
          "Safari Apple Events permission is currently denied for the host process.",
          "permission",
          ["inspect", "automation", "screenshot"]
        )
      );
    } else if (
      !blockers.some(
        (blocker) => blocker.code === "browser_not_running" || blocker.code === "browser_no_windows" || blocker.code === "browser_no_tabs"
      )
    ) {
      blockers.push(
        readinessBlocker(
          "runtime_error",
          `Safari preflight probe failed: ${classified.message}`,
          "runtime",
          ["inspect", "automation", "screenshot"]
        )
      );
    }
  }

  if (!args.screencaptureAvailable) {
    blockers.push(
      readinessBlocker(
        "host_tool_missing",
        "The host macOS runtime does not have screencapture available, so Safari screenshots cannot be captured.",
        "host",
        ["screenshot"]
      )
    );
  }

  if (args.screenRecordingPermissionGranted === false) {
    blockers.push(
      readinessBlocker(
        "screen_recording_permission_denied",
        "macOS Screen Recording permission is currently denied for the host process, so Safari screenshots cannot be captured until access is granted.",
        "permission",
        ["screenshot"]
      )
    );
  }

  return {
    inspect: readinessStatus(["inspect"], blockers),
    automation: readinessStatus(["automation"], blockers),
    screenshot: readinessStatus(["screenshot"], blockers)
  };
}

function safariErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? "Unknown Safari adapter error.");
}

export function classifySafariRuntimeError(operation: SafariOperation, error: unknown): AppError {
  const message = safariErrorText(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("not authorized") ||
    normalized.includes("not permitted") ||
    normalized.includes("apple event") ||
    normalized.includes("automation") ||
    normalized.includes("screen recording permission") ||
    normalized.includes("cgpreflightscreencaptureaccess returned false")
  ) {
    const code = operation === "screenshot" ? "screen_recording_permission_denied" : "automation_permission_denied";
    const guidance =
      operation === "screenshot"
        ? "Grant Screen Recording permission for the host process, then retry."
        : "Grant Automation/Apple Events permission for the host process to control Safari, then retry.";
    return new AppError(`Safari ${operation} permission denied. ${guidance} Raw error: ${message}`, 403, code);
  }

  if (normalized.includes("safari is not running")) {
    return new AppError(
      `Safari is not running, so ${operation} is unavailable until Safari is opened with at least one tab or window. Raw error: ${message}`,
      503,
      "browser_not_running"
    );
  }

  if (normalized.includes("has no open windows")) {
    return new AppError(
      `Safari has no open windows, so ${operation} is unavailable until a real Safari window exists. Raw error: ${message}`,
      503,
      "browser_unavailable"
    );
  }

  if (normalized.includes("target window is no longer available") || normalized.includes("target tab is no longer available")) {
    return new AppError(
      `Safari target disappeared before ${operation} could complete. Attach or resume the tab again and retry. Raw error: ${message}`,
      404,
      "tab_not_found"
    );
  }

  if (normalized.includes("bounds are unavailable or invalid")) {
    return new AppError(
      `Safari reported invalid window bounds for ${operation}, so screenshot capture was aborted before calling screencapture. Focus a normal Safari window and retry. Raw error: ${message}`,
      503,
      "window_bounds_unavailable"
    );
  }

  if (normalized.includes("could not create image from rect")) {
    return new AppError(
      `macOS screencapture rejected the Safari window region even after activation. This usually means the requested capture rect is not currently capturable on this host/display. Raw error: ${message}`,
      503,
      "screenshot_capture_failed"
    );
  }

  const genericCodeByOperation: Record<SafariOperation, string> = {
    inspect: "browser_unavailable",
    activate: "activation_unavailable",
    navigate: "navigation_unavailable",
    screenshot: "screenshot_unavailable"
  };

  return new AppError(`Unable to ${operation} Safari tab. Raw error: ${message}`, 503, genericCodeByOperation[operation]);
}

function hasSafariInspectableTabs(snapshot: SafariInspectionSnapshot): boolean {
  return snapshot.tabCount > 0 && snapshot.inspectableWindowCount > 0;
}

export function classifySafariTabResolutionError(
  target: BrowserTabTarget,
  snapshot: SafariInspectionSnapshot
): AppError {
  if (snapshot.windowCount === 0) {
    if (target.type === "front") {
      return new AppError(
        "Safari has no open windows, so the front tab is unavailable until a real Safari window exists.",
        503,
        "browser_no_windows"
      );
    }

    return new AppError("Safari has no open windows, so there is no tab to resolve yet.", 503, "browser_no_windows");
  }

  if (!hasSafariInspectableTabs(snapshot)) {
    if (target.type === "front") {
      return new AppError(
        "Safari has open windows, but no inspectable tabs are currently available for the front window. Open or focus a normal Safari tab and retry.",
        503,
        "browser_no_tabs"
      );
    }

    return new AppError(
      "Safari has open windows, but no inspectable tabs are currently available to resolve. Open or focus a normal Safari tab and retry.",
      503,
      "browser_no_tabs"
    );
  }

  if (target.type === "front") {
    return new AppError(
      "Unable to read the front Safari tab. Safari front window has no active tab.",
      503,
      "browser_unavailable"
    );
  }

  if (target.type === "indexed") {
    return new AppError(
      `Safari tab not found for window ${target.windowIndex}, tab ${target.tabIndex}.`,
      404,
      "tab_not_found"
    );
  }

  return new AppError(`Safari tab not found for signature ${target.signature}.`, 404, "tab_not_found");
}

export class SafariAdapter implements BrowserAdapter {
  readonly browser = "safari" as const;

  private async inspectTabs(): Promise<SafariInspectionSnapshot> {
    try {
      const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", inspectWindowsScript]);
      return parseSafariInspectionSnapshot(stdout);
    } catch (error) {
      throw classifySafariRuntimeError("inspect", error);
    }
  }

  async listTabs(): Promise<TabMetadata[]> {
    const snapshot = await this.inspectTabs();
    return snapshot.tabs.map(withAttachedAt);
  }

  async resolveTab(target: BrowserTabTarget): Promise<TabMetadata> {
    const snapshot = await this.inspectTabs();
    const tabs = snapshot.tabs.map(withAttachedAt);

    if (target.type === "front") {
      const frontTab = tabs.find((tab) => tab.isFrontWindow && tab.isActiveInWindow);
      if (!frontTab) {
        throw classifySafariTabResolutionError(target, snapshot);
      }

      return frontTab;
    }

    if (target.type === "indexed") {
      const matchedTab = tabs.find(
        (tab) => tab.windowIndex === target.windowIndex && tab.tabIndex === target.tabIndex
      );
      if (!matchedTab) {
        throw classifySafariTabResolutionError(target, snapshot);
      }

      return matchedTab;
    }

    const exactSignature = tabs.find((tab) => tab.identity.signature === target.signature);
    if (exactSignature) {
      return exactSignature;
    }

    const exactUrlTitle = tabs.find(
      (tab) =>
        tab.url === (target.url ?? "") &&
        normalizeTitle(tab.title) === normalizeTitle(target.title ?? "")
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

    throw classifySafariTabResolutionError(target, snapshot);
  }

  async performSessionAction(action: BrowserSessionAction): Promise<SessionActionResult> {
    const tab = await this.resolveTab(action.target);

    if (action.action === "activate") {
      const activationOptions =
        action.options && typeof action.options === "object" && "preferredWindowOrder" in action.options
          ? { preferredWindowOrder: action.options.preferredWindowOrder as "front" | "preserve" | undefined }
          : undefined;

      try {
        const activation = await activateSafariTarget(tab, activationOptions?.preferredWindowOrder);
        const result: ActivationArtifact = {
          action: "activate",
          browser: this.browser,
          tab,
          activatedAt: new Date().toISOString(),
          implementation: {
            browserNative: false,
            engine: "macos-osascript",
            selectedTarget: true,
            broughtAppToFront: true,
            reorderedWindowToFront: activation.reorderedWindowToFront
          }
        };
        return result;
      } catch (error) {
        throw classifySafariRuntimeError("activate", error);
      }
    }

    if (action.action === "navigate") {
      const navigateActionOptions = action.options as { url?: string; preferredWindowOrder?: "front" | "preserve" } | undefined;
      const navigateOptions = navigateActionOptions?.url
        ? {
            url: String(navigateActionOptions.url),
            preferredWindowOrder: navigateActionOptions.preferredWindowOrder
          }
        : undefined;
      if (!navigateOptions?.url) {
        throw new AppError("url is required for Safari navigation.", 400, "invalid_action");
      }

      try {
        const navigation = await navigateSafariTarget(tab, navigateOptions.url, navigateOptions.preferredWindowOrder);
        const result: NavigationArtifact = {
          action: "navigate",
          browser: this.browser,
          requestedUrl: navigateOptions.url,
          previousTab: tab,
          tab: navigation.tab,
          navigatedAt: new Date().toISOString(),
          implementation: {
            browserNative: false,
            engine: "macos-osascript",
            selectedTarget: true,
            broughtAppToFront: true,
            reusedExistingTab: true
          }
        };
        return result;
      } catch (error) {
        throw classifySafariRuntimeError("navigate", error);
      }
    }

    if (action.action !== "screenshot") {
      throw new AppError(`Unsupported Safari session action: ${action.action}`, 400, "unsupported_action");
    }

    const screenshotOptions = action.options as { outputPath?: string; preferredWindowOrder?: "front" | "preserve" } | undefined;
    const outputPath = screenshotOptions?.outputPath;
    if (!outputPath) {
      throw new AppError("outputPath is required for Safari screenshots.", 500, "invalid_action");
    }

    try {
      await mkdir(dirname(outputPath), { recursive: true });
      const screenRecordingAllowed = await screenRecordingPermissionGranted();
      if (screenRecordingAllowed === false) {
        throw new Error("CGPreflightScreenCaptureAccess returned false. Screen recording permission is required before Safari screenshots can be captured.");
      }

      const bounds = await activateSafariTarget(tab, screenshotOptions?.preferredWindowOrder);
      const region = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
      await execFileAsync("screencapture", ["-x", "-R", region, outputPath]);

      const result: ScreenshotArtifact = {
        action: "screenshot",
        browser: this.browser,
        tab,
        outputPath,
        format: "png",
        capturedAt: new Date().toISOString(),
        implementation: {
          browserNative: false,
          engine: "macos-osascript-screencapture",
          scope: "window",
          activatedTarget: true,
          includesBrowserChrome: true
        }
      };
      return result;
    } catch (error) {
      throw classifySafariRuntimeError("screenshot", error);
    }
  }

  async getDiagnostics(): Promise<BrowserDiagnostics> {
    const [osascriptAvailable, screencaptureAvailable, applicationAvailable, isRunning, screenRecordingAllowed] = await Promise.all([
      commandAvailable("osascript"),
      commandAvailable("screencapture"),
      safariApplicationAvailable(),
      safariRunning(),
      screenRecordingPermissionGranted()
    ]);

    let windowCount: number | undefined;
    let inspectableWindowCount: number | undefined;
    let tabCount: number | undefined;
    let probeError: unknown;
    if (osascriptAvailable && applicationAvailable && isRunning) {
      try {
        const probe = await safariWindowProbe();
        windowCount = probe.windowCount;
        inspectableWindowCount = probe.inspectableWindowCount;
        tabCount = probe.tabCount;
        if (probe.probeError) {
          probeError = probe.probeError;
        }
      } catch (error) {
        probeError = error;
      }
    }

    const constraints = [
      "Safari automation depends on macOS Apple Events permissions.",
      "Screenshots depend on macOS screen recording permissions.",
      "Navigation, activation, and screenshots visibly focus Safari."
    ];

    const preflight = buildSafariPreflight({
      osascriptAvailable,
      screencaptureAvailable,
      applicationAvailable,
      safariRunning: isRunning,
      screenRecordingPermissionGranted: screenRecordingAllowed,
      windowCount,
      inspectableWindowCount,
      tabCount,
      probeError
    });

    return {
      browser: this.browser,
      checkedAt: new Date().toISOString(),
      runtime: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        safariRunning: isRunning
      },
      host: {
        osascriptAvailable,
        screencaptureAvailable,
        safariApplicationAvailable: applicationAvailable
      },
      supportedFeatures: {
        inspectTabs: osascriptAvailable && applicationAvailable,
        attach: true,
        activate: osascriptAvailable && applicationAvailable,
        navigate: osascriptAvailable && applicationAvailable,
        screenshot: osascriptAvailable && screencaptureAvailable && applicationAvailable,
        savedSessions: true,
        cli: true,
        httpApi: true
      },
      constraints,
      preflight,
      adapter: {
        mode: "apple-events"
      }
    };
  }
}
