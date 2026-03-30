import assert from "node:assert/strict";
import test from "node:test";

import {
  chromeRelayBranchPrompt,
  chromeRelayRetryGuidance,
  chromeRelayScopeNote,
  connectViaBridge,
  createBridgeAdapter,
  createCliBridgeAdapter,
  createHttpBridgeAdapter,
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession,
  interpretChromeRelayFailure,
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
  assert.equal(typeof sessionFromBridgeResult, "function");
  assert.equal(typeof connectViaBridge, "function");
});
