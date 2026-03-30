import assert from "node:assert/strict";
import test from "node:test";

import { connectCodexViaCli, connectCodexViaHttp, normalizeCodexRoute } from "../src/codex";

const capabilities = {
  schemaVersion: 1,
  kind: "local-browser-bridge",
  product: { name: "local-browser-bridge", version: "0.1.0" }
};

const diagnostics = {
  browser: "chrome" as const,
  checkedAt: "2026-03-30T12:00:00.000Z",
  runtime: {
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "v25.8.0",
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
  constraints: [],
  attach: {
    direct: {
      mode: "direct" as const,
      source: "user-browser" as const,
      scope: "browser" as const,
      supported: true,
      ready: false,
      state: "attention-required" as const,
      blockers: []
    },
    relay: {
      mode: "relay" as const,
      source: "extension-relay" as const,
      scope: "tab" as const,
      supported: true,
      ready: true,
      state: "ready" as const,
      blockers: []
    }
  }
};

const session = {
  schemaVersion: 1 as const,
  id: "sess-codex-relay",
  kind: "chrome-readonly" as const,
  browser: "chrome" as const,
  target: { type: "front" as const },
  tab: {
    browser: "chrome" as const,
    windowIndex: 1,
    tabIndex: 1,
    title: "Shared tab",
    url: "https://example.com",
    attachedAt: "2026-03-30T12:00:00.000Z",
    identity: {
      signature: "sig",
      urlKey: "https://example.com",
      titleKey: "Shared tab",
      origin: "https://example.com",
      pathname: "/"
    }
  },
  frontTab: {
    browser: "chrome" as const,
    windowIndex: 1,
    tabIndex: 1,
    title: "Shared tab",
    url: "https://example.com",
    attachedAt: "2026-03-30T12:00:00.000Z",
    identity: {
      signature: "sig",
      urlKey: "https://example.com",
      titleKey: "Shared tab",
      origin: "https://example.com",
      pathname: "/"
    }
  },
  attach: {
    mode: "relay" as const,
    source: "extension-relay" as const,
    scope: "tab" as const,
    resumable: true
  },
  semantics: {
    inspect: "shared-tab-only" as const,
    list: "saved-session" as const,
    resume: "current-shared-tab" as const,
    tabReference: {
      windowIndex: "synthetic-shared-tab-position" as const,
      tabIndex: "synthetic-shared-tab-position" as const
    }
  },
  capabilities: {
    resume: true as const,
    activate: false,
    navigate: false,
    screenshot: false
  },
  status: {
    state: "read-only" as const,
    canAct: false
  },
  createdAt: "2026-03-30T12:00:00.000Z"
};

const resumedSession = {
  session: {
    ...session,
    id: "sess-codex-relay-resumed"
  },
  tab: session.tab,
  resumedAt: "2026-03-30T12:05:00.000Z",
  resolution: {
    strategy: "front" as const,
    matched: true,
    attachMode: "relay" as const,
    semantics: "current-shared-tab" as const
  }
};

test("normalizeCodexRoute maps Codex route names into bridge routes", () => {
  assert.deepEqual(normalizeCodexRoute("safari"), {
    browser: "safari",
    attachMode: "direct"
  });
  assert.deepEqual(normalizeCodexRoute("chrome-direct"), {
    browser: "chrome",
    attachMode: "direct"
  });
  assert.deepEqual(normalizeCodexRoute("chrome-relay", "sess-1"), {
    browser: "chrome",
    attachMode: "relay",
    sessionId: "sess-1"
  });
});

test("connectCodexViaHttp reuses the shared HTTP adapter and route flow", async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];

  const connection = await connectCodexViaHttp({
    route: "chrome-relay",
    async execute(request) {
      requests.push(request);

      if (request.method === "GET" && request.path === "/v1/capabilities") {
        return { body: { capabilities } };
      }
      if (request.method === "GET" && request.path === "/v1/diagnostics?browser=chrome") {
        return { body: { diagnostics } };
      }
      if (request.method === "POST" && request.path === "/v1/attach") {
        return { body: { session } };
      }

      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    }
  });

  assert.equal(connection.operation, "attach");
  assert.equal(connection.routeUx.label, "Chrome (shared tab, read-only)");
  assert.equal(connection.session.id, "sess-codex-relay");
  assert.deepEqual(requests, [
    { method: "GET", path: "/v1/capabilities" },
    { method: "GET", path: "/v1/diagnostics?browser=chrome" },
    {
      method: "POST",
      path: "/v1/attach",
      body: { browser: "chrome", attach: { mode: "relay" } }
    }
  ]);
});

test("connectCodexViaCli reuses the shared CLI adapter and resume flow", async () => {
  const commands: string[][] = [];

  const connection = await connectCodexViaCli({
    route: "chrome-relay",
    sessionId: "sess-codex-relay-resumed",
    async execute(command) {
      commands.push(command.args);

      if (command.args[0] === "capabilities") {
        return { stdout: JSON.stringify({ capabilities }) };
      }
      if (command.args[0] === "diagnostics") {
        return { stdout: JSON.stringify({ diagnostics }) };
      }
      if (command.args[0] === "resume") {
        return { stdout: JSON.stringify({ resumedSession }) };
      }

      throw new Error(`Unexpected command: ${command.args.join(" ")}`);
    }
  });

  assert.equal(connection.operation, "resumeSession");
  assert.equal(connection.session.id, "sess-codex-relay-resumed");
  assert.equal(connection.sessionUx.sharedTabScoped, true);
  assert.deepEqual(commands, [
    ["capabilities"],
    ["diagnostics", "--browser", "chrome"],
    ["resume", "--id", "sess-codex-relay-resumed"]
  ]);
});
