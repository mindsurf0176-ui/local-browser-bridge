import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromSession,
  type BrowserAttachUxInterpretation
} from "./browser-attach-ux-helper";
import type {
  AttachmentSession,
  BrowserAttachMode,
  BrowserDiagnostics,
  BridgeCapabilitiesContract,
  ChromeRelayFailureOperation,
  ResumedSession,
  SupportedBrowser
} from "./types";

export interface BridgeAttachRoute {
  browser: SupportedBrowser;
  attachMode?: BrowserAttachMode;
}

export interface BridgeResumeRoute extends BridgeAttachRoute {
  sessionId: string;
}

export type BridgeRoute = BridgeAttachRoute | BridgeResumeRoute;

export type BridgeSessionResult = AttachmentSession | ResumedSession | { session: AttachmentSession };

export interface BridgeAdapter<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends BridgeSessionResult = BridgeSessionResult
> {
  getCapabilities(): Promise<TCapabilities>;
  getDiagnostics(browser: SupportedBrowser): Promise<BrowserDiagnostics>;
  attach(args: BridgeAttachRoute): Promise<TAttachResult>;
  resume(sessionId: string): Promise<TResumeResult>;
}

export interface BridgeConnectionResult<TCapabilities, TResult extends BridgeSessionResult> {
  capabilities: TCapabilities;
  diagnostics: BrowserDiagnostics;
  operation: ChromeRelayFailureOperation;
  route: BridgeRoute;
  routeUx: BrowserAttachUxInterpretation;
  result: TResult;
  session: AttachmentSession;
  sessionUx: BrowserAttachUxInterpretation;
}

function hasSession(result: BridgeSessionResult): result is ResumedSession | { session: AttachmentSession } {
  return typeof result === "object" && result !== null && "session" in result;
}

export function createBridgeAdapter<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends BridgeSessionResult = BridgeSessionResult
>(adapter: BridgeAdapter<TCapabilities, TAttachResult, TResumeResult>): BridgeAdapter<TCapabilities, TAttachResult, TResumeResult> {
  return adapter;
}

export function sessionFromBridgeResult<TResult extends BridgeSessionResult>(result: TResult): AttachmentSession {
  return hasSession(result) ? result.session : result;
}

export async function connectViaBridge<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends BridgeSessionResult = BridgeSessionResult
>(
  adapter: BridgeAdapter<TCapabilities, TAttachResult, TResumeResult>,
  route: BridgeRoute
): Promise<BridgeConnectionResult<TCapabilities, TAttachResult | TResumeResult>> {
  const capabilities = await adapter.getCapabilities();
  const diagnostics = await adapter.getDiagnostics(route.browser);
  const operation: ChromeRelayFailureOperation = "sessionId" in route ? "resumeSession" : "attach";
  const attachMode = route.attachMode ?? (route.browser === "chrome" ? "direct" : "direct");
  const routeUx = interpretBrowserAttachUxFromDiagnostics({
    browser: route.browser,
    attachMode,
    diagnostics,
    operation
  });
  const result =
    "sessionId" in route ? await adapter.resume(route.sessionId) : await adapter.attach({ browser: route.browser, attachMode });
  const session = sessionFromBridgeResult(result);

  return {
    capabilities,
    diagnostics,
    operation,
    route,
    routeUx,
    result,
    session,
    sessionUx: interpretBrowserAttachUxFromSession({
      session,
      operation
    })
  };
}
