/**
 * Runnable HTTP consumer example for the shared transport/reference adapter stack.
 *
 * Copy-paste run:
 *   terminal 1 -> npm run build && npm run serve
 *   terminal 2 -> npx tsx examples/clients/http-consumer.ts safari
 *   terminal 2 -> npx tsx examples/clients/http-consumer.ts chrome-relay
 *
 * Optional resume:
 *   LOCAL_BROWSER_BRIDGE_SESSION_ID=<session-id> npx tsx examples/clients/http-consumer.ts chrome-relay
 */

const {
  connectViaBridge,
  createHttpBridgeAdapter,
  interpretBrowserAttachUxFromError
} = require("../../dist/src") as typeof import("../../src");

type RouteName = "safari" | "chrome-direct" | "chrome-relay";
type BridgeErrorEnvelope = {
  error?: {
    message?: string;
    details?: unknown;
  };
};

const baseUrl = process.env.LOCAL_BROWSER_BRIDGE_URL ?? "http://127.0.0.1:3000";
const selectedRoute = normalizeRoute(process.argv[2] ?? "safari");
const sessionId = process.env.LOCAL_BROWSER_BRIDGE_SESSION_ID;

function normalizeRoute(value: string): RouteName {
  if (value === "safari" || value === "chrome-direct" || value === "chrome-relay") {
    return value;
  }

  throw new Error("Usage: npx tsx examples/clients/http-consumer.ts safari|chrome-direct|chrome-relay");
}

function toBridgeRoute(routeName: RouteName, resumeSessionId?: string) {
  const browser = routeName === "safari" ? "safari" : "chrome";
  const attachMode = routeName === "chrome-relay" ? "relay" : "direct";

  return resumeSessionId ? { browser, attachMode, sessionId: resumeSessionId } : { browser, attachMode };
}

function createTransportError(payload: BridgeErrorEnvelope, fallbackMessage: string): Error & { details?: unknown } {
  const error = new Error(payload.error?.message ?? fallbackMessage) as Error & { details?: unknown };
  if (payload.error?.details !== undefined) {
    error.details = payload.error.details;
  }
  return error;
}

async function executeHttp(request: { method: "GET" | "POST"; path: string; body?: unknown }) {
  const response = await fetch(`${baseUrl}${request.path}`, {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  });

  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    throw createTransportError(body as BridgeErrorEnvelope, `HTTP ${response.status}`);
  }

  return { status: response.status, body };
}

function printConnection(connection: Awaited<ReturnType<typeof connectViaBridge>>) {
  console.log(`transport: http (${baseUrl})`);
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
  const adapter = createHttpBridgeAdapter({
    execute: executeHttp
  });

  try {
    const connection = await connectViaBridge(adapter, toBridgeRoute(selectedRoute, sessionId));
    printConnection(connection);
  } catch (error) {
    const details =
      typeof error === "object" && error !== null && "details" in error ? (error as { details?: unknown }).details : undefined;
    const errorUx = interpretBrowserAttachUxFromError({ details });

    console.error(`transport: http (${baseUrl})`);
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
