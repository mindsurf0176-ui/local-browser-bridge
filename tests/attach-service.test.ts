import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { normalizeBrowser } from "../src/browser";
import {
  buildSafariPreflight,
  classifySafariRuntimeError,
  classifySafariTabResolutionError,
  isValidSafariWindowBounds,
  parseSafariInspectionSnapshot
} from "../src/browser/safari";
import { createApiServer } from "../src/http";
import { AttachService } from "../src/service/attach-service";
import { SessionStore } from "../src/store/session-store";
import { runCli } from "../src/cli";
import { AppError, toErrorPayload } from "../src/errors";
import type {
  ActivationArtifact,
  BrowserAdapter,
  BrowserDiagnostics,
  BrowserSessionAction,
  BrowserTabTarget,
  NavigationArtifact,
  ScreenshotArtifact,
  SupportedBrowser,
  TabMetadata
} from "../src/types";

class FakeAdapter implements BrowserAdapter {
  readonly browser = "safari" as const;
  private mode: "stable" | "moved" = "stable";

  setMode(mode: "stable" | "moved") {
    this.mode = mode;
  }

  async listTabs(): Promise<TabMetadata[]> {
    if (this.mode === "moved") {
      return [
        this.makeTab(1, 1, "Front", "https://front.example.com", true, true, "front-signature"),
        this.makeTab(5, 9, "Example", "https://example.com", false, false, "example-signature")
      ];
    }

    return [
      this.makeTab(1, 1, "Front", "https://front.example.com", true, true, "front-signature"),
      this.makeTab(2, 3, "Example", "https://example.com", false, false, "example-signature")
    ];
  }

  async resolveTab(target: BrowserTabTarget): Promise<TabMetadata> {
    const tabs = await this.listTabs();
    if (target.type === "front") {
      return tabs[0];
    }

    if (target.type === "signature") {
      const bySignature = tabs.find((tab) => tab.identity.signature === target.signature);
      if (bySignature) {
        return bySignature;
      }
    }

    const matched = tabs.find(
      (tab) => tab.windowIndex === (target as { windowIndex: number }).windowIndex && tab.tabIndex === (target as { tabIndex: number }).tabIndex
    );
    assert.ok(matched);
    return matched;
  }

  async performSessionAction(action: BrowserSessionAction): Promise<ActivationArtifact | ScreenshotArtifact | NavigationArtifact> {
    const tab = await this.resolveTab(action.target);

    if (action.action === "activate") {
      return {
        action: "activate",
        browser: this.browser,
        tab,
        activatedAt: "2026-01-02T00:00:00.000Z",
        implementation: {
          browserNative: false,
          engine: "fake-adapter",
          selectedTarget: true,
          broughtAppToFront: true,
          reorderedWindowToFront: true
        }
      };
    }

    if (action.action === "navigate") {
      const requestedUrl = String((action.options as { url: string }).url);
      return {
        action: "navigate",
        browser: this.browser,
        requestedUrl,
        previousTab: tab,
        tab: this.makeTab(tab.windowIndex, tab.tabIndex, "Navigated", requestedUrl, tab.isFrontWindow, tab.isActiveInWindow),
        navigatedAt: "2026-01-02T00:00:00.000Z",
        implementation: {
          browserNative: false,
          engine: "fake-adapter",
          selectedTarget: true,
          broughtAppToFront: true,
          reusedExistingTab: true
        }
      };
    }

    assert.equal(action.action, "screenshot");
    const outputPath = action.options && typeof action.options === "object" && "outputPath" in action.options
      ? String(action.options.outputPath)
      : "";
    assert.ok(outputPath);
    await writeFile(outputPath, "fake-png", "utf8");

    return {
      action: "screenshot",
      browser: this.browser,
      tab,
      outputPath,
      format: "png",
      capturedAt: "2026-01-02T00:00:00.000Z",
      implementation: {
        browserNative: false,
        engine: "fake-adapter",
        scope: "window",
        activatedTarget: true,
        includesBrowserChrome: true
      }
    };
  }

  async getDiagnostics(): Promise<BrowserDiagnostics> {
    return {
      browser: this.browser,
      checkedAt: "2026-01-02T00:00:00.000Z",
      runtime: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        safariRunning: true
      },
      host: {
        osascriptAvailable: true,
        screencaptureAvailable: true,
        safariApplicationAvailable: true
      },
      supportedFeatures: {
        inspectTabs: true,
        attach: true,
        activate: true,
        navigate: true,
        screenshot: true,
        savedSessions: true,
        cli: true,
        httpApi: true
      },
      constraints: ["Fake adapter constraint"],
      preflight: {
        inspect: {
          ready: true,
          checks: ["inspect"],
          blockers: []
        },
        automation: {
          ready: true,
          checks: ["automation"],
          blockers: []
        },
        screenshot: {
          ready: true,
          checks: ["screenshot"],
          blockers: []
        }
      }
    };
  }

  private makeTab(
    windowIndex: number,
    tabIndex: number,
    title: string,
    url: string,
    isFrontWindow = false,
    isActiveInWindow = false,
    signature?: string
  ): TabMetadata {
    return {
      browser: "safari",
      windowIndex,
      tabIndex,
      title,
      url,
      attachedAt: "2026-01-01T00:00:00.000Z",
      identity: {
        signature: signature ?? `${title.toLowerCase()}-${tabIndex}`,
        urlKey: `${url}/`.replace(/\/\/$/, "/"),
        titleKey: title.toLowerCase(),
        origin: new URL(url).origin,
        pathname: new URL(url).pathname
      },
      isFrontWindow,
      isActiveInWindow
    };
  }
}

function createTestService(baseDir: string, adapter = new FakeAdapter()): { service: AttachService; adapter: FakeAdapter } {
  const store = new SessionStore({ filePath: resolve(baseDir, "sessions.json") });
  const service = new AttachService({
    store,
    adapterFactory: (_browser: SupportedBrowser) => adapter
  });
  return { service, adapter };
}

async function withCapturedStreams(run: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  (process.stdout.write as typeof process.stdout.write) = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  (process.stderr.write as typeof process.stderr.write) = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;

  try {
    await run();
    return { stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

test("attach persists stronger signature targets and list returns newest-first sessions", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "service");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const { service } = createTestService(baseDir);
  const first = await service.attach("safari");
  const second = await service.attach("safari", { type: "indexed", windowIndex: 2, tabIndex: 3 });
  const sessions = await service.listSessions();

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].id, second.id);
  assert.equal(sessions[1].id, first.id);
  assert.equal(sessions[0].tab.url, "https://example.com");
  assert.equal(sessions[0].target.type, "signature");
  assert.equal((sessions[0].target.type === "signature" && sessions[0].target.signature) || "", "example-signature");
  assert.equal(sessions[0].schemaVersion, 1);
  assert.equal(sessions[0].kind, "safari-actionable");
  assert.equal(sessions[0].status.state, "actionable");
  assert.equal(sessions[0].status.canAct, true);
  assert.equal(sessions[0].capabilities.resume, true);
  assert.equal(sessions[0].capabilities.activate, true);
  assert.equal(sessions[0].capabilities.navigate, true);
  assert.equal(sessions[0].capabilities.screenshot, true);

  const persisted = JSON.parse(await readFile(resolve(baseDir, "sessions.json"), "utf8")) as Array<{
    schemaVersion: number;
    kind: string;
    status: { state: string; canAct: boolean };
    capabilities: { resume: boolean; activate: boolean; navigate: boolean; screenshot: boolean };
  }>;
  assert.equal(persisted[0].schemaVersion, 1);
  assert.equal(persisted[0].kind, "safari-actionable");
  assert.equal(persisted[0].status.state, "actionable");
  assert.equal(persisted[0].capabilities.activate, true);
});

test("resume falls back to stronger identity when tabs moved", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "resume");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const { service, adapter } = createTestService(baseDir);
  const session = await service.attach("safari", { type: "indexed", windowIndex: 2, tabIndex: 3 });
  adapter.setMode("moved");

  const resumed = await service.resumeSession(session.id);
  assert.equal(resumed.session.id, session.id);
  assert.equal(resumed.tab.windowIndex, 5);
  assert.equal(resumed.resolution.strategy, "signature");
});

test("store hydrates additive session metadata for older saved payloads", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "session-hydration");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const sessionPath = resolve(baseDir, "sessions.json");
  await writeFile(
    sessionPath,
    JSON.stringify(
      [
        {
          id: "legacy-session",
          browser: "chrome",
          target: {
            type: "signature",
            signature: "example-two",
            url: "https://example.com/two",
            title: "Example Two"
          },
          tab: {
            browser: "chrome",
            windowIndex: 1,
            tabIndex: 2,
            title: "Example Two",
            url: "https://example.com/two",
            attachedAt: "2026-01-01T00:00:00.000Z",
            identity: {
              signature: "example-two",
              urlKey: "https://example.com/two",
              titleKey: "example two",
              origin: "https://example.com",
              pathname: "/two"
            }
          },
          frontTab: {
            browser: "chrome",
            windowIndex: 1,
            tabIndex: 2,
            title: "Example Two",
            url: "https://example.com/two",
            attachedAt: "2026-01-01T00:00:00.000Z",
            identity: {
              signature: "example-two",
              urlKey: "https://example.com/two",
              titleKey: "example two",
              origin: "https://example.com",
              pathname: "/two"
            }
          },
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      null,
      2
    ) + "\n",
    "utf8"
  );

  const store = new SessionStore({ filePath: sessionPath });
  const [session] = await store.list();
  assert.equal(session.schemaVersion, 1);
  assert.equal(session.kind, "chrome-readonly");
  assert.equal(session.attach.mode, "direct");
  assert.equal(session.attach.source, "user-browser");
  assert.equal(session.attach.scope, "browser");
  assert.equal(session.status.state, "read-only");
  assert.equal(session.status.canAct, false);
  assert.equal(session.capabilities.resume, true);
  assert.equal(session.capabilities.activate, false);
  assert.equal(session.capabilities.navigate, false);
  assert.equal(session.capabilities.screenshot, false);
});

test("activate, navigate, diagnostics, and session navigation work through the service", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "actions");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const { service, adapter } = createTestService(baseDir);
  const activation = await service.activate("safari", { type: "indexed", windowIndex: 2, tabIndex: 3 });
  assert.equal(activation.tab.url, "https://example.com");

  const navigation = await service.navigate("safari", { type: "indexed", windowIndex: 2, tabIndex: 3 }, { url: "https://example.com/next" });
  assert.equal(navigation.previousTab.url, "https://example.com");
  assert.equal(navigation.tab.url, "https://example.com/next");

  const diagnostics = await service.diagnostics("safari");
  assert.equal(diagnostics.supportedFeatures.navigate, true);
  assert.equal(diagnostics.preflight?.automation.ready, true);

  const session = await service.attach("safari", { type: "indexed", windowIndex: 2, tabIndex: 3 });
  adapter.setMode("moved");
  const sessionNavigation = await service.navigateSession(session.id, { url: "https://example.com/renamed" });
  assert.equal(sessionNavigation.navigation.previousTab.windowIndex, 5);
  assert.equal(sessionNavigation.navigation.tab.url, "https://example.com/renamed");
  assert.equal(sessionNavigation.session.target.type, "signature");
  assert.equal(sessionNavigation.session.tab.url, "https://example.com/renamed");
});

test("screenshot writes a file for a target and session screenshot resolves from saved session", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "screenshot");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const { service, adapter } = createTestService(baseDir);
  const screenshotPath = resolve(baseDir, "target.png");
  const targetScreenshot = await service.screenshot(
    "safari",
    { type: "indexed", windowIndex: 2, tabIndex: 3 },
    { outputPath: screenshotPath }
  );

  assert.equal(targetScreenshot.outputPath, screenshotPath);
  assert.equal(await readFile(screenshotPath, "utf8"), "fake-png");

  const session = await service.attach("safari", { type: "indexed", windowIndex: 2, tabIndex: 3 });
  adapter.setMode("moved");
  const sessionScreenshotPath = resolve(baseDir, "session.png");
  const sessionScreenshot = await service.screenshotSession(session.id, { outputPath: sessionScreenshotPath });

  assert.equal(sessionScreenshot.screenshot.tab.windowIndex, 5);
  assert.equal(await readFile(sessionScreenshotPath, "utf8"), "fake-png");
});

test("http server exposes diagnostics, navigation, session navigation, and structured errors", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "http");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const { service, adapter } = createTestService(baseDir);
  const server = createApiServer(service);
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const diagnostics = await fetch(`${baseUrl}/v1/diagnostics?browser=safari`);
  assert.equal(diagnostics.status, 200);
  const diagnosticsPayload = (await diagnostics.json()) as {
    diagnostics: { supportedFeatures: { navigate: boolean }; preflight?: { automation: { ready: boolean } } };
  };
  assert.equal(diagnosticsPayload.diagnostics.supportedFeatures.navigate, true);
  assert.equal(diagnosticsPayload.diagnostics.preflight?.automation.ready, true);

  const capabilities = await fetch(`${baseUrl}/v1/capabilities?browser=safari`);
  assert.equal(capabilities.status, 200);
  const capabilitiesPayload = (await capabilities.json()) as {
    capabilities: {
      schemaVersion: number;
      schema: { path: string; version: string };
      product: { manifestoPath: string };
      browsers: Array<{ kind: string; browser: string; operations: { screenshot: boolean } }>;
    };
  };
  assert.equal(capabilitiesPayload.capabilities.schemaVersion, 1);
  assert.equal(capabilitiesPayload.capabilities.schema.path, "schema/capabilities.schema.json");
  assert.equal(capabilitiesPayload.capabilities.schema.version, "1.0.0");
  assert.equal(capabilitiesPayload.capabilities.product.manifestoPath, "docs/product-direction.md");
  assert.equal(capabilitiesPayload.capabilities.browsers[0].kind, "safari-actionable");
  assert.equal(capabilitiesPayload.capabilities.browsers[0].browser, "safari");
  assert.equal(capabilitiesPayload.capabilities.browsers[0].operations.screenshot, true);

  const attach = await fetch(`${baseUrl}/v1/attach`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ browser: "safari", target: { windowIndex: 2, tabIndex: 3 } })
  });
  const attachPayload = (await attach.json()) as {
    session: {
      id: string;
      schemaVersion: number;
      kind: string;
      status: { state: string };
      capabilities: { navigate: boolean; screenshot: boolean };
    };
  };
  assert.equal(attachPayload.session.schemaVersion, 1);
  assert.equal(attachPayload.session.kind, "safari-actionable");
  assert.equal(attachPayload.session.status.state, "actionable");
  assert.equal(attachPayload.session.capabilities.navigate, true);
  assert.equal(attachPayload.session.capabilities.screenshot, true);

  const navigate = await fetch(`${baseUrl}/v1/navigate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      browser: "safari",
      target: { signature: "example-signature", url: "https://example.com", title: "Example" },
      url: "https://example.com/next"
    })
  });
  assert.equal(navigate.status, 201);
  const navigatePayload = (await navigate.json()) as { navigation: { requestedUrl: string; tab: { url: string } } };
  assert.equal(navigatePayload.navigation.requestedUrl, "https://example.com/next");
  assert.equal(navigatePayload.navigation.tab.url, "https://example.com/next");

  adapter.setMode("moved");
  const sessionNavigate = await fetch(`${baseUrl}/v1/sessions/${attachPayload.session.id}/navigate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/from-session" })
  });
  assert.equal(sessionNavigate.status, 201);
  const sessionNavigatePayload = (await sessionNavigate.json()) as {
    sessionNavigation: {
      navigation: { tab: { url: string }; previousTab: { windowIndex: number } };
      session: { tab: { url: string }; status: { state: string } };
    };
  };
  assert.equal(sessionNavigatePayload.sessionNavigation.navigation.previousTab.windowIndex, 5);
  assert.equal(sessionNavigatePayload.sessionNavigation.navigation.tab.url, "https://example.com/from-session");
  assert.equal(sessionNavigatePayload.sessionNavigation.session.tab.url, "https://example.com/from-session");
  assert.equal(sessionNavigatePayload.sessionNavigation.session.status.state, "actionable");

  const missingUrl = await fetch(`${baseUrl}/v1/navigate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ browser: "safari", target: { windowIndex: 2, tabIndex: 3 } })
  });
  assert.equal(missingUrl.status, 400);
  assert.deepEqual(await missingUrl.json(), {
    error: {
      code: "missing_url",
      message: "url is required.",
      statusCode: 400
    }
  });

  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise()))
  );
});

test("cli prints diagnostics JSON and machine-readable errors", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "cli");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const { service } = createTestService(baseDir);
  const diagnosticsResult = await withCapturedStreams(async () => {
    await runCli(["diagnostics", "--browser", "safari"], service);
  });
  const diagnosticsPayload = JSON.parse(diagnosticsResult.stdout) as {
    diagnostics: { browser: string; preflight?: { inspect: { ready: boolean } } };
  };
  assert.equal(diagnosticsPayload.diagnostics.browser, "safari");
  assert.equal(diagnosticsPayload.diagnostics.preflight?.inspect.ready, true);

  const capabilitiesResult = await withCapturedStreams(async () => {
    await runCli(["capabilities", "--browser", "safari"], service);
  });
  const capabilitiesPayload = JSON.parse(capabilitiesResult.stdout) as {
    capabilities: {
      schemaVersion: number;
      product: { name: string };
      browsers: Array<{ kind: string; browser: string; operations: { attach: boolean } }>;
    };
  };
  assert.equal(capabilitiesPayload.capabilities.schemaVersion, 1);
  assert.equal(capabilitiesPayload.capabilities.product.name, "local-browser-bridge");
  assert.equal(capabilitiesPayload.capabilities.browsers[0].kind, "safari-actionable");
  assert.equal(capabilitiesPayload.capabilities.browsers[0].browser, "safari");
  assert.equal(capabilitiesPayload.capabilities.browsers[0].operations.attach, true);

  const attachResult = await withCapturedStreams(async () => {
    await runCli(["attach", "--browser", "safari", "--window-index", "2", "--tab-index", "3"], service);
  });
  const attachPayload = JSON.parse(attachResult.stdout) as {
    session: {
      schemaVersion: number;
      kind: string;
      status: { state: string };
      capabilities: { navigate: boolean; screenshot: boolean };
    };
  };
  assert.equal(attachPayload.session.schemaVersion, 1);
  assert.equal(attachPayload.session.kind, "safari-actionable");
  assert.equal(attachPayload.session.status.state, "actionable");
  assert.equal(attachPayload.session.capabilities.navigate, true);
  assert.equal(attachPayload.session.capabilities.screenshot, true);

  const errorResult = await withCapturedStreams(async () => {
    try {
      await runCli(["navigate", "--browser", "safari"], service);
    } catch (error) {
      const { payload } = toErrorPayload(error);
      process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
    }
  });
  const errorPayload = JSON.parse(errorResult.stderr) as { error: { code: string; statusCode: number } };
  assert.equal(errorPayload.error.code, "missing_url");
  assert.equal(errorPayload.error.statusCode, 400);
});

async function withChromeDevtoolsFixture<T>(
  run: (baseUrl: string, setScenario: (scenario: "stable" | "moved") => void) => Promise<T>
): Promise<T> {
  let scenario: "stable" | "moved" = "stable";
  const server = createServer((request, response) => {
    if (request.url === "/json/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ Browser: "Chrome/123.0.0.0", ProtocolVersion: "1.3" }));
      return;
    }

    if (request.url === "/json/list") {
      const payload =
        scenario === "moved"
          ? [
              {
                id: "page-1",
                type: "page",
                title: "Example One",
                url: "https://example.com/one"
              },
              {
                id: "page-2",
                type: "page",
                title: "Retitled Two",
                url: "https://example.com/two-renamed",
                attached: true,
                openerId: "page-1",
                browserContextId: "context-1"
              }
            ]
          : [
              { id: "page-1", type: "page", title: "Example One", url: "https://example.com/one" },
              {
                id: "page-2",
                type: "page",
                title: "Example Two",
                url: "https://example.com/two",
                attached: false,
                openerId: "page-1",
                browserContextId: "context-1"
              },
              { id: "worker-1", type: "service_worker", title: "Worker", url: "https://example.com/sw.js" }
            ];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const previous = process.env.LOCAL_BROWSER_BRIDGE_CHROME_DEBUG_URL;
  process.env.LOCAL_BROWSER_BRIDGE_CHROME_DEBUG_URL = baseUrl;

  try {
    return await run(baseUrl, (nextScenario) => {
      scenario = nextScenario;
    });
  } finally {
    if (previous === undefined) {
      delete process.env.LOCAL_BROWSER_BRIDGE_CHROME_DEBUG_URL;
    } else {
      process.env.LOCAL_BROWSER_BRIDGE_CHROME_DEBUG_URL = previous;
    }
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise()))
    );
  }
}

async function withChromeRelayStateFixture<T>(state: unknown, run: (statePath: string) => Promise<T>): Promise<T> {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "chrome-relay");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const statePath = resolve(baseDir, "chrome-relay-state.json");
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const previous = process.env.LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH;
  process.env.LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH = statePath;

  try {
    return await run(statePath);
  } finally {
    if (previous === undefined) {
      delete process.env.LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH;
    } else {
      process.env.LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH = previous;
    }
  }
}

test("safari runtime errors classify permission, availability, and target-loss states truthfully", async () => {
  const automationDenied = classifySafariRuntimeError(
    "activate",
    new Error("execution error: Not authorized to send Apple events to Safari. (-1743)")
  );
  assert.equal(automationDenied.code, "automation_permission_denied");
  assert.equal(automationDenied.statusCode, 403);
  assert.match(automationDenied.message, /automation\/apple events permission/i);

  const screenshotDenied = classifySafariRuntimeError(
    "screenshot",
    new Error("screencapture: not permitted to capture screen")
  );
  assert.equal(screenshotDenied.code, "screen_recording_permission_denied");
  assert.equal(screenshotDenied.statusCode, 403);
  assert.match(screenshotDenied.message, /screen recording permission/i);

  const preflightDenied = classifySafariRuntimeError(
    "screenshot",
    new Error("CGPreflightScreenCaptureAccess returned false. Screen recording permission is required before Safari screenshots can be captured.")
  );
  assert.equal(preflightDenied.code, "screen_recording_permission_denied");
  assert.equal(preflightDenied.statusCode, 403);
  assert.match(preflightDenied.message, /screen recording permission/i);

  const notRunning = classifySafariRuntimeError("inspect", new Error("Safari is not running."));
  assert.equal(notRunning.code, "browser_not_running");
  assert.equal(notRunning.statusCode, 503);
  assert.match(notRunning.message, /not running/i);

  const noWindows = classifySafariRuntimeError("inspect", new Error("Safari has no open windows."));
  assert.equal(noWindows.code, "browser_unavailable");
  assert.equal(noWindows.statusCode, 503);
  assert.match(noWindows.message, /no open windows/i);

  const missingTarget = classifySafariRuntimeError(
    "navigate",
    new Error("Safari target tab is no longer available.")
  );
  assert.equal(missingTarget.code, "tab_not_found");
  assert.equal(missingTarget.statusCode, 404);
  assert.match(missingTarget.message, /attach or resume/i);

  const invalidBounds = classifySafariRuntimeError(
    "screenshot",
    new Error("Safari target window bounds are unavailable or invalid for screenshot capture.")
  );
  assert.equal(invalidBounds.code, "window_bounds_unavailable");
  assert.equal(invalidBounds.statusCode, 503);
  assert.match(invalidBounds.message, /aborted before calling screencapture/i);

  const rejectedRect = classifySafariRuntimeError(
    "screenshot",
    new Error("Command failed: screencapture -x -R 0,31,1440,869 out.png\ncould not create image from rect\n")
  );
  assert.equal(rejectedRect.code, "screenshot_capture_failed");
  assert.equal(rejectedRect.statusCode, 503);
  assert.match(rejectedRect.message, /rejected the safari window region/i);
});

test("safari window bounds validator accepts only finite positive screenshot regions", () => {
  assert.equal(
    isValidSafariWindowBounds({ x: 10, y: 20, width: 1200, height: 800, reorderedWindowToFront: true }),
    true
  );
  assert.equal(
    isValidSafariWindowBounds({ x: 10, y: 20, width: 0, height: 800, reorderedWindowToFront: true }),
    false
  );
  assert.equal(
    isValidSafariWindowBounds({ x: 10, y: 20, width: Number.NaN, height: 800, reorderedWindowToFront: true }),
    false
  );
  assert.equal(isValidSafariWindowBounds(null), false);
});

test("safari tab resolution errors distinguish no windows, no inspectable tabs, and missing targets", () => {
  const noWindows = classifySafariTabResolutionError(
    { type: "front" },
    {
      tabs: [],
      windowCount: 0,
      inspectableWindowCount: 0,
      tabCount: 0
    }
  );
  assert.equal(noWindows.code, "browser_no_windows");
  assert.equal(noWindows.statusCode, 503);
  assert.match(noWindows.message, /no open windows/i);

  const noInspectableTabs = classifySafariTabResolutionError(
    { type: "front" },
    {
      tabs: [],
      windowCount: 2,
      inspectableWindowCount: 0,
      tabCount: 0
    }
  );
  assert.equal(noInspectableTabs.code, "browser_no_tabs");
  assert.equal(noInspectableTabs.statusCode, 503);
  assert.match(noInspectableTabs.message, /no inspectable tabs/i);

  const indexedNoInspectableTabs = classifySafariTabResolutionError(
    { type: "indexed", windowIndex: 1, tabIndex: 1 },
    {
      tabs: [],
      windowCount: 1,
      inspectableWindowCount: 0,
      tabCount: 0
    }
  );
  assert.equal(indexedNoInspectableTabs.code, "browser_no_tabs");
  assert.equal(indexedNoInspectableTabs.statusCode, 503);
  assert.match(indexedNoInspectableTabs.message, /resolve/i);

  const missingIndexed = classifySafariTabResolutionError(
    { type: "indexed", windowIndex: 9, tabIndex: 4 },
    {
      tabs: [
        {
          browser: "safari",
          windowIndex: 1,
          tabIndex: 1,
          title: "Front",
          url: "https://example.com",
          isFrontWindow: true,
          isActiveInWindow: true
        }
      ],
      windowCount: 1,
      inspectableWindowCount: 1,
      tabCount: 1
    }
  );
  assert.equal(missingIndexed.code, "tab_not_found");
  assert.equal(missingIndexed.statusCode, 404);
  assert.match(missingIndexed.message, /window 9, tab 4/i);
});

test("safari inspection snapshot parsing preserves inspectable tabs and skips broken windows", () => {
  const snapshot = parseSafariInspectionSnapshot(
    JSON.stringify({
      tabs: [
        {
          browser: "safari",
          windowIndex: 2,
          tabIndex: 1,
          title: "Inspectable",
          url: "https://example.com",
          isFrontWindow: false,
          isActiveInWindow: true
        }
      ],
      windowCount: 3,
      inspectableWindowCount: 1,
      tabCount: 1
    })
  );

  assert.equal(snapshot.windowCount, 3);
  assert.equal(snapshot.inspectableWindowCount, 1);
  assert.equal(snapshot.tabCount, 1);
  assert.equal(snapshot.tabs.length, 1);
  assert.equal(snapshot.tabs[0]?.windowIndex, 2);
  assert.equal(snapshot.tabs[0]?.title, "Inspectable");
});

test("safari diagnostics preflight exposes machine-readable readiness and blockers", async () => {
  const ready = buildSafariPreflight({
    osascriptAvailable: true,
    screencaptureAvailable: true,
    applicationAvailable: true,
    safariRunning: true,
    windowCount: 2,
    inspectableWindowCount: 2,
    tabCount: 4
  });
  assert.equal(ready.inspect.ready, true);
  assert.equal(ready.automation.ready, true);
  assert.equal(ready.screenshot.ready, true);
  assert.equal(ready.inspect.blockers.length, 0);

  const noWindows = buildSafariPreflight({
    osascriptAvailable: true,
    screencaptureAvailable: true,
    applicationAvailable: true,
    safariRunning: true,
    windowCount: 0,
    inspectableWindowCount: 0,
    tabCount: 0
  });
  assert.equal(noWindows.inspect.ready, false);
  assert.equal(noWindows.automation.ready, false);
  assert.equal(noWindows.screenshot.ready, false);
  assert.equal(noWindows.inspect.blockers[0]?.code, "browser_no_windows");

  const noInspectableTabs = buildSafariPreflight({
    osascriptAvailable: true,
    screencaptureAvailable: true,
    applicationAvailable: true,
    safariRunning: true,
    windowCount: 2,
    inspectableWindowCount: 0,
    tabCount: 0
  });
  assert.equal(noInspectableTabs.inspect.ready, false);
  assert.equal(noInspectableTabs.automation.ready, false);
  assert.equal(noInspectableTabs.screenshot.ready, false);
  assert.equal(noInspectableTabs.inspect.blockers[0]?.code, "browser_no_tabs");
  assert.match(noInspectableTabs.inspect.blockers[0]?.message ?? "", /special or transient windows/i);

  const permissionDenied = buildSafariPreflight({
    osascriptAvailable: true,
    screencaptureAvailable: true,
    applicationAvailable: true,
    safariRunning: true,
    probeError: new Error("execution error: Not authorized to send Apple events to Safari. (-1743)")
  });
  assert.equal(permissionDenied.inspect.ready, false);
  assert.equal(permissionDenied.automation.blockers[0]?.code, "automation_permission_denied");
  assert.equal(permissionDenied.screenshot.blockers[0]?.code, "automation_permission_denied");

  const screenshotHostBlocked = buildSafariPreflight({
    osascriptAvailable: true,
    screencaptureAvailable: false,
    applicationAvailable: true,
    safariRunning: true,
    windowCount: 1,
    inspectableWindowCount: 1,
    tabCount: 1
  });
  assert.equal(screenshotHostBlocked.inspect.ready, true);
  assert.equal(screenshotHostBlocked.automation.ready, true);
  assert.equal(screenshotHostBlocked.screenshot.ready, false);
  assert.equal(screenshotHostBlocked.screenshot.blockers[0]?.code, "host_tool_missing");

  const screenRecordingDenied = buildSafariPreflight({
    osascriptAvailable: true,
    screencaptureAvailable: true,
    applicationAvailable: true,
    safariRunning: true,
    screenRecordingPermissionGranted: false,
    windowCount: 1,
    inspectableWindowCount: 1,
    tabCount: 1
  });
  assert.equal(screenRecordingDenied.inspect.ready, true);
  assert.equal(screenRecordingDenied.automation.ready, true);
  assert.equal(screenRecordingDenied.screenshot.ready, false);
  assert.equal(screenRecordingDenied.screenshot.blockers[0]?.code, "screen_recording_permission_denied");
  assert.match(screenRecordingDenied.screenshot.blockers[0]?.message ?? "", /screen recording/i);
});

test("chrome capabilities expose read-only inspection and chromium normalizes to chrome", async () => {
  assert.equal(normalizeBrowser("chromium"), "chrome");

  const service = new AttachService();
  const capabilities = service.getCapabilities();
  const chrome = capabilities.browsers.find((browser) => browser.browser === "chrome");
  assert.ok(chrome);
  assert.equal(chrome.kind, "chrome-readonly");
  assert.equal(chrome.maturity, "experimental-readonly");
  assert.equal(chrome.attachModes?.[0]?.mode, "direct");
  assert.equal(chrome.attachModes?.[0]?.source, "user-browser");
  assert.equal(chrome.attachModes?.[1]?.mode, "relay");
  assert.equal(chrome.attachModes?.[1]?.scope, "tab");
  assert.equal(chrome.operations.capabilities, true);
  assert.equal(chrome.operations.diagnostics, true);
  assert.equal(chrome.operations.inspectFrontTab, true);
  assert.equal(chrome.operations.inspectTab, true);
  assert.equal(chrome.operations.listTabs, true);
  assert.equal(chrome.operations.attach, true);
  assert.equal(chrome.operations.resumeSession, true);
  assert.equal(chrome.operations.navigate, false);
  assert.equal(chrome.operations.screenshot, false);
});

test("chrome diagnostics expose discovery candidates and selected endpoint", async () => {
  await withChromeDevtoolsFixture(async (baseUrl) => {
    const service = new AttachService();
    const diagnostics = await service.diagnostics("chrome");

    assert.equal(diagnostics.browser, "chrome");
    assert.equal(diagnostics.supportedFeatures.inspectTabs, true);
    assert.equal(diagnostics.supportedFeatures.attach, true);
    assert.equal(diagnostics.supportedFeatures.navigate, false);
    assert.equal(diagnostics.supportedFeatures.savedSessions, true);
    assert.equal(diagnostics.adapter?.mode, "chrome-devtools-readonly");
    assert.equal(diagnostics.attach?.direct.mode, "direct");
    assert.equal(diagnostics.attach?.direct.scope, "browser");
    assert.equal(diagnostics.attach?.direct.ready, true);
    assert.match(String(diagnostics.attach?.direct.state), /ready|degraded/);
    assert.equal(diagnostics.attach?.relay.mode, "relay");
    assert.equal(diagnostics.attach?.relay.ready, false);
    assert.equal(diagnostics.attach?.relay.state, "unavailable");
    assert.equal(diagnostics.attach?.relay.blockers[0]?.code, "relay_probe_not_configured");
    assert.equal(diagnostics.adapter?.discovery?.selectedBaseUrl, baseUrl);
    assert.match(diagnostics.constraints.join(" "), /read-only/i);
    assert.ok((diagnostics.adapter?.discovery?.candidates.length ?? 0) >= 1);
  });
});

test("chrome relay diagnostics differentiate local probe states and report relay readiness truthfully", async () => {
  await withChromeDevtoolsFixture(async () => {
    await withChromeRelayStateFixture(
      {
        version: "1.0.0",
        updatedAt: "2026-03-28T10:00:00.000Z",
        extensionInstalled: false
      },
      async (statePath) => {
        const service = new AttachService();
        const diagnostics = await service.diagnostics("chrome");

        assert.equal(diagnostics.attach?.relay.ready, false);
        assert.equal(diagnostics.attach?.relay.state, "unavailable");
        assert.equal(diagnostics.attach?.relay.blockers[0]?.code, "relay_extension_not_installed");
        assert.match(diagnostics.attach?.relay.notes?.join(" ") ?? "", new RegExp(statePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    );

    await withChromeRelayStateFixture(
      {
        extensionInstalled: true,
        connected: false
      },
      async () => {
        const service = new AttachService();
        const diagnostics = await service.diagnostics("chrome");

        assert.equal(diagnostics.attach?.relay.state, "unavailable");
        assert.equal(diagnostics.attach?.relay.blockers[0]?.code, "relay_extension_disconnected");
      }
    );

    await withChromeRelayStateFixture(
      {
        extensionInstalled: true,
        connected: true,
        shareRequired: true,
        sharedTab: {
          id: "tab-contradiction"
        }
      },
      async () => {
        const service = new AttachService();
        const diagnostics = await service.diagnostics("chrome");

        assert.equal(diagnostics.attach?.relay.state, "unavailable");
        assert.equal(diagnostics.attach?.relay.blockers[0]?.code, "relay_probe_invalid");
      }
    );

    await withChromeRelayStateFixture(
      {
        extensionInstalled: true,
        connected: true,
        userGestureRequired: true
      },
      async () => {
        const service = new AttachService();
        const diagnostics = await service.diagnostics("chrome");

        assert.equal(diagnostics.attach?.relay.state, "attention-required");
        assert.equal(diagnostics.attach?.relay.blockers[0]?.code, "relay_toolbar_not_clicked");
      }
    );

    await withChromeRelayStateFixture(
      {
        extensionInstalled: true,
        connected: true,
        shareRequired: true
      },
      async () => {
        const service = new AttachService();
        const diagnostics = await service.diagnostics("chrome");

        assert.equal(diagnostics.attach?.relay.state, "attention-required");
        assert.equal(diagnostics.attach?.relay.blockers[0]?.code, "relay_share_required");
      }
    );

    await withChromeRelayStateFixture(
      {
        extensionInstalled: true,
        connected: true,
        sharedTab: null
      },
      async () => {
        const service = new AttachService();
        const diagnostics = await service.diagnostics("chrome");

        assert.equal(diagnostics.attach?.relay.state, "unavailable");
        assert.equal(diagnostics.attach?.relay.blockers[0]?.code, "relay_no_shared_tab");
      }
    );

    await withChromeRelayStateFixture(
      {
        version: "1.1.0",
        updatedAt: "2026-03-28T11:00:00.000Z",
        extensionInstalled: true,
        connected: true,
        sharedTab: {
          id: "tab-123",
          title: "Relay Example",
          url: "https://example.com/shared"
        }
      },
      async () => {
        const service = new AttachService();
        const diagnostics = await service.diagnostics("chrome");

        assert.equal(diagnostics.attach?.relay.ready, true);
        assert.equal(diagnostics.attach?.relay.state, "ready");
        assert.equal(diagnostics.attach?.relay.blockers.length, 0);
        assert.match(diagnostics.attach?.relay.notes?.join(" ") ?? "", /shared tab detected/i);
      }
    );
  });
});

test("chrome relay attach creates a read-only tab-scoped session and resumes when relay state still matches", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "chrome-relay-attach-session");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  await withChromeRelayStateFixture(
    {
      version: "1.1.0",
      updatedAt: "2026-03-28T11:00:00.000Z",
      extensionInstalled: true,
      connected: true,
      resumable: true,
      expiresAt: "2099-03-28T12:00:00.000Z",
      sharedTab: {
        id: "tab-123",
        title: "Relay Example",
        url: "https://example.com/shared"
      }
    },
    async () => {
      const service = new AttachService({
        store: new SessionStore({ filePath: resolve(baseDir, "sessions.json") })
      });

      const session = await service.attach("chrome", {
        target: { type: "front" },
        attach: { mode: "relay" }
      });

      assert.equal(session.kind, "chrome-readonly");
      assert.equal(session.attach.mode, "relay");
      assert.equal(session.attach.source, "extension-relay");
      assert.equal(session.attach.scope, "tab");
      assert.equal(session.attach.resumable, true);
      assert.equal(session.attach.expiresAt, "2099-03-28T12:00:00.000Z");
      assert.equal(session.semantics.inspect, "shared-tab-only");
      assert.equal(session.semantics.resume, "current-shared-tab");
      assert.equal(session.semantics.tabReference.windowIndex, "synthetic-shared-tab-position");
      assert.equal(session.status.state, "read-only");
      assert.equal(session.capabilities.navigate, false);
      assert.equal(session.tab.url, "https://example.com/shared");
      assert.equal(session.target.type, "signature");

      const resumed = await service.resumeSession(session.id);
      assert.equal(resumed.resolution.strategy, "signature");
      assert.equal(resumed.resolution.attachMode, "relay");
      assert.equal(resumed.resolution.semantics, "current-shared-tab");
      assert.equal(resumed.tab.url, "https://example.com/shared");
    }
  );
});

test("chrome relay attach fails with relay-aware errors for unshared or out-of-scope requests", async () => {
  await withChromeRelayStateFixture(
    {
      extensionInstalled: true,
      connected: true,
      shareRequired: true
    },
    async () => {
      const service = new AttachService();
      await assert.rejects(
        () => service.attach("chrome", { target: { type: "front" }, attach: { mode: "relay" } }),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, "relay_share_required");
          assert.equal(error.statusCode, 503);
          return true;
        }
      );
    }
  );

  await withChromeRelayStateFixture(
    {
      extensionInstalled: true,
      connected: true,
      sharedTab: {
        id: "tab-123",
        title: "Relay Example",
        url: "https://example.com/shared"
      }
    },
    async () => {
      const service = new AttachService();
      await assert.rejects(
        () =>
          service.attach("chrome", {
            target: { type: "indexed", windowIndex: 1, tabIndex: 2 },
            attach: { mode: "relay" }
          }),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, "relay_attach_target_out_of_scope");
          assert.equal(error.statusCode, 409);
          return true;
        }
      );
    }
  );
});

test("chrome read-only inspection works while session actions still fail clearly", async () => {
  await withChromeDevtoolsFixture(async () => {
    const service = new AttachService();

    const tabs = await service.listTabs("chrome");
    assert.equal(tabs.length, 2);
    assert.equal(tabs[0].title, "Example One");
    assert.equal(tabs[1].url, "https://example.com/two");
    assert.equal(tabs[1].identity.native?.kind, "chrome-devtools-target");
    assert.equal(tabs[1].identity.native?.targetId, "page-2");

    const front = await service.inspectFrontTab("chrome");
    assert.equal(front.url, "https://example.com/one");

    const resolved = await service.inspectTab("chrome", {
      type: "signature",
      signature: tabs[1].identity.signature,
      url: tabs[1].url,
      title: tabs[1].title
    });
    assert.equal(resolved.title, "Example Two");

    await assert.rejects(
      () => service.activate("chrome"),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "activation_unavailable");
        assert.equal(error.statusCode, 501);
        assert.match(error.message, /not implemented/i);
        return true;
      }
    );

    await assert.rejects(
      () => service.navigate("chrome", { type: "front" }, { url: "https://example.com" }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "navigation_unavailable");
        assert.equal(error.statusCode, 501);
        return true;
      }
    );
  });
});

test("chrome sessions persist native target identity and resume read-only when metadata changes", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "chrome-resume");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  await withChromeDevtoolsFixture(async (_baseUrl, setScenario) => {
    const service = new AttachService({
      store: new SessionStore({ filePath: resolve(baseDir, "sessions.json") })
    });

    const session = await service.attach("chrome", { type: "indexed", windowIndex: 1, tabIndex: 2 });
    assert.equal(session.target.type, "signature");
    assert.equal(session.target.type === "signature" ? session.target.native?.targetId : "", "page-2");
    assert.equal(session.schemaVersion, 1);
    assert.equal(session.kind, "chrome-readonly");
    assert.equal(session.attach.mode, "direct");
    assert.equal(session.attach.source, "user-browser");
    assert.equal(session.attach.scope, "browser");
    assert.equal(session.semantics.inspect, "browser-tabs");
    assert.equal(session.semantics.resume, "saved-browser-target");
    assert.equal(session.semantics.tabReference.tabIndex, "browser-position");
    assert.equal(session.status.state, "read-only");
    assert.equal(session.status.canAct, false);
    assert.equal(session.capabilities.resume, true);
    assert.equal(session.capabilities.activate, false);
    assert.equal(session.capabilities.navigate, false);
    assert.equal(session.capabilities.screenshot, false);

    setScenario("moved");
    const resumed = await service.resumeSession(session.id);

    assert.equal(resumed.resolution.strategy, "native_identity");
    assert.equal(resumed.resolution.attachMode, "direct");
    assert.equal(resumed.resolution.semantics, "saved-browser-target");
    assert.equal(resumed.tab.url, "https://example.com/two-renamed");
    assert.equal(resumed.tab.title, "Retitled Two");
    assert.equal(resumed.tab.identity.native?.targetId, "page-2");
  });
});

test("http and cli surfaces expose chrome read-only details", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "chrome-surfaces");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  await withChromeDevtoolsFixture(async (debugBaseUrl) => {
    await withChromeRelayStateFixture(
      {
        version: "1.1.0",
        updatedAt: "2026-03-28T11:00:00.000Z",
        extensionInstalled: true,
        connected: true,
        resumable: false,
        resumeRequiresUserGesture: true,
        expiresAt: "2099-03-28T12:00:00.000Z",
        sharedTab: {
          id: "tab-123",
          title: "Relay Example",
          url: "https://example.com/shared"
        }
      },
      async () => {
        const service = new AttachService({
          store: new SessionStore({ filePath: resolve(baseDir, "sessions.json") })
        });
        const server = createApiServer(service);
        await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const capabilities = await fetch(`${baseUrl}/v1/capabilities?browser=chrome`);
        assert.equal(capabilities.status, 200);
        const capabilitiesPayload = (await capabilities.json()) as {
          capabilities: {
            schemaVersion: number;
            browsers: Array<{ kind: string; browser: string; maturity: string; attachModes?: Array<{ mode: string; source: string; scope: string }>; operations: { inspectTab: boolean; diagnostics: boolean; attach: boolean; resumeSession: boolean } }>;
          };
        };
        assert.equal(capabilitiesPayload.capabilities.schemaVersion, 1);
        assert.equal(capabilitiesPayload.capabilities.browsers[0].kind, "chrome-readonly");
        assert.equal(capabilitiesPayload.capabilities.browsers[0].browser, "chrome");
        assert.equal(capabilitiesPayload.capabilities.browsers[0].maturity, "experimental-readonly");
        assert.equal(capabilitiesPayload.capabilities.browsers[0].attachModes?.[0]?.mode, "direct");
        assert.equal(capabilitiesPayload.capabilities.browsers[0].attachModes?.[1]?.mode, "relay");
        assert.equal(capabilitiesPayload.capabilities.browsers[0].operations.inspectTab, true);
        assert.equal(capabilitiesPayload.capabilities.browsers[0].operations.diagnostics, true);
        assert.equal(capabilitiesPayload.capabilities.browsers[0].operations.attach, true);
        assert.equal(capabilitiesPayload.capabilities.browsers[0].operations.resumeSession, true);

        const frontTab = await fetch(`${baseUrl}/v1/front-tab?browser=chrome`);
        assert.equal(frontTab.status, 200);
        const frontTabPayload = (await frontTab.json()) as { frontTab: { url: string } };
        assert.equal(frontTabPayload.frontTab.url, "https://example.com/one");

        const diagnostics = await fetch(`${baseUrl}/v1/diagnostics?browser=chrome`);
        assert.equal(diagnostics.status, 200);
        const diagnosticsPayload = (await diagnostics.json()) as {
          diagnostics: { supportedFeatures: { attach: boolean; savedSessions: boolean }; attach?: { direct?: { mode: string; ready: boolean }; relay?: { mode: string; state: string; ready: boolean } }; adapter?: { discovery?: { selectedBaseUrl?: string } } };
        };
        assert.equal(diagnosticsPayload.diagnostics.adapter?.discovery?.selectedBaseUrl, debugBaseUrl);
        assert.equal(diagnosticsPayload.diagnostics.attach?.direct?.mode, "direct");
        assert.equal(diagnosticsPayload.diagnostics.attach?.direct?.ready, true);
        assert.equal(diagnosticsPayload.diagnostics.attach?.relay?.mode, "relay");
        assert.equal(diagnosticsPayload.diagnostics.attach?.relay?.state, "ready");
        assert.equal(diagnosticsPayload.diagnostics.attach?.relay?.ready, true);
        assert.equal(diagnosticsPayload.diagnostics.supportedFeatures.attach, true);
        assert.equal(diagnosticsPayload.diagnostics.supportedFeatures.savedSessions, true);

        const attach = await fetch(`${baseUrl}/v1/attach`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ browser: "chrome", target: { windowIndex: 1, tabIndex: 2 } })
        });
        assert.equal(attach.status, 201);
        const attachPayload = (await attach.json()) as {
          session: {
            schemaVersion: number;
            kind: string;
            attach: { mode: string; source: string; scope: string };
            status: { state: string; canAct: boolean };
            capabilities: { activate: boolean; navigate: boolean; screenshot: boolean };
          };
        };
        assert.equal(attachPayload.session.schemaVersion, 1);
        assert.equal(attachPayload.session.kind, "chrome-readonly");
        assert.equal(attachPayload.session.attach.mode, "direct");
        assert.equal(attachPayload.session.attach.scope, "browser");
        assert.equal(attachPayload.session.status.state, "read-only");
        assert.equal(attachPayload.session.status.canAct, false);
        assert.equal(attachPayload.session.capabilities.activate, false);
        assert.equal(attachPayload.session.capabilities.navigate, false);
        assert.equal(attachPayload.session.capabilities.screenshot, false);

        const relayAttach = await fetch(`${baseUrl}/v1/attach`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ browser: "chrome", attach: { mode: "relay" } })
        });
        assert.equal(relayAttach.status, 201);
        const relayAttachPayload = (await relayAttach.json()) as {
          session: {
            attach: { mode: string; source: string; scope: string; resumable?: boolean; resumeRequiresUserGesture?: boolean; expiresAt?: string };
            semantics: { inspect: string; resume: string; tabReference: { windowIndex: string } };
            tab: { url: string };
          };
        };
        assert.equal(relayAttachPayload.session.attach.mode, "relay");
        assert.equal(relayAttachPayload.session.attach.source, "extension-relay");
        assert.equal(relayAttachPayload.session.attach.scope, "tab");
        assert.equal(relayAttachPayload.session.attach.resumable, false);
        assert.equal(relayAttachPayload.session.attach.resumeRequiresUserGesture, true);
        assert.equal(relayAttachPayload.session.attach.expiresAt, "2099-03-28T12:00:00.000Z");
        assert.equal(relayAttachPayload.session.semantics.inspect, "shared-tab-only");
        assert.equal(relayAttachPayload.session.semantics.resume, "current-shared-tab");
        assert.equal(
          relayAttachPayload.session.semantics.tabReference.windowIndex,
          "synthetic-shared-tab-position"
        );
        assert.equal(relayAttachPayload.session.tab.url, "https://example.com/shared");

        await new Promise<void>((resolvePromise, reject) =>
          server.close((error) => (error ? reject(error) : resolvePromise()))
        );

        const cliCapabilities = await withCapturedStreams(async () => {
          await runCli(["capabilities", "--browser", "chromium"], service);
        });
        const cliCapabilitiesPayload = JSON.parse(cliCapabilities.stdout) as {
          capabilities: { schemaVersion: number; browsers: Array<{ kind: string; browser: string; maturity: string; attachModes?: Array<{ mode: string }> }> };
        };
        assert.equal(cliCapabilitiesPayload.capabilities.schemaVersion, 1);
        assert.equal(cliCapabilitiesPayload.capabilities.browsers[0].kind, "chrome-readonly");
        assert.equal(cliCapabilitiesPayload.capabilities.browsers[0].browser, "chrome");
        assert.equal(cliCapabilitiesPayload.capabilities.browsers[0].maturity, "experimental-readonly");
        assert.equal(cliCapabilitiesPayload.capabilities.browsers[0].attachModes?.[0]?.mode, "direct");

        const cliRelayAttach = await withCapturedStreams(async () => {
          await runCli(["attach", "--browser", "chrome", "--attach-mode", "relay"], service);
        });
        const cliRelayAttachPayload = JSON.parse(cliRelayAttach.stdout) as {
          session: {
            attach: { mode: string; scope: string };
            semantics: { inspect: string; resume: string };
            tab: { url: string };
          };
        };
        assert.equal(cliRelayAttachPayload.session.attach.mode, "relay");
        assert.equal(cliRelayAttachPayload.session.attach.scope, "tab");
        assert.equal(cliRelayAttachPayload.session.semantics.inspect, "shared-tab-only");
        assert.equal(cliRelayAttachPayload.session.semantics.resume, "current-shared-tab");
        assert.equal(cliRelayAttachPayload.session.tab.url, "https://example.com/shared");

        const cliSessions = await withCapturedStreams(async () => {
          await runCli(["sessions"], service);
        });
        const cliSessionsPayload = JSON.parse(cliSessions.stdout) as {
          sessions: Array<{
            schemaVersion: number;
            kind: string;
            attach: { mode: string; source: string; scope: string };
            semantics: { inspect: string; resume: string; tabReference: { tabIndex: string } };
            status: { state: string };
            capabilities: { activate: boolean; navigate: boolean; screenshot: boolean };
          }>;
        };
        assert.equal(cliSessionsPayload.sessions[0].schemaVersion, 1);
        assert.equal(cliSessionsPayload.sessions[0].kind, "chrome-readonly");
        assert.equal(cliSessionsPayload.sessions[0].attach.mode, "relay");
        assert.equal(cliSessionsPayload.sessions[0].semantics.inspect, "shared-tab-only");
        assert.equal(cliSessionsPayload.sessions[0].semantics.resume, "current-shared-tab");
        assert.equal(
          cliSessionsPayload.sessions[0].semantics.tabReference.tabIndex,
          "synthetic-shared-tab-position"
        );
        assert.equal(cliSessionsPayload.sessions[0].status.state, "read-only");
        assert.equal(cliSessionsPayload.sessions[0].capabilities.activate, false);
        assert.equal(cliSessionsPayload.sessions[0].capabilities.navigate, false);
        assert.equal(cliSessionsPayload.sessions[0].capabilities.screenshot, false);
      }
    );
  });
});
