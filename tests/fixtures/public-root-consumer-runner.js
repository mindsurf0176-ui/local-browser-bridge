"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { connectViaBridge, createCliBridgeAdapter, createHttpBridgeAdapter } = require("local-browser-bridge");

const execFileAsync = promisify(execFile);

function normalizeRoute(value) {
  if (value === "safari" || value === "chrome-direct" || value === "chrome-relay") {
    return value;
  }

  throw new Error(`Unsupported route: ${value}`);
}

function toBridgeRoute(routeName, sessionId) {
  const browser = routeName === "safari" ? "safari" : "chrome";
  const attachMode = routeName === "chrome-relay" ? "relay" : "direct";

  return sessionId ? { browser, attachMode, sessionId } : { browser, attachMode };
}

async function connectViaPublicHttpConsumer(baseUrl, routeName, sessionId) {
  const adapter = createHttpBridgeAdapter({
    async execute(request) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body)
      });
      const text = await response.text();

      return {
        status: response.status,
        body: text.length > 0 ? JSON.parse(text) : {}
      };
    }
  });

  return connectViaBridge(adapter, toBridgeRoute(routeName, sessionId));
}

async function connectViaPublicCliConsumer(cliEntrypoint, routeName, sessionId) {
  const adapter = createCliBridgeAdapter({
    async execute(command) {
      const result = await execFileAsync(process.execPath, [cliEntrypoint, ...command.args], {
        cwd: process.cwd()
      });

      return { stdout: result.stdout };
    }
  });

  return connectViaBridge(adapter, toBridgeRoute(routeName, sessionId));
}

async function main() {
  const [transport, arg1, arg2, arg3] = process.argv.slice(2);

  if (transport === "http") {
    process.stdout.write(JSON.stringify(await connectViaPublicHttpConsumer(arg1, normalizeRoute(arg2), arg3)));
    return;
  }

  if (transport === "cli") {
    process.stdout.write(JSON.stringify(await connectViaPublicCliConsumer(arg1, normalizeRoute(arg2), arg3)));
    return;
  }

  throw new Error("Usage: public-root-consumer-runner.js <http|cli> <arg1> <route> [sessionId]");
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
