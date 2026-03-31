/**
 * Minimal CLI-shell wrapper for route-first doctor/connect flows.
 *
 * Copy-paste run:
 *   npm run build
 *   node --experimental-strip-types examples/clients/doctor-connect-wrapper.ts safari
 *   node --experimental-strip-types examples/clients/doctor-connect-wrapper.ts chrome-relay
 *
 * Optional resume:
 *   LOCAL_BROWSER_BRIDGE_SESSION_ID=<session-id> node --experimental-strip-types examples/clients/doctor-connect-wrapper.ts chrome-relay
 *
 * Optional binary override:
 *   LOCAL_BROWSER_BRIDGE_BIN=/path/to/local-browser-bridge node --experimental-strip-types examples/clients/doctor-connect-wrapper.ts safari
 */

const { execFile } = require("node:child_process") as typeof import("node:child_process");
const { existsSync } = require("node:fs") as typeof import("node:fs");
const { resolve } = require("node:path") as typeof import("node:path");
const { promisify } = require("node:util") as typeof import("node:util");

type RouteName = "safari" | "chrome-direct" | "chrome-relay";

type DoctorPayload = {
  ok: boolean;
  command: "doctor";
  outcome: "success" | "blocked";
  status: "ready" | "blocked";
  category: "route-ready" | "route-blocked";
  reason?: { code: string; message: string; retryable?: boolean; userActionRequired?: boolean };
  summary: string;
  prompt?: string;
  nextStep: { action: string; prompt: string; command?: string };
  routeUx: {
    label: string;
    state: string;
    readOnly: boolean;
    sharedTabScoped?: boolean;
  };
};

type ConnectPayload = {
  ok: boolean;
  command: "connect";
  connected: boolean;
  outcome: "success" | "blocked" | "unsupported" | "error";
  status: "connected" | "blocked" | "unsupported" | "failed";
  category: "session-connected" | "connection-blocked" | "connection-unsupported" | "connection-failed";
  reason?: { code: string; message: string; retryable?: boolean; userActionRequired?: boolean };
  summary: string;
  prompt?: string;
  nextStep: { action: string; prompt: string; command?: string };
  routeUx: {
    label: string;
    state: string;
    readOnly: boolean;
    sharedTabScoped?: boolean;
  };
  session?: {
    id: string;
    kind: string;
    capabilities: {
      activate: boolean;
      navigate: boolean;
      screenshot: boolean;
    };
  };
  sessionUx?: {
    label: string;
    state: string;
    readOnly: boolean;
    sharedTabScoped?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
  };
  errorUx?: {
    label: string;
    state: string;
    prompt?: string;
    retryGuidance?: string;
    readOnly: boolean;
    sharedTabScoped?: boolean;
  };
};

type WrapperResult =
  | {
      ok: false;
      stage: "doctor" | "connect";
      outcome: "blocked" | "unsupported" | "error";
      status: "blocked" | "unsupported" | "failed";
      category: "route-blocked" | "connection-blocked" | "connection-unsupported" | "connection-failed";
      reason?: { code: string; message: string; retryable?: boolean; userActionRequired?: boolean };
      route: RouteName;
      label: string;
      state: string;
      summary: string;
      prompt: string;
      nextStep: { action: string; prompt: string; command?: string };
      readOnly: boolean;
      sharedTabScoped: boolean;
      error?: { code?: string; message?: string };
      retryGuidance?: string;
    }
  | {
      ok: true;
      stage: "connect";
      outcome: "success";
      status: "connected";
      category: "session-connected";
      route: RouteName;
      label: string;
      state: string;
      summary: string;
      prompt: string;
      nextStep: { action: string; prompt: string; command?: string };
      readOnly: boolean;
      sharedTabScoped: boolean;
      session: {
        id: string;
        kind: string;
        canAct: boolean;
        suggestedActions: string[];
      };
    };

const execFileAsync = promisify(execFile);
const repoCliEntrypoint = resolve(__dirname, "../../dist/src/cli.js");
const route = normalizeRoute(process.argv[2] ?? "safari");
const sessionId = process.env.LOCAL_BROWSER_BRIDGE_SESSION_ID?.trim() || undefined;

function normalizeRoute(value: string): RouteName {
  if (value === "safari" || value === "chrome-direct" || value === "chrome-relay") {
    return value;
  }

  throw new Error("Usage: node --experimental-strip-types examples/clients/doctor-connect-wrapper.ts safari|chrome-direct|chrome-relay");
}

function bridgeCommand() {
  const explicitBinary = process.env.LOCAL_BROWSER_BRIDGE_BIN?.trim();
  const explicitCliPath = process.env.LOCAL_BROWSER_BRIDGE_CLI_PATH?.trim();
  if (explicitBinary) {
    return {
      file: explicitBinary,
      prefixArgs: explicitCliPath ? [explicitCliPath] : [],
      display: explicitCliPath ? `${explicitBinary} ${explicitCliPath}` : explicitBinary
    };
  }

  if (existsSync(repoCliEntrypoint)) {
    return {
      file: process.execPath,
      prefixArgs: [repoCliEntrypoint],
      display: `node ${repoCliEntrypoint}`
    };
  }

  return {
    file: "local-browser-bridge",
    prefixArgs: [],
    display: "local-browser-bridge"
  };
}

async function runBridgeJson<T>(args: string[]): Promise<T> {
  const command = bridgeCommand();
  const result = await execFileAsync(command.file, [...command.prefixArgs, ...args], {
    cwd: resolve(__dirname, "../..")
  });
  return JSON.parse(result.stdout) as T;
}

function toBlockedResult(stage: "doctor" | "connect", payload: DoctorPayload | ConnectPayload): WrapperResult {
  const prompt = payload.prompt ?? payload.nextStep.prompt;
  return {
    ok: false,
    stage,
    outcome: payload.outcome === "success" ? "error" : payload.outcome,
    status: payload.status === "ready" || payload.status === "connected" ? "failed" : payload.status,
    category:
      payload.category === "route-ready" || payload.category === "session-connected"
        ? "connection-failed"
        : payload.category,
    ...(payload.reason ? { reason: payload.reason } : {}),
    route,
    label: payload.routeUx.label,
    state: payload.routeUx.state,
    summary: payload.summary,
    prompt,
    nextStep: payload.nextStep,
    readOnly: payload.routeUx.readOnly,
    sharedTabScoped: payload.routeUx.sharedTabScoped === true,
    ...(stage === "connect" && "error" in payload && payload.error ? { error: payload.error } : {}),
    ...(stage === "connect" && "errorUx" in payload && payload.errorUx?.retryGuidance
      ? { retryGuidance: payload.errorUx.retryGuidance }
      : {})
  };
}

function suggestedActions(payload: ConnectPayload): string[] {
  if (!payload.session) {
    return [];
  }

  const actions: string[] = ["resume"];
  if (payload.session.capabilities.activate) {
    actions.push("activate");
  }
  if (payload.session.capabilities.navigate) {
    actions.push("navigate");
  }
  if (payload.session.capabilities.screenshot) {
    actions.push("screenshot");
  }
  return actions;
}

async function main(): Promise<void> {
  const command = bridgeCommand();
  const baseArgs = ["--route", route, ...(sessionId ? ["--session-id", sessionId] : [])];
  const doctor = await runBridgeJson<DoctorPayload>(["doctor", ...baseArgs]);

  if (!doctor.ok) {
    process.stdout.write(
      JSON.stringify(
        {
          wrapper: "doctor-connect",
          bridgeCommand: command.display,
          result: toBlockedResult("doctor", doctor)
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  const connect = await runBridgeJson<ConnectPayload>(["connect", ...baseArgs]);
  const result: WrapperResult = !connect.ok || !connect.connected || !connect.session || !connect.sessionUx
    ? toBlockedResult("connect", connect)
    : {
        ok: true,
        stage: "connect",
        outcome: "success",
        status: "connected",
        category: "session-connected",
        route,
        label: connect.sessionUx.label,
        state: connect.sessionUx.state,
        summary: connect.summary,
        prompt: connect.prompt ?? connect.nextStep.prompt,
        nextStep: connect.nextStep,
        readOnly: connect.sessionUx.readOnly,
        sharedTabScoped: connect.sessionUx.sharedTabScoped === true,
        session: {
          id: connect.session.id,
          kind: connect.session.kind,
          canAct:
            connect.session.capabilities.activate ||
            connect.session.capabilities.navigate ||
            connect.session.capabilities.screenshot,
          suggestedActions: suggestedActions(connect)
        }
      };

  process.stdout.write(
    JSON.stringify(
      {
        wrapper: "doctor-connect",
        bridgeCommand: command.display,
        result
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
