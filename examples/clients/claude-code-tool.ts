/**
 * Runnable Claude Code-style wrapper example built on the shared public toolkit surface.
 *
 * Copy-paste run:
 *   npm run build
 *   npx tsx examples/clients/claude-code-tool.ts safari
 *   npx tsx examples/clients/claude-code-tool.ts chrome-relay
 *
 * Optional resume:
 *   LOCAL_BROWSER_BRIDGE_SESSION_ID=<session-id> npx tsx examples/clients/claude-code-tool.ts chrome-relay
 */

const { promisify } = require("node:util") as typeof import("node:util");
const { execFile } = require("node:child_process") as typeof import("node:child_process");
const { resolve } = require("node:path") as typeof import("node:path");

const {
  createCliBridgeAdapter,
  interpretBrowserAttachUxFromError,
  prepareClaudeCodeRoute
} = require("../../dist/src") as typeof import("../../src");

type ClaudeCodeRouteName = import("../../src").ClaudeCodeRouteName;
type BridgeErrorEnvelope = {
  error?: {
    message?: string;
    details?: unknown;
  };
};

const execFileAsync = promisify(execFile);
const cliEntrypoint = resolve(__dirname, "../../dist/src/cli.js");
const route = normalizeRoute(process.argv[2] ?? "safari");
const sessionId = process.env.LOCAL_BROWSER_BRIDGE_SESSION_ID;

function normalizeRoute(value: string): ClaudeCodeRouteName {
  if (value === "safari" || value === "chrome-direct" || value === "chrome-relay") {
    return value;
  }

  throw new Error("Usage: npx tsx examples/clients/claude-code-tool.ts safari|chrome-direct|chrome-relay");
}

function tryParseErrorEnvelope(value: string): BridgeErrorEnvelope | undefined {
  if (!value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value) as BridgeErrorEnvelope;
  } catch {
    return undefined;
  }
}

async function executeCli(command: { args: string[] }) {
  try {
    const result = await execFileAsync(process.execPath, [cliEntrypoint, ...command.args], {
      cwd: resolve(__dirname, "../..")
    });
    return { stdout: result.stdout };
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    const payload = tryParseErrorEnvelope(failure.stderr ?? "");
    const wrapped = new Error(payload?.error?.message ?? failure.message) as Error & { details?: unknown };
    if (payload?.error?.details !== undefined) {
      wrapped.details = payload.error.details;
    }
    throw wrapped;
  }
}

async function main(): Promise<void> {
  const adapter = createCliBridgeAdapter({ execute: executeCli });

  try {
    const prepared = await prepareClaudeCodeRoute(adapter, { route, sessionId });

    console.log(`transport: cli (${cliEntrypoint})`);
    console.log(`claude-code route: ${route}`);
    console.log(`route label: ${prepared.routeUx.label} [${prepared.routeUx.state}]`);

    if (prepared.blocked) {
      console.log(`tool prompt: ${prepared.prompt ?? "Selected route is blocked."}`);
      console.log("attach skipped: true");
      return;
    }

    const connection = prepared.connection!;
    console.log(`operation: ${connection.operation}`);
    console.log(`session: ${connection.session.id} (${connection.session.kind})`);
    console.log(`session label: ${connection.sessionUx.label} [${connection.sessionUx.state}]`);
    if (prepared.prompt) {
      console.log(`tool prompt: ${prepared.prompt}`);
    }
    console.log(`shared-tab scoped: ${connection.sessionUx.sharedTabScoped === true}`);
    console.log(
      `actions: activate=${connection.session.capabilities.activate} navigate=${connection.session.capabilities.navigate} screenshot=${connection.session.capabilities.screenshot}`
    );
  } catch (error) {
    const details =
      typeof error === "object" && error !== null && "details" in error ? (error as { details?: unknown }).details : undefined;
    const errorUx = interpretBrowserAttachUxFromError({ details });

    console.error(`transport: cli (${cliEntrypoint})`);
    console.error(`claude-code route: ${route}`);
    console.error(`failure: ${errorUx.label} [${errorUx.state}]`);
    if (errorUx.prompt) {
      console.error(`tool prompt: ${errorUx.prompt}`);
    }
    if (errorUx.retryGuidance) {
      console.error(`retry guidance: ${errorUx.retryGuidance}`);
    }

    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
