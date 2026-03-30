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

  const chromeRelayError = await readJson<{
    error: {
      code: string;
      statusCode: number;
      details: {
        context: { browser: string; attachMode: string; operation: string };
        relay: {
          branch: string;
          retryable: boolean;
          userActionRequired: boolean;
          phase: string;
          sharedTabScope: string;
        };
      };
    };
  }>(resolve(root, "examples", "error.chrome-relay-share-required.example.json"));

  assert.equal(chromeRelayError.error.code, "relay_share_required");
  assert.equal(chromeRelayError.error.statusCode, 503);
  assert.equal(chromeRelayError.error.details.context.browser, "chrome");
  assert.equal(chromeRelayError.error.details.context.attachMode, "relay");
  assert.equal(chromeRelayError.error.details.context.operation, "attach");
  assert.equal(chromeRelayError.error.details.relay.branch, "share-tab");
  assert.equal(chromeRelayError.error.details.relay.retryable, true);
  assert.equal(chromeRelayError.error.details.relay.userActionRequired, true);
  assert.equal(chromeRelayError.error.details.relay.phase, "diagnostics");
  assert.equal(chromeRelayError.error.details.relay.sharedTabScope, "current-shared-tab");
});


test("consumer sample stays aligned with the stable contract guidance", async () => {
  const root = process.cwd();
  const sample = await readFile(resolve(root, "examples", "clients", "http-node.ts"), "utf8");
  const httpConsumer = await readFile(resolve(root, "examples", "clients", "http-consumer.ts"), "utf8");
  const cliConsumer = await readFile(resolve(root, "examples", "clients", "cli-consumer.ts"), "utf8");
  const consumerGuide = await readFile(resolve(root, "docs", "consuming-the-bridge.md"), "utf8");
  const adapterPatterns = await readFile(resolve(root, "docs", "adapter-patterns.md"), "utf8");

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
  assert.match(sample, /Derive relay behavior from attach\.mode=relay plus the returned semantics fields\./);
  assert.match(sample, /Tab reference semantics: windowIndex=/);
  assert.match(sample, /Relay failure branch:/);
  assert.match(sample, /Relay user prompt:/);
  assert.match(sample, /sharedTabScope\?: "current-shared-tab"/);
  assert.match(sample, /LOCAL_BROWSER_BRIDGE_SESSION_ID/);
  assert.match(sample, /Hide activate\/navigate\/screenshot\./);
  assert.match(sample, /require\("\.\.\/\.\.\/dist\/src"\) as typeof import\("\.\.\/\.\.\/src"\)/);

  assert.match(httpConsumer, /createHttpBridgeAdapter/);
  assert.match(httpConsumer, /connectViaBridge/);
  assert.match(httpConsumer, /interpretBrowserAttachUxFromError/);
  assert.match(httpConsumer, /chrome-direct/);
  assert.match(httpConsumer, /chrome-relay/);
  assert.match(httpConsumer, /LOCAL_BROWSER_BRIDGE_SESSION_ID/);
  assert.match(httpConsumer, /transport: http/);

  assert.match(cliConsumer, /createCliBridgeAdapter/);
  assert.match(cliConsumer, /connectViaBridge/);
  assert.match(cliConsumer, /interpretBrowserAttachUxFromError/);
  assert.match(cliConsumer, /chrome-direct/);
  assert.match(cliConsumer, /chrome-relay/);
  assert.match(cliConsumer, /LOCAL_BROWSER_BRIDGE_SESSION_ID/);
  assert.match(cliConsumer, /transport: cli/);

  assert.match(consumerGuide, /src\/index\.ts/);
  assert.match(consumerGuide, /import \{ interpretChromeRelayFailure \} from "\.\.\/src"/);
  assert.match(
    consumerGuide,
    /interpretBrowserAttachUxFromSession[\s\S]*from "\.\.\/src"/
  );

  assert.match(consumerGuide, /Chrome relay parity example/);
  assert.match(consumerGuide, /Adapter Patterns/);
  assert.match(consumerGuide, /\.\/adapter-patterns\.md/);
  assert.match(consumerGuide, /schema\/chrome-relay-error\.schema\.json/);
  assert.match(consumerGuide, /examples\/error\.chrome-relay-share-required\.example\.json/);
  assert.match(consumerGuide, /attach --browser chrome --attach-mode relay/);
  assert.match(consumerGuide, /"attach":\{"mode":"relay"\}/);
  assert.match(consumerGuide, /session\.attach/);
  assert.match(consumerGuide, /session\.semantics/);
  assert.match(consumerGuide, /error\.details\.relay\.branch/);
  assert.match(consumerGuide, /error\.details\.relay\.sharedTabScope = "current-shared-tab"/);
  assert.match(consumerGuide, /interpretChromeRelayFailure/);
  assert.match(consumerGuide, /retryable/);
  assert.match(consumerGuide, /examples\/clients\/http-consumer\.ts/);
  assert.match(consumerGuide, /examples\/clients\/cli-consumer\.ts/);
  assert.match(consumerGuide, /createHttpBridgeAdapter/);
  assert.match(consumerGuide, /createCliBridgeAdapter/);
  assert.match(consumerGuide, /connectViaBridge/);
  assert.doesNotMatch(consumerGuide, /OpenClaw\/browser-style consumer demo/);

  assert.match(adapterPatterns, /OpenClaw/);
  assert.match(adapterPatterns, /AWOS/);
  assert.match(adapterPatterns, /Codex/);
  assert.match(adapterPatterns, /Claude Code/);
  assert.match(adapterPatterns, /transport-neutral/i);
  assert.match(adapterPatterns, /agent-agnostic/i);
  assert.match(adapterPatterns, /CLI for one-shot invocation/);
  assert.match(adapterPatterns, /local HTTP for long-running connectors/);
  assert.match(adapterPatterns, /Shared consumer surface/);
  assert.match(adapterPatterns, /from "local-browser-bridge"/);
  assert.match(adapterPatterns, /Minimal adapter skeleton:/);
  assert.match(adapterPatterns, /connectBrowserRoute/);
  assert.match(adapterPatterns, /runBrowserTool/);
  assert.match(adapterPatterns, /runAgentStep/);
  assert.match(adapterPatterns, /prepareToolPrompt/);
  assert.match(adapterPatterns, /export async function connect\(/);
});

test("chrome relay error schema artifact stays documented and aligned with the example", async () => {
  const root = process.cwd();
  const schema = await readJson<{
    $id: string;
    properties?: { error?: { properties?: { details?: { $ref?: string } } } };
  }>(resolve(root, "schema", "chrome-relay-error.schema.json"));
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  const consumerGuide = await readFile(resolve(root, "docs", "consuming-the-bridge.md"), "utf8");
  const adapterPatterns = await readFile(resolve(root, "docs", "adapter-patterns.md"), "utf8");
  const integrationContract = await readFile(resolve(root, "docs", "agent-integration-contract.md"), "utf8");
  const prd = await readFile(resolve(root, "PRD.md"), "utf8");

  assert.match(schema.$id, /chrome-relay-error\.schema\.json$/);
  assert.equal(schema.properties?.error?.properties?.details?.$ref, "#/$defs/chromeRelayErrorDetails");
  assert.match(readme, /schema\/chrome-relay-error\.schema\.json/);
  assert.match(readme, /examples\/error\.chrome-relay-share-required\.example\.json/);
  assert.match(readme, /docs\/adapter-patterns\.md/);
  assert.match(readme, /src\/index\.ts/);
  assert.match(consumerGuide, /\.\/adapter-patterns\.md/);
  assert.match(adapterPatterns, /Agent Integration Contract/);
  assert.match(adapterPatterns, /Consuming local-browser-bridge/);
  assert.match(consumerGuide, /schema\/chrome-relay-error\.schema\.json/);
  assert.match(consumerGuide, /examples\/error\.chrome-relay-share-required\.example\.json/);
  assert.match(integrationContract, /schema\/chrome-relay-error\.schema\.json/);
  assert.match(integrationContract, /examples\/error\.chrome-relay-share-required\.example\.json/);
  assert.match(integrationContract, /additive transport-neutral error envelope/i);
  assert.match(integrationContract, /shared-tab read-only path/i);
  assert.match(prd, /Chrome relay structured failure contract/);
  assert.match(prd, /transport-neutral structured error details aligned across CLI and local HTTP/);
  assert.match(prd, /error\.details\.relay\.sharedTabScope = "current-shared-tab"/);
});
