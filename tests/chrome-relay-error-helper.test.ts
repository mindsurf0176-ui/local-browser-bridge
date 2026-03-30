import assert from "node:assert/strict";
import test from "node:test";
import {
  chromeRelayBranchPrompt,
  chromeRelayRetryGuidance,
  chromeRelayScopeNote,
  interpretChromeRelayFailure
} from "../src/chrome-relay-error-helper";

test("interpretChromeRelayFailure maps stable consumer categories without implying browser-wide access", () => {
  const sharedTabScopeFailure = interpretChromeRelayFailure({
    relay: {
      branch: "use-current-shared-tab",
      retryable: true,
      userActionRequired: true,
      phase: "target-selection",
      sharedTabScope: "current-shared-tab",
      currentSharedTabMatches: false
    }
  });

  assert.deepEqual(sharedTabScopeFailure, {
    category: "shared-tab-read-only-scope-limitation",
    retryable: true,
    userActionRequired: true,
    branch: "use-current-shared-tab",
    sharedTabScope: "current-shared-tab",
    scopeLimitedToCurrentSharedTab: true,
    readOnly: true
  });

  const shareRequired = interpretChromeRelayFailure({
    relay: {
      branch: "share-original-tab-again",
      retryable: true,
      userActionRequired: true,
      phase: "session-precondition",
      sharedTabScope: "current-shared-tab"
    }
  });

  assert.equal(shareRequired?.category, "share-required");
  assert.equal(chromeRelayBranchPrompt(shareRequired?.branch), "That shared-tab grant is no longer active. Click the relay extension again on the original tab, then retry resume.");
  assert.equal(
    chromeRelayRetryGuidance(shareRequired),
    "Retry guidance: Wait for the user action to complete, then retry the same relay path."
  );
  assert.equal(
    chromeRelayScopeNote(shareRequired),
    "Scope note: Chrome relay is still limited to the currently shared tab and remains read-only."
  );
});

test("interpretChromeRelayFailure returns retryability fallbacks and handles missing relay details", () => {
  assert.equal(interpretChromeRelayFailure(undefined), undefined);

  const retryable = interpretChromeRelayFailure({
    relay: {
      branch: "unsupported",
      retryable: true,
      userActionRequired: false,
      phase: "diagnostics",
      sharedTabScope: "current-shared-tab"
    }
  });
  assert.equal(retryable?.category, "retryable-relay-failure");
  assert.equal(
    chromeRelayRetryGuidance(retryable),
    "Retry guidance: A targeted retry on the same relay path is reasonable."
  );

  const nonRetryable = interpretChromeRelayFailure({
    relay: {
      branch: "repair-relay-probe",
      retryable: false,
      userActionRequired: false,
      phase: "diagnostics",
      sharedTabScope: "current-shared-tab"
    }
  });
  assert.equal(nonRetryable?.category, "non-retryable-relay-failure");
  assert.equal(
    chromeRelayRetryGuidance(nonRetryable),
    "Retry guidance: Stop automatic retries and surface the relay failure directly."
  );
});
