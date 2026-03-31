import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { getBrowserAdapter } from "../browser";
import { getBridgeCapabilities } from "../capabilities";
import { resolveChromeRelayAttach, resumeChromeRelaySession } from "../browser/chrome";
import { AppError } from "../errors";
import { normalizeAttachmentSession } from "../session-metadata";
import type {
  ActivationArtifact,
  AttachRequest,
  AttachmentSession,
  BrowserAdapter,
  BridgeCapabilitiesContract,
  BrowserDiagnostics,
  BrowserTabTarget,
  NavigationArtifact,
  ResumedSession,
  ScreenshotArtifact,
  NavigateOptions,
  ScreenshotOptions,
  SessionActivation,
  SessionNavigation,
  SessionScreenshot,
  SupportedBrowser,
  TabMetadata
} from "../types";
import { SessionStore } from "../store/session-store";
import { buildSignatureTargetFromTab } from "../target";

interface AttachServiceOptions {
  store?: SessionStore;
  adapterFactory?: (browser: SupportedBrowser) => BrowserAdapter;
}

export class AttachService {
  private readonly store: SessionStore;
  private readonly adapterFactory: (browser: SupportedBrowser) => BrowserAdapter;

  constructor(options: AttachServiceOptions = {}) {
    this.store = options.store ?? new SessionStore();
    this.adapterFactory = options.adapterFactory ?? getBrowserAdapter;
  }

  async inspectFrontTab(browser: SupportedBrowser): Promise<TabMetadata> {
    return this.inspectTab(browser, { type: "front" });
  }

  async inspectTab(browser: SupportedBrowser, target: BrowserTabTarget = { type: "front" }): Promise<TabMetadata> {
    return this.adapterFactory(browser).resolveTab(target);
  }

  async listTabs(browser: SupportedBrowser): Promise<TabMetadata[]> {
    return this.adapterFactory(browser).listTabs();
  }

  async activate(
    browser: SupportedBrowser,
    target: BrowserTabTarget = { type: "front" }
  ): Promise<ActivationArtifact> {
    return this.adapterFactory(browser).performSessionAction({
      action: "activate",
      target
    }) as Promise<ActivationArtifact>;
  }

  async activateSession(id: string): Promise<SessionActivation> {
    const session = await this.getSession(id);
    const activation = await this.activate(session.browser, session.target);

    return {
      session,
      activation
    };
  }

  async navigate(
    browser: SupportedBrowser,
    target: BrowserTabTarget,
    options: NavigateOptions
  ): Promise<NavigationArtifact> {
    return this.adapterFactory(browser).performSessionAction({
      action: "navigate",
      target,
      options
    }) as Promise<NavigationArtifact>;
  }

  async navigateSession(id: string, options: NavigateOptions): Promise<SessionNavigation> {
    const resumed = await this.resumeSession(id);
    const navigation = await this.navigate(
      resumed.session.browser,
      {
        type: "indexed",
        windowIndex: navigationTargetWindowIndex(resumed.tab),
        tabIndex: navigationTargetTabIndex(resumed.tab)
      },
      options
    );

    const updatedSession: AttachmentSession = {
      ...resumed.session,
      target: buildSignatureTargetFromTab(navigation.tab),
      tab: navigation.tab,
      frontTab: navigation.tab
    };

    await this.store.update(updatedSession);

    return {
      session: normalizeAttachmentSession(updatedSession),
      navigation
    };
  }

  async screenshot(
    browser: SupportedBrowser,
    target: BrowserTabTarget = { type: "front" },
    options: ScreenshotOptions = {}
  ): Promise<ScreenshotArtifact> {
    const outputPath = options.outputPath ?? this.buildScreenshotPath(browser);
    return this.adapterFactory(browser).performSessionAction({
      action: "screenshot",
      target,
      options: { outputPath }
    }) as Promise<ScreenshotArtifact>;
  }

  async attach(
    browser: SupportedBrowser,
    targetOrRequest: BrowserTabTarget | AttachRequest = { type: "front" }
  ): Promise<AttachmentSession> {
    const request = isAttachRequest(targetOrRequest)
      ? targetOrRequest
      : { target: targetOrRequest };
    const target = request.target ?? { type: "front" };

    if (browser === "chrome" && request.attach?.mode === "relay") {
      const relay = await resolveChromeRelayAttach(target);
      const createdAt = new Date().toISOString();
      const session = normalizeAttachmentSession({
        id: randomUUID(),
        browser,
        target: buildSignatureTargetFromTab(relay.tab),
        tab: relay.tab,
        frontTab: relay.tab,
        createdAt,
        attach: {
          mode: "relay",
          source: "extension-relay",
          scope: "tab",
          resumable: relay.resumable,
          expiresAt: relay.expiresAt,
          resumeRequiresUserGesture: relay.resumeRequiresUserGesture,
          trustedAt: relay.trustedAt
        }
      });
      return this.store.create(session);
    }

    const tab = await this.inspectTab(browser, target);
    const createdAt = new Date().toISOString();
    const session = normalizeAttachmentSession({
      id: randomUUID(),
      browser,
      target: buildSignatureTargetFromTab(tab),
      tab,
      frontTab: tab,
      createdAt
    });
    return this.store.create(session);
  }

  async listSessions(): Promise<AttachmentSession[]> {
    return this.store.list();
  }

  async diagnostics(browser: SupportedBrowser): Promise<BrowserDiagnostics> {
    return this.adapterFactory(browser).getDiagnostics();
  }

  getCapabilities(browser?: SupportedBrowser): BridgeCapabilitiesContract {
    return getBridgeCapabilities(browser);
  }

  async getSession(id: string): Promise<AttachmentSession> {
    const session = await this.store.get(id);
    if (!session) {
      throw new AppError(`Session not found: ${id}`, 404, "session_not_found");
    }

    return session;
  }

  async screenshotSession(id: string, options: ScreenshotOptions = {}): Promise<SessionScreenshot> {
    const session = await this.getSession(id);
    const screenshot = await this.screenshot(
      session.browser,
      session.target,
      { outputPath: options.outputPath ?? this.buildScreenshotPath(session.browser, session.id) }
    );

    return {
      session,
      screenshot
    };
  }

  async resumeSession(id: string): Promise<ResumedSession> {
    const session = await this.getSession(id);

    if (session.browser === "chrome" && session.attach.mode === "relay") {
      const resumed = await resumeChromeRelaySession(session);
      const refreshedSession = await this.store.update(resumed.session);
      return {
        ...resumed,
        session: refreshedSession
      };
    }

    const tabs = await this.listTabs(session.browser);
    const { target } = session;

    if (target.type === "front") {
      const tab = await this.inspectTab(session.browser, target);
      return {
        session,
        tab,
        resumedAt: new Date().toISOString(),
        resolution: {
          strategy: "front",
          matched: true,
          attachMode: session.attach.mode,
          semantics: session.semantics.resume
        }
      };
    }

    if (target.type === "indexed") {
      const tab = await this.inspectTab(session.browser, target);
      return {
        session,
        tab,
        resumedAt: new Date().toISOString(),
        resolution: {
          strategy: "indexed",
          matched: true,
          attachMode: session.attach.mode,
          semantics: session.semantics.resume
        }
      };
    }

    const byNativeIdentity =
      target.native?.kind === "chrome-devtools-target"
        ? tabs.find(
            (tab) =>
              tab.identity.native?.kind === "chrome-devtools-target" &&
              tab.identity.native.targetId === target.native?.targetId
          )
        : undefined;
    if (byNativeIdentity) {
      return {
        session,
        tab: byNativeIdentity,
        resumedAt: new Date().toISOString(),
        resolution: {
          strategy: "native_identity",
          matched: true,
          attachMode: session.attach.mode,
          semantics: session.semantics.resume
        }
      };
    }

    const bySignature = tabs.find((tab) => tab.identity.signature === target.signature);
    if (bySignature) {
      return {
        session,
        tab: bySignature,
        resumedAt: new Date().toISOString(),
        resolution: {
          strategy: "signature",
          matched: true,
          attachMode: session.attach.mode,
          semantics: session.semantics.resume
        }
      };
    }

    const byUrlTitle = tabs.find(
      (tab) => tab.url === target.url && tab.identity.titleKey === (session.tab.identity?.titleKey ?? "")
    );
    if (byUrlTitle) {
      return {
        session,
        tab: byUrlTitle,
        resumedAt: new Date().toISOString(),
        resolution: {
          strategy: "url_title",
          matched: true,
          attachMode: session.attach.mode,
          semantics: session.semantics.resume
        }
      };
    }

    const byUrl = target.url ? tabs.find((tab) => tab.url === target.url) : undefined;
    if (byUrl) {
      return {
        session,
        tab: byUrl,
        resumedAt: new Date().toISOString(),
        resolution: {
          strategy: "url",
          matched: true,
          attachMode: session.attach.mode,
          semantics: session.semantics.resume
        }
      };
    }

    const byLastKnown =
      target.lastKnownWindowIndex && target.lastKnownTabIndex
        ? tabs.find(
            (tab) =>
              tab.windowIndex === target.lastKnownWindowIndex && tab.tabIndex === target.lastKnownTabIndex
          )
        : undefined;
    if (byLastKnown) {
      return {
        session,
        tab: byLastKnown,
        resumedAt: new Date().toISOString(),
        resolution: {
          strategy: "last_known_index",
          matched: true,
          attachMode: session.attach.mode,
          semantics: session.semantics.resume
        }
      };
    }

    throw new AppError(
      `Unable to resume session ${id}; the saved ${session.browser} tab can no longer be matched.`,
      404,
      "tab_not_found"
    );
  }

  private buildScreenshotPath(browser: SupportedBrowser, sessionId?: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = sessionId ? `${browser}-${sessionId}-${stamp}.png` : `${browser}-${stamp}.png`;
    return resolve(process.cwd(), ".data", "screenshots", fileName);
  }
}

function navigationTargetWindowIndex(tab: TabMetadata): number {
  return tab.windowIndex;
}

function navigationTargetTabIndex(tab: TabMetadata): number {
  return tab.tabIndex;
}

function isAttachRequest(value: BrowserTabTarget | AttachRequest): value is AttachRequest {
  return typeof value === "object" && value !== null && ("attach" in value || "target" in value);
}
