import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runMcpStdioServer } from "../src";

function createSafariSession() {
  return {
    id: "session-safari-demo",
    schemaVersion: 1 as const,
    kind: "safari-actionable" as const,
    browser: "safari" as const,
    target: { type: "front" as const },
    tab: {
      browser: "safari" as const,
      windowIndex: 1,
      tabIndex: 1,
      title: "Example",
      url: "https://example.com",
      attachedAt: "2026-03-31T00:00:00.000Z",
      identity: {
        signature: "safari-sig",
        urlKey: "https://example.com",
        titleKey: "Example",
        origin: "https://example.com",
        pathname: "/"
      }
    },
    frontTab: {
      browser: "safari" as const,
      windowIndex: 1,
      tabIndex: 1,
      title: "Example",
      url: "https://example.com",
      attachedAt: "2026-03-31T00:00:00.000Z",
      identity: {
        signature: "safari-sig",
        urlKey: "https://example.com",
        titleKey: "Example",
        origin: "https://example.com",
        pathname: "/"
      }
    },
    attach: {
      mode: "direct" as const,
      source: "user-browser" as const,
      scope: "browser" as const
    },
    semantics: {
      inspect: "browser-tabs" as const,
      list: "saved-session" as const,
      resume: "saved-browser-target" as const,
      tabReference: {
        windowIndex: "browser-position" as const,
        tabIndex: "browser-position" as const
      }
    },
    capabilities: { resume: true as const, activate: true, navigate: true, screenshot: true },
    status: { state: "actionable" as const, canAct: true },
    createdAt: "2026-03-31T00:00:00.000Z"
  };
}

function createStubService() {
  return {
    getCapabilities() {
      return { schemaVersion: 1, product: { name: "local-browser-bridge" } } as any;
    },
    async diagnostics(browser: "safari" | "chrome") {
      if (browser === "safari") {
        return {
          browser,
          checkedAt: "2026-03-31T00:00:00.000Z",
          runtime: { platform: "darwin", arch: "arm64", nodeVersion: "v25.8.0" },
          host: {},
          supportedFeatures: {},
          constraints: [],
          preflight: {
            inspect: { ready: true, blockers: [] },
            automation: { ready: true, blockers: [] },
            screenshot: { ready: true, blockers: [] }
          }
        } as any;
      }

      return {
        browser,
        checkedAt: "2026-03-31T00:00:00.000Z",
        runtime: { platform: "darwin", arch: "arm64", nodeVersion: "v25.8.0" },
        host: {},
        supportedFeatures: {},
        constraints: [],
        attach: {
          direct: { mode: "direct", ready: false, state: "unavailable", blockers: [] },
          relay: {
            mode: "relay",
            ready: false,
            state: "unavailable",
            blockers: [
              {
                code: "relay_share_required",
                message: "Share the tab first."
              }
            ]
          }
        }
      } as any;
    },
    async attach(browser: "safari" | "chrome", request?: { attach?: { mode?: "direct" | "relay" } }) {
      if (browser === "safari") {
        return createSafariSession();
      }

      throw new Error(`unexpected attach: ${browser}:${request?.attach?.mode}`);
    },
    async listTabs(browser: "safari" | "chrome") {
      if (browser === "safari") {
        return [
          {
            browser: "safari" as const,
            windowIndex: 1,
            tabIndex: 1,
            title: "Example",
            url: "https://example.com",
            attachedAt: "2026-03-31T00:00:00.000Z",
            identity: {
              signature: "safari-sig",
              urlKey: "https://example.com",
              titleKey: "Example",
              origin: "https://example.com",
              pathname: "/"
            }
          }
        ];
      }

      throw new Error(`unexpected listTabs: ${browser}`);
    },
    async resumeSession() {
      throw new Error("resume should not run in this test");
    }
  };
}

async function createExchange() {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  const lines: string[] = [];
  let buffer = "";

  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      lines.push(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  runMcpStdioServer({ service: createStubService(), input, output, error: stderr });

  async function send(message: Record<string, unknown>) {
    const targetCount = lines.length + 1;
    input.write(JSON.stringify(message) + "\n");
    await waitFor(() => lines.length >= targetCount);
    return JSON.parse(lines[targetCount - 1]) as Record<string, any>;
  }

  return { send, input };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for MCP response");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("MCP stdio server initializes and lists the minimal RC tool surface", async () => {
  const exchange = await createExchange();

  const initialized = await exchange.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });
  assert.equal(initialized.result.protocolVersion, "2025-03-26");
  assert.equal(initialized.result.serverInfo.name, "local-browser-bridge");

  exchange.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = await exchange.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  });

  assert.deepEqual(
    tools.result.tools.map((tool: { name: string }) => tool.name),
    ["browser_doctor", "browser_tabs", "browser_connect"]
  );
});

test("browser_doctor returns structured Chrome relay truth without pretending relay is actionable", async () => {
  const exchange = await createExchange();
  await exchange.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });
  exchange.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const response = await exchange.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "browser_doctor",
      arguments: {
        route: "chrome-relay"
      }
    }
  });

  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.tool, "browser_doctor");
  assert.equal(response.result.structuredContent.ok, false);
  assert.equal(response.result.structuredContent.outcome, "blocked");
  assert.equal(response.result.structuredContent.status, "blocked");
  assert.equal(response.result.structuredContent.category, "route-blocked");
  assert.deepEqual(response.result.structuredContent.reason, {
    code: "relay_share_required",
    message: "Share the tab first."
  });
  assert.equal(response.result.structuredContent.truth.readOnly, true);
  assert.equal(response.result.structuredContent.truth.sharedTabScoped, true);
  assert.deepEqual(
    response.result.structuredContent.truth.unsupportedRuntimeActions,
    ["activate", "navigate", "screenshot"]
  );
  assert.match(response.result.structuredContent.envelope.prompt, /Share the tab first/i);
});

test("browser_connect returns structured Safari session truth for actionable routes", async () => {
  const exchange = await createExchange();
  await exchange.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });
  exchange.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const response = await exchange.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "browser_connect",
      arguments: {
        route: "safari"
      }
    }
  });

  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.tool, "browser_connect");
  assert.equal(response.result.structuredContent.connected, true);
  assert.equal(response.result.structuredContent.outcome, "success");
  assert.equal(response.result.structuredContent.status, "connected");
  assert.equal(response.result.structuredContent.category, "session-connected");
  assert.equal(response.result.structuredContent.truth.actionable, true);
  assert.deepEqual(response.result.structuredContent.truth.unsupportedRuntimeActions, []);
  assert.equal(response.result.structuredContent.envelope.session.id, "session-safari-demo");
  assert.equal(response.result.structuredContent.envelope.session.kind, "safari-actionable");
});

test("browser_tabs lists Safari tabs with structured success payloads", async () => {
  const exchange = await createExchange();
  await exchange.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });
  exchange.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const response = await exchange.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "browser_tabs",
      arguments: {
        route: "safari"
      }
    }
  });

  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.tool, "browser_tabs");
  assert.equal(response.result.structuredContent.ok, true);
  assert.equal(response.result.structuredContent.blocked, false);
  assert.equal(response.result.structuredContent.outcome, "success");
  assert.equal(response.result.structuredContent.status, "listed");
  assert.equal(response.result.structuredContent.category, "tab-list");
  assert.equal(response.result.structuredContent.count, 1);
  assert.equal(response.result.structuredContent.truth.actionable, true);
  assert.equal(response.result.structuredContent.truth.sharedTabScoped, false);
  assert.equal(response.result.structuredContent.tabs[0].title, "Example");
});

test("browser_tabs returns a structured blocked result for chrome-relay without marking it as an error", async () => {
  const exchange = await createExchange();
  await exchange.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });
  exchange.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const response = await exchange.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "browser_tabs",
      arguments: {
        route: "chrome-relay"
      }
    }
  });

  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.tool, "browser_tabs");
  assert.equal(response.result.structuredContent.ok, false);
  assert.equal(response.result.structuredContent.blocked, true);
  assert.equal(response.result.structuredContent.outcome, "unsupported");
  assert.equal(response.result.structuredContent.status, "unsupported");
  assert.equal(response.result.structuredContent.category, "shared-tab-scope");
  assert.equal(response.result.structuredContent.truth.readOnly, true);
  assert.equal(response.result.structuredContent.truth.sharedTabScoped, true);
  assert.deepEqual(response.result.structuredContent.supportedRoutes, ["safari", "chrome-direct"]);
  assert.equal(response.result.structuredContent.blockedReason.code, "shared_tab_scope_only");
  assert.deepEqual(response.result.structuredContent.reason, response.result.structuredContent.blockedReason);
});
