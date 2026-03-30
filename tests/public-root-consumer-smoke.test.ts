import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

type StubState = {
  requests: Array<{ method?: string; url?: string; body?: unknown }>;
};

const execFileAsync = promisify(execFile);

const capabilities = {
  schemaVersion: 1,
  kind: "local-browser-bridge",
  product: { name: "local-browser-bridge", version: "0.1.0" }
};

const diagnostics = {
  browser: "chrome" as const,
  checkedAt: "2026-03-30T12:00:00.000Z",
  runtime: {
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "v25.8.0",
    safariRunning: true
  },
  host: {
    osascriptAvailable: true,
    screencaptureAvailable: true,
    safariApplicationAvailable: true
  },
  supportedFeatures: {
    inspectTabs: true,
    attach: true,
    activate: true,
    navigate: true,
    screenshot: true,
    savedSessions: true,
    cli: true,
    httpApi: true
  },
  constraints: [],
  attach: {
    direct: {
      mode: "direct" as const,
      source: "user-browser" as const,
      scope: "browser" as const,
      supported: true,
      ready: false,
      state: "attention-required" as const,
      blockers: []
    },
    relay: {
      mode: "relay" as const,
      source: "extension-relay" as const,
      scope: "tab" as const,
      supported: true,
      ready: true,
      state: "ready" as const,
      blockers: []
    }
  }
};

const session = {
  schemaVersion: 1 as const,
  id: "sess-http-relay",
  kind: "chrome-readonly" as const,
  browser: "chrome" as const,
  target: { type: "front" as const },
  tab: {
    browser: "chrome" as const,
    windowIndex: 1,
    tabIndex: 1,
    title: "Shared tab",
    url: "https://example.com",
    attachedAt: "2026-03-30T12:00:00.000Z",
    identity: {
      signature: "sig",
      urlKey: "https://example.com",
      titleKey: "Shared tab",
      origin: "https://example.com",
      pathname: "/"
    }
  },
  frontTab: {
    browser: "chrome" as const,
    windowIndex: 1,
    tabIndex: 1,
    title: "Shared tab",
    url: "https://example.com",
    attachedAt: "2026-03-30T12:00:00.000Z",
    identity: {
      signature: "sig",
      urlKey: "https://example.com",
      titleKey: "Shared tab",
      origin: "https://example.com",
      pathname: "/"
    }
  },
  attach: {
    mode: "relay" as const,
    source: "extension-relay" as const,
    scope: "tab" as const,
    resumable: true
  },
  semantics: {
    inspect: "shared-tab-only" as const,
    list: "saved-session" as const,
    resume: "current-shared-tab" as const,
    tabReference: {
      windowIndex: "synthetic-shared-tab-position" as const,
      tabIndex: "synthetic-shared-tab-position" as const
    }
  },
  capabilities: {
    resume: true as const,
    activate: false,
    navigate: false,
    screenshot: false
  },
  status: {
    state: "read-only" as const,
    canAct: false
  },
  createdAt: "2026-03-30T12:00:00.000Z"
};

const resumedSession = {
  session: {
    ...session,
    id: "sess-cli-relay"
  },
  tab: session.tab,
  resumedAt: "2026-03-30T12:05:00.000Z",
  resolution: {
    strategy: "front" as const,
    matched: true,
    attachMode: "relay" as const,
    semantics: "current-shared-tab" as const
  }
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function withStubBridge<T>(state: StubState, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readJsonBody(request) : undefined;
    state.requests.push({ method: request.method, url: `${url.pathname}${url.search}`, body });

    if (request.method === "GET" && url.pathname === "/v1/capabilities") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ capabilities }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/diagnostics") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ diagnostics }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/attach") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ session }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
  }
}

async function runPublicConsumer(transport: "http" | "cli", arg1: string, route: "chrome-relay", sessionId?: string) {
  const fixtureEntrypoint = resolve(process.cwd(), "tests/fixtures/public-root-consumer-runner.js");
  const result = await execFileAsync(
    process.execPath,
    [fixtureEntrypoint, transport, arg1, route, ...(sessionId ? [sessionId] : [])],
    {
      cwd: process.cwd()
    }
  );

  return JSON.parse(result.stdout) as {
    operation: string;
    routeUx: { label: string };
    sessionUx: { sharedTabScoped?: boolean };
    session: { id: string; semantics: { resume: string } };
  };
}

test("public-root smoke: external-style HTTP and CLI consumers traverse the shared adapter stack", async (t) => {
  await t.test("http attach via package root import returns shared-tab session UX", async () => {
    const state: StubState = { requests: [] };

    await withStubBridge(state, async (baseUrl) => {
      const connection = await runPublicConsumer("http", baseUrl, "chrome-relay");

      assert.equal(connection.routeUx.label, "Chrome (shared tab, read-only)");
      assert.equal(connection.sessionUx.sharedTabScoped, true);
      assert.equal(connection.session.id, "sess-http-relay");
      assert.deepEqual(
        state.requests.map((entry) => `${entry.method} ${entry.url}`),
        ["GET /v1/capabilities", "GET /v1/diagnostics?browser=chrome", "POST /v1/attach"]
      );
      assert.deepEqual(state.requests[2]?.body, {
        browser: "chrome",
        attach: { mode: "relay" }
      });
    });
  });

  await t.test("cli resume via package root import returns resumed shared-tab semantics", async () => {
    const cliEntrypoint = resolve(__dirname, "fixtures/public-root-cli-stub.js");
    const connection = await runPublicConsumer("cli", cliEntrypoint, "chrome-relay", "sess-cli-relay");

    assert.equal(connection.operation, "resumeSession");
    assert.equal(connection.routeUx.label, "Chrome (shared tab, read-only)");
    assert.equal(connection.session.id, resumedSession.session.id);
    assert.equal(connection.session.semantics.resume, "current-shared-tab");
  });
});
