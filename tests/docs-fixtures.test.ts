import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

test("documentation fixtures preserve the stable contract examples", async () => {
  const root = process.cwd();

  const capabilities = await readJson<{
    capabilities: {
      schemaVersion: number;
      product: { summary: string };
      browsers: Array<{
        browser: string;
        kind: string;
        bridge: { implementation: string };
        attachModes?: Array<{ mode: string; source: string; scope: string; supported: boolean; readiness?: string }>;
        operations: { activate: boolean; navigate: boolean; screenshot: boolean; resumeSession: boolean };
      }>;
    };
  }>(resolve(root, "examples", "capabilities.example.json"));

  assert.equal(capabilities.capabilities.schemaVersion, 1);
  assert.equal(
    capabilities.capabilities.product.summary,
    "Reusable, agent-agnostic local browser bridge with honest capability signaling. Safari is actionable; Chrome/Chromium is read-only in v1."
  );

  const safari = capabilities.capabilities.browsers.find((browser) => browser.browser === "safari");
  const chrome = capabilities.capabilities.browsers.find((browser) => browser.browser === "chrome");

  assert.ok(safari);
  assert.ok(chrome);
  assert.equal(safari.kind, "safari-actionable");
  assert.equal(safari.attachModes?.[0]?.mode, "direct");
  assert.equal(safari.attachModes?.[0]?.source, "user-browser");
  assert.equal(safari.attachModes?.[0]?.scope, "browser");
  assert.equal(safari.operations.resumeSession, true);
  assert.equal(safari.operations.activate, true);
  assert.equal(safari.operations.navigate, true);
  assert.equal(safari.operations.screenshot, true);

  assert.equal(chrome.kind, "chrome-readonly");
  assert.match(chrome.bridge.implementation, /read-only in v1/i);
  assert.equal(chrome.attachModes?.[0]?.mode, "direct");
  assert.equal(chrome.attachModes?.[1]?.mode, "relay");
  assert.equal(chrome.attachModes?.[1]?.scope, "tab");
  assert.equal(chrome.operations.resumeSession, true);
  assert.equal(chrome.operations.activate, false);
  assert.equal(chrome.operations.navigate, false);
  assert.equal(chrome.operations.screenshot, false);

  const safariSession = await readJson<{
    session: {
      schemaVersion: number;
      kind: string;
      attach: { mode: string; source: string; scope: string };
      semantics: { inspect: string; resume: string; tabReference: { windowIndex: string; tabIndex: string } };
      status: { state: string; canAct: boolean };
      capabilities: { activate: boolean; navigate: boolean; screenshot: boolean; resume: boolean };
    };
  }>(resolve(root, "examples", "session.safari-actionable.example.json"));

  assert.equal(safariSession.session.schemaVersion, 1);
  assert.equal(safariSession.session.kind, "safari-actionable");
  assert.equal(safariSession.session.attach.mode, "direct");
  assert.equal(safariSession.session.attach.scope, "browser");
  assert.equal(safariSession.session.semantics.inspect, "browser-tabs");
  assert.equal(safariSession.session.semantics.resume, "saved-browser-target");
  assert.equal(safariSession.session.semantics.tabReference.windowIndex, "browser-position");
  assert.equal(safariSession.session.status.state, "actionable");
  assert.equal(safariSession.session.status.canAct, true);
  assert.equal(safariSession.session.capabilities.resume, true);
  assert.equal(safariSession.session.capabilities.activate, true);
  assert.equal(safariSession.session.capabilities.navigate, true);
  assert.equal(safariSession.session.capabilities.screenshot, true);

  const chromeSession = await readJson<{
    session: {
      schemaVersion: number;
      kind: string;
      attach: { mode: string; source: string; scope: string };
      semantics: { inspect: string; resume: string; tabReference: { windowIndex: string; tabIndex: string } };
      status: { state: string; canAct: boolean };
      capabilities: { activate: boolean; navigate: boolean; screenshot: boolean; resume: boolean };
    };
  }>(resolve(root, "examples", "session.chrome-readonly.example.json"));

  assert.equal(chromeSession.session.schemaVersion, 1);
  assert.equal(chromeSession.session.kind, "chrome-readonly");
  assert.equal(chromeSession.session.attach.mode, "direct");
  assert.equal(chromeSession.session.attach.source, "user-browser");
  assert.equal(chromeSession.session.semantics.inspect, "browser-tabs");
  assert.equal(chromeSession.session.semantics.resume, "saved-browser-target");
  assert.equal(chromeSession.session.semantics.tabReference.tabIndex, "browser-position");
  assert.equal(chromeSession.session.status.state, "read-only");
  assert.equal(chromeSession.session.status.canAct, false);
  assert.equal(chromeSession.session.capabilities.resume, true);
  assert.equal(chromeSession.session.capabilities.activate, false);
  assert.equal(chromeSession.session.capabilities.navigate, false);
  assert.equal(chromeSession.session.capabilities.screenshot, false);

  const chromeRelaySession = await readJson<{
    session: {
      schemaVersion: number;
      kind: string;
      attach: { mode: string; source: string; scope: string; resumeRequiresUserGesture?: boolean };
      semantics: {
        inspect: string;
        resume: string;
        tabReference: { windowIndex: string; tabIndex: string };
        notes?: string[];
      };
      status: { state: string; canAct: boolean };
      capabilities: { activate: boolean; navigate: boolean; screenshot: boolean; resume: boolean };
    };
  }>(resolve(root, "examples", "session.chrome-relay-readonly.example.json"));

  assert.equal(chromeRelaySession.session.schemaVersion, 1);
  assert.equal(chromeRelaySession.session.kind, "chrome-readonly");
  assert.equal(chromeRelaySession.session.attach.mode, "relay");
  assert.equal(chromeRelaySession.session.attach.source, "extension-relay");
  assert.equal(chromeRelaySession.session.attach.scope, "tab");
  assert.equal(chromeRelaySession.session.attach.resumeRequiresUserGesture, true);
  assert.equal(chromeRelaySession.session.semantics.inspect, "shared-tab-only");
  assert.equal(chromeRelaySession.session.semantics.resume, "current-shared-tab");
  assert.equal(
    chromeRelaySession.session.semantics.tabReference.windowIndex,
    "synthetic-shared-tab-position"
  );
  assert.match(chromeRelaySession.session.semantics.notes?.[0] ?? "", /last tab explicitly shared/i);
  assert.equal(chromeRelaySession.session.status.state, "read-only");
  assert.equal(chromeRelaySession.session.status.canAct, false);
  assert.equal(chromeRelaySession.session.capabilities.resume, true);
  assert.equal(chromeRelaySession.session.capabilities.activate, false);
  assert.equal(chromeRelaySession.session.capabilities.navigate, false);
  assert.equal(chromeRelaySession.session.capabilities.screenshot, false);
});


test("consumer sample stays aligned with the stable contract guidance", async () => {
  const root = process.cwd();
  const sample = await readFile(resolve(root, "examples", "clients", "http-node.ts"), "utf8");

  assert.match(sample, /schemaVersion !== 1/);
  assert.match(sample, /chrome-direct/);
  assert.match(sample, /chrome-relay/);
  assert.match(sample, /\/v1\/diagnostics\?browser=/);
  assert.match(sample, /Safari \(actionable\)/);
  assert.match(sample, /Chrome \(direct, read-only\)/);
  assert.match(sample, /Chrome \(shared tab, read-only\)/);
  assert.match(sample, /Chrome direct attach needs a local DevTools endpoint/);
  assert.match(sample, /Chrome relay only works for a tab you explicitly share/);
  assert.match(sample, /does not silently fall back between Chrome direct and relay/);
  assert.match(sample, /LOCAL_BROWSER_BRIDGE_SESSION_ID/);
  assert.match(sample, /Hide activate\/navigate\/screenshot\./);
});
