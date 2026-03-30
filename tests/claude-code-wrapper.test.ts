import assert from "node:assert/strict";
import test from "node:test";

import { createBridgeAdapter, normalizeClaudeCodeRoute, prepareClaudeCodeRoute } from "../src";

function createSharedTabSession() {
  return {
    id: "sess-relay",
    schemaVersion: 1 as const,
    browser: "chrome" as const,
    kind: "chrome-readonly" as const,
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
      resumable: false,
      resumeRequiresUserGesture: true
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
    capabilities: { resume: true as const, activate: false, navigate: false, screenshot: false },
    status: { state: "read-only" as const, canAct: false },
    createdAt: "2026-03-30T12:00:00.000Z"
  };
}

test("normalizeClaudeCodeRoute maps named Claude Code routes onto the shared bridge route contract", () => {
  assert.deepEqual(normalizeClaudeCodeRoute({ route: "safari" }), {
    browser: "safari",
    attachMode: "direct"
  });
  assert.deepEqual(normalizeClaudeCodeRoute({ route: "chrome-direct" }), {
    browser: "chrome",
    attachMode: "direct"
  });
  assert.deepEqual(normalizeClaudeCodeRoute({ route: "chrome-relay", sessionId: "sess-relay" }), {
    browser: "chrome",
    attachMode: "relay",
    sessionId: "sess-relay"
  });
});

test("prepareClaudeCodeRoute returns a prompt and skips attach when the selected route is blocked", async () => {
  const calls: string[] = [];
  const adapter = createBridgeAdapter({
    async getCapabilities() {
      calls.push("capabilities");
      return { schemaVersion: 1 };
    },
    async getDiagnostics(browser) {
      calls.push(`diagnostics:${browser}`);
      return {
        browser,
        checkedAt: "2026-03-30T12:00:00.000Z",
        runtime: { platform: "darwin", arch: "arm64", nodeVersion: "v25.8.0" },
        host: {},
        supportedFeatures: {},
        constraints: [],
        attach: {
          direct: {
            mode: "direct",
            ready: false,
            state: "unavailable",
            blockers: [
              {
                code: "direct_unavailable_attach_endpoint_missing",
                message: "missing local DevTools endpoint"
              }
            ]
          },
          relay: { mode: "relay", ready: true, state: "ready", blockers: [] }
        }
      } as any;
    },
    async attach() {
      calls.push("attach");
      throw new Error("attach should not run");
    },
    async resume() {
      calls.push("resume");
      throw new Error("resume should not run");
    }
  });

  const prepared = await prepareClaudeCodeRoute(adapter, { route: "chrome-direct" });

  assert.equal(prepared.blocked, true);
  assert.equal(prepared.routeUx.state, "blocked");
  assert.match(prepared.prompt ?? "", /Chrome direct attach needs a local DevTools endpoint/i);
  assert.equal(prepared.connection, undefined);
  assert.deepEqual(calls, ["capabilities", "diagnostics:chrome"]);
});

test("prepareClaudeCodeRoute returns a connected shared-tool result for the Claude Code relay path", async () => {
  const calls: string[] = [];
  const adapter = createBridgeAdapter({
    async getCapabilities() {
      calls.push("capabilities");
      return { schemaVersion: 1, product: { name: "local-browser-bridge" } };
    },
    async getDiagnostics(browser) {
      calls.push(`diagnostics:${browser}`);
      return {
        browser,
        checkedAt: "2026-03-30T12:00:00.000Z",
        runtime: { platform: "darwin", arch: "arm64", nodeVersion: "v25.8.0" },
        host: {},
        supportedFeatures: {},
        constraints: [],
        attach: {
          direct: { mode: "direct", ready: false, state: "unavailable", blockers: [] },
          relay: { mode: "relay", ready: true, state: "ready", blockers: [] }
        }
      } as any;
    },
    async attach(route) {
      calls.push(`attach:${route.browser}:${route.attachMode}`);
      return {
        session: createSharedTabSession()
      };
    },
    async resume() {
      calls.push("resume");
      throw new Error("resume should not run");
    }
  });

  const prepared = await prepareClaudeCodeRoute(adapter, { route: "chrome-relay" });

  assert.equal(prepared.blocked, false);
  assert.equal(prepared.connection?.operation, "attach");
  assert.equal(prepared.connection?.routeUx.label, "Chrome (shared tab, read-only)");
  assert.equal(prepared.connection?.sessionUx.sharedTabScoped, true);
  assert.match(prepared.prompt ?? "", /shared-tab grant is no longer active/i);
  assert.deepEqual(calls, ["capabilities", "diagnostics:chrome", "attach:chrome:relay"]);
});
