import {
  connectViaBridge,
  type BridgeConnectionResult,
  type BridgeSessionResult
} from "./reference-adapter";
import { normalizeClaudeCodeRoute } from "./claude-code";
import {
  createCliBridgeAdapter,
  type CliBridgeExecutor,
  type CreateCliBridgeAdapterOptions
} from "./cli-reference-adapter";
import {
  createHttpBridgeAdapter,
  type CreateHttpBridgeAdapterOptions,
  type HttpBridgeExecutor
} from "./http-reference-adapter";
import type { BridgeCapabilitiesContract, ResumedSession } from "./types";

export type CodexRouteName = "safari" | "chrome-direct" | "chrome-relay";

export interface CodexRouteInput {
  route: CodexRouteName;
  sessionId?: string;
}

export interface ConnectCodexViaCliOptions<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
> extends CodexRouteInput,
    CreateCliBridgeAdapterOptions<TCapabilities, TAttachResult, TResumeResult> {}

export interface ConnectCodexViaHttpOptions<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
> extends CodexRouteInput,
    CreateHttpBridgeAdapterOptions<TCapabilities, TAttachResult, TResumeResult> {}

export function normalizeCodexRoute(route: CodexRouteName, sessionId?: string) {
  return normalizeClaudeCodeRoute({ route, sessionId });
}

export async function connectCodexViaCli<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
>(
  options: ConnectCodexViaCliOptions<TCapabilities, TAttachResult, TResumeResult>
): Promise<BridgeConnectionResult<TCapabilities, TAttachResult | TResumeResult>> {
  const adapter = createCliBridgeAdapter<TCapabilities, TAttachResult, TResumeResult>({
    execute: options.execute
  });

  return connectViaBridge(adapter, normalizeCodexRoute(options.route, options.sessionId));
}

export async function connectCodexViaHttp<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
>(
  options: ConnectCodexViaHttpOptions<TCapabilities, TAttachResult, TResumeResult>
): Promise<BridgeConnectionResult<TCapabilities, TAttachResult | TResumeResult>> {
  const adapter = createHttpBridgeAdapter<TCapabilities, TAttachResult, TResumeResult>({
    execute: options.execute,
    paths: options.paths
  });

  return connectViaBridge(adapter, normalizeCodexRoute(options.route, options.sessionId));
}

export type { CliBridgeExecutor, HttpBridgeExecutor };
