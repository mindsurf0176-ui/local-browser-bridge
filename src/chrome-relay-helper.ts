import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AppError } from "./errors";
import { validateChromeRelayState, type ChromeRelayStateProbe } from "./chrome-relay-state";

export const CHROME_RELAY_STATE_PATH_ENV = "LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH";
const DEFAULT_OUTPUT_PATH = ".local-browser-bridge/chrome-relay-state.json";

export type ChromeRelayFixtureFlow =
  | "extension-missing"
  | "disconnected"
  | "click-required"
  | "share-required"
  | "shared-tab"
  | "expired-share"
  | "clear-shared-tab";

export interface BuildChromeRelayFixtureOptions {
  flow: ChromeRelayFixtureFlow;
  version?: string;
  updatedAt?: string;
  tabId?: string;
  url?: string;
  title?: string;
  expiresAt?: string;
  resumable?: boolean;
  resumeRequiresUserGesture?: boolean;
}

export interface ChromeRelayWriteResult {
  flow: ChromeRelayFixtureFlow;
  path: string;
  state: ChromeRelayStateProbe;
}

function nowIso(): string {
  return new Date().toISOString();
}

function oneHourFromNowIso(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function oneMinuteAgoIso(): string {
  return new Date(Date.now() - 60 * 1000).toISOString();
}

function resolveSharedTab(options: BuildChromeRelayFixtureOptions): NonNullable<ChromeRelayStateProbe["sharedTab"]> {
  return {
    id: options.tabId ?? "tab-123",
    title: options.title ?? "Relay Example",
    url: options.url ?? "https://example.com/shared"
  };
}

export function getDefaultChromeRelayStateOutputPath(): string {
  return resolve(process.cwd(), DEFAULT_OUTPUT_PATH);
}

export function getHomeChromeRelayStateOutputPath(): string {
  return join(homedir(), DEFAULT_OUTPUT_PATH);
}

export function resolveChromeRelayStateOutputPath(explicitPath?: string): string {
  const trimmedExplicit = explicitPath?.trim();
  if (trimmedExplicit) {
    return resolve(trimmedExplicit);
  }

  const configured = process.env[CHROME_RELAY_STATE_PATH_ENV]?.trim();
  if (configured) {
    return resolve(configured);
  }

  return getDefaultChromeRelayStateOutputPath();
}

export function buildChromeRelayFixtureState(options: BuildChromeRelayFixtureOptions): ChromeRelayStateProbe {
  const version = options.version?.trim() || "1.1.0";
  const updatedAt = options.updatedAt?.trim() || nowIso();

  if (options.flow === "extension-missing") {
    return {
      version,
      updatedAt,
      extensionInstalled: false
    };
  }

  if (options.flow === "disconnected") {
    return {
      version,
      updatedAt,
      extensionInstalled: true,
      connected: false
    };
  }

  if (options.flow === "click-required") {
    return {
      version,
      updatedAt,
      extensionInstalled: true,
      connected: true,
      userGestureRequired: true
    };
  }

  if (options.flow === "share-required") {
    return {
      version,
      updatedAt,
      extensionInstalled: true,
      connected: true,
      userGestureRequired: false,
      shareRequired: true
    };
  }

  if (options.flow === "clear-shared-tab") {
    return {
      version,
      updatedAt,
      extensionInstalled: true,
      connected: true,
      userGestureRequired: false,
      shareRequired: false,
      sharedTab: null
    };
  }

  if (options.flow === "shared-tab") {
    return {
      version,
      updatedAt,
      extensionInstalled: true,
      connected: true,
      userGestureRequired: false,
      shareRequired: false,
      resumable: options.resumable ?? true,
      resumeRequiresUserGesture: options.resumeRequiresUserGesture ?? false,
      expiresAt: options.expiresAt?.trim() || oneHourFromNowIso(),
      sharedTab: resolveSharedTab(options)
    };
  }

  return {
    version,
    updatedAt,
    extensionInstalled: true,
    connected: true,
    userGestureRequired: false,
    shareRequired: false,
    resumable: options.resumable ?? false,
    resumeRequiresUserGesture: options.resumeRequiresUserGesture ?? true,
    expiresAt: options.expiresAt?.trim() || oneMinuteAgoIso(),
    sharedTab: resolveSharedTab(options)
  };
}

export async function writeChromeRelayStateSnapshot(
  state: ChromeRelayStateProbe,
  options?: { outputPath?: string }
): Promise<string> {
  const validation = validateChromeRelayState(state);
  if (!validation.ok || !validation.probe) {
    throw new AppError(`Refusing to write invalid chrome relay state: ${validation.errors.join("; ")}`, 400, "invalid_relay_state");
  }

  const outputPath = resolveChromeRelayStateOutputPath(options?.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(validation.probe, null, 2)}\n`, "utf8");
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return outputPath;
}

export async function writeChromeRelayFixtureState(
  options: BuildChromeRelayFixtureOptions & { outputPath?: string }
): Promise<ChromeRelayWriteResult> {
  const state = buildChromeRelayFixtureState(options);
  const path = await writeChromeRelayStateSnapshot(state, { outputPath: options.outputPath });
  return {
    flow: options.flow,
    path,
    state
  };
}
