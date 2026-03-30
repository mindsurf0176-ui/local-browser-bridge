import assert from "node:assert/strict";
import test from "node:test";

import { connectViaBridge, createBridgeAdapter, sessionFromBridgeResult } from "../src/reference-adapter";

test("connectViaBridge preserves a transport-neutral adapter loop for attach", async () => {
  const adapter = createBridgeAdapter({
    async getCapabilities() {
      return { schemaVersion: 1, product: { name: "test-bridge" } };
    },
    async getDiagnostics(browser: "safari" | "chrome") {
      return {
        browser,
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
            mode: "direct",
            source: "user-browser",
            scope: "browser",
            supported: true,
            ready: true,
            state: "ready",
            blockers: []
          },
          relay: {
            mode: "relay",
            source: "extension-relay",
            scope: "tab",
            supported: true,
            ready: false,
            state: "attention-required",
            blockers: []
          }
        }
      };
    },
    async attach({ browser, attachMode }: { browser: "safari" | "chrome"; attachMode?: "direct" | "relay" }) {
      assert.equal(browser, "chrome");
      assert.equal(attachMode, "relay");

      return {
        session: {
          schemaVersion: 1 as const,
          id: "sess-1",
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
        }
      };
    },
    async resume() {
      throw new Error("resume should not be called");
    }
  });

  const result = await connectViaBridge(adapter, {
    browser: "chrome",
    attachMode: "relay"
  });

  assert.equal(result.operation, "attach");
  assert.equal(result.routeUx.label, "Chrome (shared tab, read-only)");
  assert.equal(result.sessionUx.sharedTabScoped, true);
  assert.equal(result.session.id, "sess-1");
  assert.equal(result.capabilities.schemaVersion, 1);
});

test("sessionFromBridgeResult supports raw sessions and resumed-session envelopes", () => {
  const rawSession = {
    schemaVersion: 1 as const,
    id: "sess-raw",
    kind: "safari-actionable" as const,
    browser: "safari" as const,
    target: { type: "front" as const },
    tab: {
      browser: "safari" as const,
      windowIndex: 1,
      tabIndex: 1,
      title: "Example",
      url: "https://example.com",
      attachedAt: "2026-03-30T12:00:00.000Z",
      identity: {
        signature: "sig",
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
      attachedAt: "2026-03-30T12:00:00.000Z",
      identity: {
        signature: "sig",
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
    capabilities: {
      resume: true as const,
      activate: true,
      navigate: true,
      screenshot: true
    },
    status: {
      state: "actionable" as const,
      canAct: true
    },
    createdAt: "2026-03-30T12:00:00.000Z"
  };

  assert.equal(sessionFromBridgeResult(rawSession).id, "sess-raw");
  assert.equal(
    sessionFromBridgeResult({
      session: rawSession,
      tab: rawSession.tab,
      resumedAt: "2026-03-30T12:05:00.000Z",
      resolution: {
        strategy: "front",
        matched: true,
        attachMode: "direct",
        semantics: "saved-browser-target"
      }
    }).id,
    "sess-raw"
  );
});
