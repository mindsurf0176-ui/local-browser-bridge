/**
 * Runnable CLI consumer example for the shared transport/reference adapter stack.
 *
 * Copy-paste run:
 *   npm run build
 *   npx tsx examples/clients/cli-consumer.ts safari
 *   npx tsx examples/clients/cli-consumer.ts chrome-relay
 *
 * Optional resume:
 *   LOCAL_BROWSER_BRIDGE_SESSION_ID=<session-id> npx tsx examples/clients/cli-consumer.ts chrome-relay
 */

const { promisify } = require("node:util") as typeof import("node:util");
const { execFile } = require("node:child_process") as typeof import("node:child_process");
const { resolve } = require("node:path") as typeof import("node:path");

const {
  connectViaBridge,
  createCliBridgeAdapter,
  interpretBrowserAttachUxFromError
} = require("../../dist/src") as typeof import("../../src");

type RouteName = "safari" | "chrome-direct" | "chrome-relay";
type BridgeErrorEnvelope = {
  error?: {
    message?: string;
    details?: unknown;
  };
};

const execFileAsync = promisify(execFile);
const cliEntrypoint = resolve(__dirname, "../../dist/src/cli.js");
const selectedRoute = normalizeRoute(process.argv[2] ?? "safari");
const sessionId = process.env.LOCAL_BROWSER_BRIDGE_SESSION_ID;

function normalizeRoute(value: string): RouteName {
  if (value === "safari" || value === "chrome-direct" || value === "chrome-relay") {
    return value;
  }

  throw new Error("Usage: npx tsx examples/clients/cli-consumer.ts safari|chrome-direct|chrome-relay");
}

function toBridgeRoute(routeName: RouteName, resumeSessionId?: string) {
  const browser = routeName === "safari" ? "safari" : "chrome";
  const attachMode = routeName === "chrome-relay" ? "relay" : "direct";

  return resumeSessionId ? { browser, attachMode, sessionId: resumeSessionId } : { browser, attachMode };
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

function printConnection(connection: Awaited<ReturnType<typeof connectViaBridge>>) {
  console.log(`transport: cli (${cliEntrypoint})`);
  console.log(`operation: ${connection.operation}`);
  console.log(`schemaVersion: ${connection.session.schemaVersion}`);
  console.log(`route: ${connection.routeUx.label} [${connection.routeUx.state}]`);
  if (connection.routeUx.prompt) {
    console.log(`route prompt: ${connection.routeUx.prompt}`);
  }
  console.log(`session: ${connection.session.id} (${connection.session.kind})`);
  console.log(`session UX: ${connection.sessionUx.label} [${connection.sessionUx.state}]`);
  if (connection.sessionUx.scopeNote) {
    console.log(`scope note: ${connection.sessionUx.scopeNote}`);
  }
  console.log(`resume semantics: ${connection.session.semantics.resume}`);
  console.log(
    `actions: activate=${connection.session.capabilities.activate} navigate=${connection.session.capabilities.navigate} screenshot=${connection.session.capabilities.screenshot}`
  );
}

async function main(): Promise<void> {
  const adapter = createCliBridgeAdapter({
    execute: executeCli
  });

  try {
    const connection = await connectViaBridge(adapter, toBridgeRoute(selectedRoute, sessionId));
    printConnection(connection);
  } catch (error) {
    const details =
      typeof error === "object" && error !== null && "details" in error ? (error as { details?: unknown }).details : undefined;
    const errorUx = interpretBrowserAttachUxFromError({ details });

    console.error(`transport: cli (${cliEntrypoint})`);
    console.error(`route: ${selectedRoute}`);
    console.error(`failure: ${errorUx.label} [${errorUx.state}]`);
    if (errorUx.prompt) {
      console.error(`prompt: ${errorUx.prompt}`);
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
