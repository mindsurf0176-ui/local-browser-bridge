import { AppError } from "./errors";
import { createBridgeAdapter, type BridgeAdapter, type BridgeAttachRoute, type BridgeSessionResult } from "./reference-adapter";
import type { BrowserDiagnostics, BridgeCapabilitiesContract, ResumedSession } from "./types";

export interface CliBridgeCommand {
  args: string[];
}

export interface CliBridgeCommandResult {
  stdout: string;
}

export type CliBridgeExecutor = (command: CliBridgeCommand) => Promise<CliBridgeCommandResult>;

export interface CreateCliBridgeAdapterOptions<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
> {
  execute: CliBridgeExecutor;
}

function parseJsonEnvelope<TEnvelope>(stdout: string, context: string): TEnvelope {
  try {
    return JSON.parse(stdout) as TEnvelope;
  } catch (error) {
    throw new AppError(
      `Expected ${context} command to return valid JSON.`,
      500,
      "invalid_transport_response",
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

function requireEnvelopeField<TEnvelope extends object, TKey extends keyof TEnvelope>(
  envelope: TEnvelope,
  key: TKey,
  context: string
): NonNullable<TEnvelope[TKey]> {
  const value = envelope[key];
  if (value === undefined || value === null) {
    throw new AppError(`Expected ${context} command output to include ${String(key)}.`, 500, "invalid_transport_response");
  }

  return value as NonNullable<TEnvelope[TKey]>;
}

async function runCommand<TEnvelope>(execute: CliBridgeExecutor, args: string[], context: string): Promise<TEnvelope> {
  const result = await execute({ args });
  return parseJsonEnvelope<TEnvelope>(result.stdout, context);
}

export function createCliBridgeAdapter<
  TCapabilities = BridgeCapabilitiesContract,
  TAttachResult extends BridgeSessionResult = BridgeSessionResult,
  TResumeResult extends ResumedSession = ResumedSession
>(options: CreateCliBridgeAdapterOptions<TCapabilities, TAttachResult, TResumeResult>): BridgeAdapter<
  TCapabilities,
  TAttachResult,
  TResumeResult
> {
  return createBridgeAdapter({
    async getCapabilities() {
      const envelope = await runCommand<{ capabilities?: TCapabilities }>(options.execute, ["capabilities"], "capabilities");
      return requireEnvelopeField(envelope, "capabilities", "capabilities");
    },
    async getDiagnostics(browser) {
      const envelope = await runCommand<{ diagnostics?: BrowserDiagnostics }>(
        options.execute,
        ["diagnostics", "--browser", browser],
        "diagnostics"
      );
      return requireEnvelopeField(envelope, "diagnostics", "diagnostics");
    },
    async attach(args: BridgeAttachRoute) {
      const commandArgs = ["attach", "--browser", args.browser];
      if (args.attachMode) {
        commandArgs.push("--attach-mode", args.attachMode);
      }

      const envelope = await runCommand<{ session?: TAttachResult }>(options.execute, commandArgs, "attach");
      return requireEnvelopeField(envelope, "session", "attach");
    },
    async resume(sessionId: string) {
      const envelope = await runCommand<{ resumedSession?: TResumeResult }>(
        options.execute,
        ["resume", "--id", sessionId],
        "resumeSession"
      );
      return requireEnvelopeField(envelope, "resumedSession", "resumeSession");
    }
  });
}
