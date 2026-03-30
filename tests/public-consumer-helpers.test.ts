import assert from "node:assert/strict";
import test from "node:test";

import {
  chromeRelayBranchPrompt,
  chromeRelayRetryGuidance,
  chromeRelayScopeNote,
  connectCodexViaCli,
  connectCodexViaHttp,
  connectViaBridge,
  createBridgeAdapter,
  createCliBridgeAdapter,
  createHttpBridgeAdapter,
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession,
  interpretChromeRelayFailure,
  normalizeClaudeCodeRoute,
  normalizeCodexRoute,
  prepareClaudeCodeRoute,
  sessionFromBridgeResult
} from "../src";

test("public consumer entrypoint re-exports the stable helper surface", () => {
  assert.equal(typeof interpretChromeRelayFailure, "function");
  assert.equal(typeof chromeRelayBranchPrompt, "function");
  assert.equal(typeof chromeRelayRetryGuidance, "function");
  assert.equal(typeof chromeRelayScopeNote, "function");
  assert.equal(typeof interpretBrowserAttachUxFromDiagnostics, "function");
  assert.equal(typeof interpretBrowserAttachUxFromSession, "function");
  assert.equal(typeof interpretBrowserAttachUxFromError, "function");
  assert.equal(typeof createBridgeAdapter, "function");
  assert.equal(typeof createHttpBridgeAdapter, "function");
  assert.equal(typeof createCliBridgeAdapter, "function");
  assert.equal(typeof normalizeCodexRoute, "function");
  assert.equal(typeof connectCodexViaHttp, "function");
  assert.equal(typeof connectCodexViaCli, "function");
  assert.equal(typeof normalizeClaudeCodeRoute, "function");
  assert.equal(typeof prepareClaudeCodeRoute, "function");
  assert.equal(typeof sessionFromBridgeResult, "function");
  assert.equal(typeof connectViaBridge, "function");
});
