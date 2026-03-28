#!/usr/bin/env node
import { AppError, toErrorPayload, writeJsonLine } from "./errors";
import {
  writeChromeRelayFixtureState,
  type ChromeRelayFixtureFlow,
  CHROME_RELAY_STATE_PATH_ENV,
  getDefaultChromeRelayStateOutputPath,
  getHomeChromeRelayStateOutputPath
} from "./chrome-relay-helper";

const SUPPORTED_FLOWS: ChromeRelayFixtureFlow[] = [
  "extension-missing",
  "disconnected",
  "click-required",
  "share-required",
  "shared-tab",
  "expired-share",
  "clear-shared-tab"
];

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  local-browser-bridge-chrome-relay <flow> [--output <path>] [--tab-id <id>] [--url <url>] [--title <title>]",
      "      [--updated-at <iso>] [--expires-at <iso>] [--version <version>]",
      "      [--resumable true|false] [--resume-requires-user-gesture true|false]",
      "",
      `Flows: ${SUPPORTED_FLOWS.join(", ")}`,
      "",
      `Default output path order: --output, ${CHROME_RELAY_STATE_PATH_ENV}, ${getDefaultChromeRelayStateOutputPath()}`,
      `Bridge also reads: ${getHomeChromeRelayStateOutputPath()}`,
      "",
      "Examples:",
      "  local-browser-bridge-chrome-relay extension-missing",
      "  local-browser-bridge-chrome-relay click-required --output ./.local-browser-bridge/chrome-relay-state.json",
      "  local-browser-bridge-chrome-relay shared-tab --tab-id relay-42 --title \"Shared Docs\" --url https://example.com/docs",
      "  local-browser-bridge-chrome-relay expired-share --tab-id relay-42 --url https://example.com/docs",
      "  local-browser-bridge-chrome-relay clear-shared-tab"
    ].join("\n") + "\n"
  );
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readBooleanFlag(args: string[], name: string): boolean | undefined {
  const raw = readFlag(args, name)?.trim();
  if (raw === undefined) {
    return undefined;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new AppError(`${name} must be true or false.`, 400, "invalid_boolean_flag");
}

function readFlow(raw: string | undefined): ChromeRelayFixtureFlow {
  if (raw && (SUPPORTED_FLOWS as string[]).includes(raw)) {
    return raw as ChromeRelayFixtureFlow;
  }

  throw new AppError(`Flow must be one of: ${SUPPORTED_FLOWS.join(", ")}.`, 400, "invalid_relay_flow");
}

export async function runChromeRelayHelperCli(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const result = await writeChromeRelayFixtureState({
    flow: readFlow(command),
    outputPath: readFlag(args, "--output"),
    version: readFlag(args, "--version"),
    updatedAt: readFlag(args, "--updated-at"),
    expiresAt: readFlag(args, "--expires-at"),
    tabId: readFlag(args, "--tab-id"),
    url: readFlag(args, "--url"),
    title: readFlag(args, "--title"),
    resumable: readBooleanFlag(args, "--resumable"),
    resumeRequiresUserGesture: readBooleanFlag(args, "--resume-requires-user-gesture")
  });

  writeJsonLine(process.stdout, {
    ok: true,
    helper: "local-browser-bridge-chrome-relay",
    flow: result.flow,
    path: result.path,
    state: result.state
  });
}

async function main(): Promise<void> {
  await runChromeRelayHelperCli(process.argv.slice(2));
}

if (require.main === module) {
  main().catch((error) => {
    const { payload } = toErrorPayload(error);
    writeJsonLine(process.stderr, payload);
    process.exitCode = 1;
  });
}
