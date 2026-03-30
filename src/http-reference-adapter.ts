import { AppError } from "./errors";
import { createBridgeAdapter, type BridgeAdapter, type BridgeAttachRoute, type BridgeSessionResult } from "./reference-adapter";
import type { BrowserDiagnostics, BridgeCapabilitiesContract, ResumedSession } from "./types";

export interface HttpBridgeRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

export interface HttpBridgeResponse<TBody = unknown> {
  status?: number;
  body: TBody;
}

export type HttpBridgeExecutor = (request: HttpBridgeRequest) => Promise<HttpBridgeResponse>;

export interface HttpCapabilitiesEnvelope<TCapabilities = BridgeCapabilitiesContract> {
  capabilities?: TCapabilities;
}

export interface HttpDiagnosticsEnvelope {
  diagnostics?: BrowserDiagnostics;
}

export interface HttpAttachEnvelope<TAttachResult extends BridgeSessionResult = BridgeSessionResult> {
  session?: TAttachResult;
}

export interface HttpResumeEnvelope<TResumeResult extends ResumedSession = ResumedSession> {
  resumedSession?: TResumeResult;
}

export interface CreateHttpBridgeAdapterOptions<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
> {
  execute: HttpBridgeExecutor;
  paths?: {
    capabilities?: string;
    diagnostics?: string;
    attach?: string;
    resumeSession?: (sessionId: string) => string;
  };
}

function requireEnvelopeField<TEnvelope extends object, TKey extends keyof TEnvelope>(
  envelope: TEnvelope,
  key: TKey,
  context: string
): NonNullable<TEnvelope[TKey]> {
  const value = envelope[key];
  if (value === undefined || value === null) {
    throw new AppError(`Expected ${context} response to include ${String(key)}.`, 500, "invalid_transport_response");
  }

  return value as NonNullable<TEnvelope[TKey]>;
}

function buildQuery(path: string, values: Record<string, string | undefined>): string {
  const url = new URL(path, "http://local-browser-bridge.test");
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return `${url.pathname}${url.search}`;
}

export function createHttpBridgeAdapter<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
>(options: CreateHttpBridgeAdapterOptions<TCapabilities, TAttachResult, TResumeResult>): BridgeAdapter<
  TCapabilities,
  TAttachResult,
  TResumeResult
> {
  const capabilitiesPath = options.paths?.capabilities ?? "/v1/capabilities";
  const diagnosticsPath = options.paths?.diagnostics ?? "/v1/diagnostics";
  const attachPath = options.paths?.attach ?? "/v1/attach";
  const resumeSessionPath = options.paths?.resumeSession ?? ((sessionId: string) => `/v1/sessions/${encodeURIComponent(sessionId)}/resume`);

  return createBridgeAdapter({
    async getCapabilities() {
      const response = await options.execute({
        method: "GET",
        path: capabilitiesPath
      });
      return requireEnvelopeField(response.body as HttpCapabilitiesEnvelope<TCapabilities>, "capabilities", "capabilities");
    },
    async getDiagnostics(browser) {
      const response = await options.execute({
        method: "GET",
        path: buildQuery(diagnosticsPath, { browser })
      });
      return requireEnvelopeField(response.body as HttpDiagnosticsEnvelope, "diagnostics", "diagnostics");
    },
    async attach(args: BridgeAttachRoute) {
      const response = await options.execute({
        method: "POST",
        path: attachPath,
        body: {
          browser: args.browser,
          attach: { mode: args.attachMode }
        }
      });
      return requireEnvelopeField(response.body as HttpAttachEnvelope<TAttachResult>, "session", "attach");
    },
    async resume(sessionId: string) {
      const response = await options.execute({
        method: "POST",
        path: resumeSessionPath(sessionId)
      });
      return requireEnvelopeField(response.body as HttpResumeEnvelope<TResumeResult>, "resumedSession", "resumeSession");
    }
  });
}
