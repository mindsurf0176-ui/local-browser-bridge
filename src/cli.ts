#!/usr/bin/env node
import { createApiServer } from "./http";
import { normalizeBrowser } from "./browser";
import { AttachService } from "./service/attach-service";
import { AppError, toErrorPayload, writeJsonLine } from "./errors";
import { buildTabTarget } from "./target";
import { connectConnectionRoute, doctorConnectionRoute, normalizeConnectionRouteName } from "./connection-ux";

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  local-browser-bridge front-tab [--browser safari|chrome]",
      "  local-browser-bridge tab [--browser safari|chrome] (--window-index 1 --tab-index 2 | --signature <signature>)",
      "  local-browser-bridge tabs [--browser safari|chrome]",
      "  local-browser-bridge attach [--browser safari|chrome] [--attach-mode direct|relay] [--window-index 1 --tab-index 2 | --signature <signature>]",
      "  local-browser-bridge activate [--browser safari|chrome] [--window-index 1 --tab-index 2 | --signature <signature>]",
      "  local-browser-bridge navigate [--browser safari|chrome] [--window-index 1 --tab-index 2 | --signature <signature>] --url <url>",
      "  local-browser-bridge screenshot [--browser safari|chrome] [--window-index 1 --tab-index 2 | --signature <signature>] [--output <path>]",
      "  local-browser-bridge capabilities [--browser safari|chrome]",
      "  local-browser-bridge diagnostics [--browser safari|chrome]",
      "  local-browser-bridge doctor --route safari|chrome-direct|chrome-relay [--session-id <session-id>]",
      "  local-browser-bridge connect --route safari|chrome-direct|chrome-relay [--session-id <session-id>]",
      "  local-browser-bridge sessions",
      "  local-browser-bridge session --id <session-id>",
      "  local-browser-bridge resume --id <session-id>",
      "  local-browser-bridge session-activate --id <session-id>",
      "  local-browser-bridge session-navigate --id <session-id> --url <url>",
      "  local-browser-bridge session-screenshot --id <session-id> [--output <path>]",
      "  local-browser-bridge serve [--host 127.0.0.1] [--port 3000]",
      "",
      "Safari is the primary adapter. Chrome/Chromium is descriptor/stub-only in this phase.",
      "Compatibility: the safari-attach-tool binary name still works as an alias."
    ].join("\n") + "\n"
  );
}

function readFlag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  return args[index + 1] ?? fallback;
}

function readTarget(args: string[]) {
  return buildTabTarget({
    windowIndex: readFlag(args, "--window-index"),
    tabIndex: readFlag(args, "--tab-index"),
    signature: readFlag(args, "--signature"),
    url: readFlag(args, "--url"),
    title: readFlag(args, "--title")
  });
}

function readOutputPath(args: string[]): string | undefined {
  return readFlag(args, "--output");
}

function readAttachMode(args: string[]): "direct" | "relay" | undefined {
  const value = readFlag(args, "--attach-mode")?.trim();
  if (!value) {
    return undefined;
  }
  if (value === "direct" || value === "relay") {
    return value;
  }
  throw new AppError("--attach-mode must be direct or relay.", 400, "invalid_attach_mode");
}

function readRequiredFlag(args: string[], name: string, code: string): string {
  const value = readFlag(args, name)?.trim();
  if (!value) {
    throw new AppError(`${name} is required.`, 400, code);
  }

  return value;
}

function readRequiredRoute(args: string[]) {
  return normalizeConnectionRouteName(readRequiredFlag(args, "--route", "missing_route"));
}

function writeJson(payload: unknown): void {
  writeJsonLine(process.stdout, payload);
}

export async function runCli(args: string[], service = new AttachService()): Promise<void> {
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "front-tab") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    writeJson({ frontTab: await service.inspectFrontTab(browser) });
    return;
  }

  if (command === "tab") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    writeJson({ tab: await service.inspectTab(browser, readTarget(args)) });
    return;
  }

  if (command === "tabs") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    writeJson({ tabs: await service.listTabs(browser) });
    return;
  }

  if (command === "attach") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    writeJson({
      session: await service.attach(browser, {
        target: readTarget(args),
        attach: { mode: readAttachMode(args) }
      })
    });
    return;
  }

  if (command === "activate") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    writeJson({ activation: await service.activate(browser, readTarget(args)) });
    return;
  }

  if (command === "navigate") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    const url = readRequiredFlag(args, "--url", "missing_url");
    writeJson({ navigation: await service.navigate(browser, readTarget(args), { url }) });
    return;
  }

  if (command === "screenshot") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    writeJson({ screenshot: await service.screenshot(browser, readTarget(args), { outputPath: readOutputPath(args) }) });
    return;
  }

  if (command === "capabilities") {
    const browserFlag = readFlag(args, "--browser");
    const browser = browserFlag ? normalizeBrowser(browserFlag) : undefined;
    writeJson({ capabilities: service.getCapabilities(browser) });
    return;
  }

  if (command === "diagnostics") {
    const browser = normalizeBrowser(readFlag(args, "--browser"));
    writeJson({ diagnostics: await service.diagnostics(browser) });
    return;
  }

  if (command === "doctor") {
    writeJson(
      await doctorConnectionRoute(service, {
        route: readRequiredRoute(args),
        sessionId: readFlag(args, "--session-id")
      })
    );
    return;
  }

  if (command === "connect") {
    writeJson(
      await connectConnectionRoute(service, {
        route: readRequiredRoute(args),
        sessionId: readFlag(args, "--session-id")
      })
    );
    return;
  }

  if (command === "sessions") {
    writeJson({ sessions: await service.listSessions() });
    return;
  }

  if (command === "session") {
    const id = readRequiredFlag(args, "--id", "missing_id");
    writeJson({ session: await service.getSession(id) });
    return;
  }

  if (command === "resume") {
    const id = readRequiredFlag(args, "--id", "missing_id");
    writeJson({ resumedSession: await service.resumeSession(id) });
    return;
  }

  if (command === "session-activate") {
    const id = readRequiredFlag(args, "--id", "missing_id");
    writeJson({ sessionActivation: await service.activateSession(id) });
    return;
  }

  if (command === "session-navigate") {
    const id = readRequiredFlag(args, "--id", "missing_id");
    const url = readRequiredFlag(args, "--url", "missing_url");
    writeJson({ sessionNavigation: await service.navigateSession(id, { url }) });
    return;
  }

  if (command === "session-screenshot") {
    const id = readRequiredFlag(args, "--id", "missing_id");
    writeJson({ sessionScreenshot: await service.screenshotSession(id, { outputPath: readOutputPath(args) }) });
    return;
  }

  if (command === "serve") {
    const host = readFlag(args, "--host", "127.0.0.1") ?? "127.0.0.1";
    const port = Number(readFlag(args, "--port", "3000") ?? "3000");
    const server = createApiServer(service);
    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    process.stdout.write(`Server listening on http://${host}:${port}\n`);
    return;
  }

  throw new AppError(`Unknown command: ${command}`, 400, "unknown_command");
}

async function main(): Promise<void> {
  await runCli(process.argv.slice(2));
}

if (require.main === module) {
  main().catch((error) => {
    const { payload } = toErrorPayload(error);
    writeJsonLine(process.stderr, payload);
    process.exitCode = 1;
  });
}
