import assert from "node:assert/strict";
import test from "node:test";
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession
} from "../src/browser-attach-ux-helper";

test("interpretBrowserAttachUxFromDiagnostics maps chrome relay readiness into a shared-tab-scoped blocked state", () => {
  const interpretation = interpretBrowserAttachUxFromDiagnostics({
    browser: "chrome",
    attachMode: "relay",
    diagnostics: {
      browser: "chrome",
      checkedAt: "2026-03-30T12:00:00.000Z",
      runtime: {
        platform: "darwin",
        arch: "arm64",
        nodeVersion: "v25.8.0",
        safariRunning: false
      },
      host: {
        osascriptAvailable: true,
        screencaptureAvailable: true,
        safariApplicationAvailable: true
      },
      supportedFeatures: {
        inspectTabs: true,
        attach: true,
        activate: false,
        navigate: false,
        screenshot: false,
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
          blockers: [{ code: "relay_share_required", message: "share the tab first" }]
        }
      }
    }
  });

  assert.deepEqual(interpretation, {
    state: "blocked",
    browser: "chrome",
    attachMode: "relay",
    operation: "attach",
    label: "Chrome (shared tab, read-only)",
    readOnly: true,
    sharedTabScoped: true,
    readiness: "attention-required",
    prompt: "Chrome relay only works for a tab you explicitly share. Share the tab first, then retry.",
    scopeNote: "Scope note: Chrome relay is still limited to the currently shared tab and remains read-only.",
    retryGuidance: undefined,
    retryable: undefined,
    userActionRequired: undefined,
    relayFailureCategory: undefined
  });
});

test("interpretBrowserAttachUxFromSession preserves shared-tab resume honesty", () => {
  const interpretation = interpretBrowserAttachUxFromSession({
    operation: "resumeSession",
    session: {
      browser: "chrome",
      kind: "chrome-readonly",
      attach: {
        mode: "relay",
        source: "extension-relay",
        scope: "tab",
        resumable: false,
        resumeRequiresUserGesture: true
      },
      semantics: {
        inspect: "shared-tab-only",
        list: "saved-session",
        resume: "current-shared-tab",
        tabReference: {
          windowIndex: "synthetic-shared-tab-position",
          tabIndex: "synthetic-shared-tab-position"
        }
      },
      status: { state: "read-only", canAct: false }
    }
  });

  assert.equal(interpretation.state, "resumed");
  assert.equal(interpretation.label, "Chrome (shared tab, read-only)");
  assert.equal(interpretation.readOnly, true);
  assert.equal(interpretation.sharedTabScoped, true);
  assert.equal(
    interpretation.prompt,
    "That shared-tab grant is no longer active. Click the relay extension again on the original tab, then retry resume."
  );
  assert.equal(
    interpretation.scopeNote,
    "Scope note: Chrome relay is still limited to the currently shared tab and remains read-only."
  );
});

test("interpretBrowserAttachUxFromError reuses structured relay failure interpretation", () => {
  const interpretation = interpretBrowserAttachUxFromError({
    details: {
      context: { browser: "chrome", attachMode: "relay", operation: "resumeSession" },
      relay: {
        branch: "use-current-shared-tab",
        retryable: true,
        userActionRequired: true,
        phase: "shared-tab-match",
        sharedTabScope: "current-shared-tab",
        currentSharedTabMatches: false
      }
    }
  });

  assert.deepEqual(interpretation, {
    state: "user-action-required",
    browser: "chrome",
    attachMode: "relay",
    operation: "resumeSession",
    label: "Chrome (shared tab, read-only)",
    readOnly: true,
    sharedTabScoped: true,
    readiness: undefined,
    prompt: "Chrome relay attach only works for the tab that is currently shared. Use the shared tab or share a different tab first.",
    scopeNote: "Scope note: Chrome relay is still limited to the currently shared tab and remains read-only.",
    retryGuidance: "Retry guidance: Wait for the user action to complete, then retry the same relay path.",
    retryable: true,
    userActionRequired: true,
    relayFailureCategory: "shared-tab-read-only-scope-limitation"
  });
});
