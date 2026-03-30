import type {
  ChromeRelayErrorDetails,
  ChromeRelayErrorRelayDetails,
  ChromeRelayFailureBranch,
  ChromeRelaySharedTabScope
} from "./types";

/**
 * Stable consumer utility for interpreting additive Chrome relay failure details
 * into a transport-neutral branching shape.
 */

export type ChromeRelayFailureCategory =
  | "share-required"
  | "user-action-required"
  | "retryable-relay-failure"
  | "non-retryable-relay-failure"
  | "shared-tab-read-only-scope-limitation";

export interface ChromeRelayFailureInterpretation {
  category: ChromeRelayFailureCategory;
  retryable: boolean | undefined;
  userActionRequired: boolean | undefined;
  branch: ChromeRelayFailureBranch | undefined;
  sharedTabScope: ChromeRelaySharedTabScope | undefined;
  scopeLimitedToCurrentSharedTab: boolean;
  readOnly: true;
}

function categoryFromRelay(relay: Partial<ChromeRelayErrorRelayDetails>): ChromeRelayFailureCategory {
  if (relay.branch === "share-tab" || relay.branch === "share-original-tab-again") {
    return "share-required";
  }

  if (relay.branch === "use-current-shared-tab") {
    return "shared-tab-read-only-scope-limitation";
  }

  if (relay.userActionRequired) {
    return "user-action-required";
  }

  if (relay.retryable === false) {
    return "non-retryable-relay-failure";
  }

  return "retryable-relay-failure";
}

export function interpretChromeRelayFailure(
  details: Pick<ChromeRelayErrorDetails, "relay"> | ChromeRelayErrorDetails | null | undefined
): ChromeRelayFailureInterpretation | undefined {
  const relay = details?.relay;
  if (!relay) {
    return undefined;
  }

  return {
    category: categoryFromRelay(relay),
    retryable: relay.retryable,
    userActionRequired: relay.userActionRequired,
    branch: relay.branch,
    sharedTabScope: relay.sharedTabScope,
    scopeLimitedToCurrentSharedTab: relay.sharedTabScope === "current-shared-tab",
    readOnly: true
  };
}

export function chromeRelayBranchPrompt(branch: ChromeRelayFailureBranch | undefined): string | undefined {
  switch (branch) {
    case "click-toolbar-button":
      return "To connect this Chrome tab, click the relay extension button on the tab you want to share.";
    case "share-tab":
      return "Chrome relay only works for a tab you explicitly share. Share the tab first, then retry.";
    case "share-original-tab-again":
      return "That shared-tab grant is no longer active. Click the relay extension again on the original tab, then retry resume.";
    case "use-current-shared-tab":
      return "Chrome relay attach only works for the tab that is currently shared. Use the shared tab or share a different tab first.";
    case "install-extension":
      return "Install the Chrome relay extension on this machine, then retry.";
    case "reconnect-extension":
      return "Reconnect or re-enable the Chrome relay extension, then retry.";
    case "configure-relay-probe":
      return "Configure a local Chrome relay state probe for this bridge instance before using relay attach.";
    case "repair-relay-probe":
      return "Fix the local Chrome relay state file so it is valid JSON again, then retry.";
    default:
      return undefined;
  }
}

export function chromeRelayRetryGuidance(
  interpretation: Pick<ChromeRelayFailureInterpretation, "retryable" | "userActionRequired"> | null | undefined
): string | undefined {
  if (!interpretation) {
    return undefined;
  }

  if (interpretation.retryable === false) {
    return "Retry guidance: Stop automatic retries and surface the relay failure directly.";
  }

  if (interpretation.retryable === true) {
    return interpretation.userActionRequired
      ? "Retry guidance: Wait for the user action to complete, then retry the same relay path."
      : "Retry guidance: A targeted retry on the same relay path is reasonable.";
  }

  return undefined;
}

export function chromeRelayScopeNote(
  interpretation: Pick<ChromeRelayFailureInterpretation, "scopeLimitedToCurrentSharedTab"> | null | undefined
): string | undefined {
  if (!interpretation?.scopeLimitedToCurrentSharedTab) {
    return undefined;
  }

  return "Scope note: Chrome relay is still limited to the currently shared tab and remains read-only.";
}
