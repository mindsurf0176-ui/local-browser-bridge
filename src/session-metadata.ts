import { getBrowserCapabilityDescriptor } from "./capabilities";
import type {
  AttachmentSession,
  AttachmentSessionSemantics,
  AttachmentSessionCapabilities,
  AttachmentSessionStatus,
  BrowserAttachMode,
  SessionAttachMetadata,
  SessionKind,
  SupportedBrowser
} from "./types";

type AttachmentSessionRecord = Omit<
  AttachmentSession,
  "schemaVersion" | "kind" | "capabilities" | "status" | "attach" | "semantics"
> &
  Partial<Pick<AttachmentSession, "schemaVersion" | "kind" | "capabilities" | "status" | "attach" | "semantics">>;

function buildSessionKind(browser: SupportedBrowser): SessionKind {
  return getBrowserCapabilityDescriptor(browser).kind;
}

function buildSessionCapabilities(browser: SupportedBrowser): AttachmentSessionCapabilities {
  const descriptor = getBrowserCapabilityDescriptor(browser);

  return {
    resume: true,
    activate: descriptor.operations.activate,
    navigate: descriptor.operations.navigate,
    screenshot: descriptor.operations.screenshot
  };
}

function buildSessionStatus(capabilities: AttachmentSessionCapabilities): AttachmentSessionStatus {
  const canAct = capabilities.activate || capabilities.navigate || capabilities.screenshot;
  return {
    state: canAct ? "actionable" : "read-only",
    canAct
  };
}

function buildSessionSemantics(
  browser: SupportedBrowser,
  attach: SessionAttachMetadata
): AttachmentSessionSemantics {
  if (browser === "chrome" && attach.mode === "relay") {
    return {
      inspect: "shared-tab-only",
      list: "saved-session",
      resume: "current-shared-tab",
      tabReference: {
        windowIndex: "synthetic-shared-tab-position",
        tabIndex: "synthetic-shared-tab-position"
      },
      notes: [
        "Relay sessions describe the last tab explicitly shared through the extension, not general Chrome tab visibility.",
        "Resume only checks the currently shared relay tab and may require the user to share the tab again."
      ]
    };
  }

  return {
    inspect: "browser-tabs",
    list: "saved-session",
    resume: "saved-browser-target",
    tabReference: {
      windowIndex: "browser-position",
      tabIndex: "browser-position"
    }
  };
}

function defaultAttachMode(browser: SupportedBrowser): BrowserAttachMode {
  return browser === "chrome" ? "direct" : "direct";
}

function buildSessionAttach(browser: SupportedBrowser, existing?: Partial<SessionAttachMetadata>): SessionAttachMetadata {
  const mode = existing?.mode ?? defaultAttachMode(browser);

  if (browser === "chrome") {
    return {
      mode,
      source: existing?.source ?? (mode === "relay" ? "extension-relay" : "user-browser"),
      scope: existing?.scope ?? (mode === "relay" ? "tab" : "browser"),
      resumable: existing?.resumable,
      expiresAt: existing?.expiresAt,
      resumeRequiresUserGesture: existing?.resumeRequiresUserGesture,
      trustedAt: existing?.trustedAt
    };
  }

  return {
    mode: "direct",
    source: existing?.source ?? "user-browser",
    scope: existing?.scope ?? "browser",
    resumable: existing?.resumable,
    expiresAt: existing?.expiresAt,
    resumeRequiresUserGesture: existing?.resumeRequiresUserGesture,
    trustedAt: existing?.trustedAt
  };
}

export function normalizeAttachmentSession(session: AttachmentSessionRecord): AttachmentSession {
  const attach = buildSessionAttach(session.browser, session.attach);
  const capabilities = buildSessionCapabilities(session.browser);

  return {
    ...session,
    schemaVersion: 1,
    kind: buildSessionKind(session.browser),
    attach,
    semantics: buildSessionSemantics(session.browser, attach),
    capabilities,
    status: buildSessionStatus(capabilities)
  };
}
