import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type RouteName = "safari" | "chrome-direct" | "chrome-relay";

type Blocker = {
  code: string;
  message: string;
};

type StubState = {
  capabilities: unknown;
  diagnosticsByBrowser: Record<string, unknown>;
  attachResponseByMode: Record<string, unknown>;
  resumeResponse?: unknown;
  requests: Array<{ method?: string; url?: string; body?: unknown }>;
};

function createCapabilitiesPayload() {
  return {
    capabilities: {
      schemaVersion: 1,
      browsers: [
        {
          browser: "safari",
          kind: "safari-actionable",
          operations: {
            attach: true,
            diagnostics: true,
            resumeSession: true,
            activate: true,
            navigate: true,
            screenshot: true
          }
        },
        {
          browser: "chrome",
          kind: "chrome-readonly",
          operations: {
            attach: true,
            diagnostics: true,
            resumeSession: true,
            activate: false,
            navigate: false,
            screenshot: false
          }
        }
      ]
    }
  };
}

function createSafariDiagnostics(blockers: Blocker[] = []) {
  const ready = blockers.length === 0;
  return {
    diagnostics: {
      browser: "safari",
      checkedAt: "2026-03-28T12:00:00.000Z",
      preflight: {
        inspect: { ready, blockers },
        automation: { ready, blockers },
        screenshot: { ready: true, blockers: [] }
      }
    }
  };
}

function createChromeDiagnostics(args: {
  direct: { ready: boolean; state: "ready" | "degraded" | "attention-required" | "unavailable"; blockers?: Blocker[] };
  relay: { ready: boolean; state: "ready" | "degraded" | "attention-required" | "unavailable"; blockers?: Blocker[] };
}) {
  return {
    diagnostics: {
      browser: "chrome",
      checkedAt: "2026-03-28T12:00:00.000Z",
      attach: {
        direct: {
          mode: "direct",
          ready: args.direct.ready,
          state: args.direct.state,
          blockers: args.direct.blockers ?? []
        },
        relay: {
          mode: "relay",
          ready: args.relay.ready,
          state: args.relay.state,
          blockers: args.relay.blockers ?? []
        }
      }
    }
  };
}

function createSafariSession() {
  return {
    session: {
      id: "session-safari-demo",
      schemaVersion: 1,
      browser: "safari",
      kind: "safari-actionable",
      attach: { mode: "direct", scope: "browser" },
      semantics: {
        inspect: "browser-tabs",
        resume: "saved-browser-target",
        tabReference: { windowIndex: "browser-position", tabIndex: "browser-position" }
      },
      capabilities: { resume: true, activate: true, navigate: true, screenshot: true },
      status: { state: "actionable", canAct: true }
    }
  };
}

function createChromeDirectSession() {
  return {
    session: {
      id: "session-chrome-direct-demo",
      schemaVersion: 1,
      browser: "chrome",
      kind: "chrome-readonly",
      attach: { mode: "direct", scope: "browser" },
      semantics: {
        inspect: "browser-tabs",
        resume: "saved-browser-target",
        tabReference: { windowIndex: "browser-position", tabIndex: "browser-position" }
      },
      capabilities: { resume: true, activate: false, navigate: false, screenshot: false },
      status: { state: "read-only", canAct: false }
    }
  };
}

function createChromeRelaySession() {
  return {
    session: {
      id: "session-chrome-relay-demo",
      schemaVersion: 1,
      browser: "chrome",
      kind: "chrome-readonly",
      attach: {
        mode: "relay",
        scope: "tab",
        resumable: false,
        resumeRequiresUserGesture: true,
        expiresAt: "2099-03-28T12:00:00.000Z"
      },
      semantics: {
        inspect: "shared-tab-only",
        resume: "current-shared-tab",
        tabReference: {
          windowIndex: "synthetic-shared-tab-position",
          tabIndex: "synthetic-shared-tab-position"
        }
      },
      capabilities: { resume: true, activate: false, navigate: false, screenshot: false },
      status: { state: "read-only", canAct: false }
    }
  };
}

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
      response.end(JSON.stringify(state.capabilities));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/diagnostics") {
      const browser = url.searchParams.get("browser") ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state.diagnosticsByBrowser[browser]));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/attach") {
      const attachMode =
        body && typeof body === "object" && "attach" in body && body.attach && typeof body.attach === "object" && "mode" in body.attach
          ? String(body.attach.mode)
          : "direct";
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(state.attachResponseByMode[attachMode]));
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/sessions/") && url.pathname.endsWith("/resume")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state.resumeResponse));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: "not found", statusCode: 404 } }));
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise()))
    );
  }
}

async function runDemo(route: RouteName, args?: { baseUrl: string; sessionId?: string }) {
  return await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "examples/clients/http-node.ts", route],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_BROWSER_BRIDGE_URL: args?.baseUrl,
        LOCAL_BROWSER_BRIDGE_SESSION_ID: args?.sessionId
      }
    }
  );
}

test("http demo smoke: safari route uses capabilities + diagnostics and renders actionable labeling", async () => {
  const state: StubState = {
    capabilities: createCapabilitiesPayload(),
    diagnosticsByBrowser: {
      safari: createSafariDiagnostics(),
      chrome: createChromeDiagnostics({
        direct: { ready: false, state: "unavailable" },
        relay: { ready: false, state: "unavailable" }
      })
    },
    attachResponseByMode: {
      direct: createSafariSession(),
      relay: createChromeRelaySession()
    },
    requests: []
  };

  await withStubBridge(state, async (baseUrl) => {
    const result = await runDemo("safari", { baseUrl });

    assert.match(result.stdout, /Requested route: safari/);
    assert.match(result.stdout, /Capabilities: kind=safari-actionable/);
    assert.match(result.stdout, /Selected path: Safari \(actionable\)/);
    assert.match(result.stdout, /Diagnostics readiness: state=ready, ready=true/);
    assert.match(result.stdout, /Attaching via Safari \(actionable\)/);
    assert.match(result.stdout, /Session kind: safari-actionable/);
    assert.match(result.stdout, /User-facing label: Safari \(actionable\)/);
    assert.match(result.stdout, /Runtime actions: activate=true, navigate=true, screenshot=true/);

    assert.deepEqual(
      state.requests.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /v1/capabilities", "GET /v1/diagnostics?browser=safari", "POST /v1/attach"]
    );
    assert.deepEqual(state.requests[2]?.body, {
      browser: "safari",
      attach: { mode: "direct" }
    });
  });
});

test("http demo smoke: chrome-direct route renders read-only browser path and no silent relay fallback", async () => {
  const state: StubState = {
    capabilities: createCapabilitiesPayload(),
    diagnosticsByBrowser: {
      chrome: createChromeDiagnostics({
        direct: { ready: true, state: "ready" },
        relay: {
          ready: false,
          state: "attention-required",
          blockers: [{ code: "relay_share_required", message: "share first" }]
        }
      }),
      safari: createSafariDiagnostics()
    },
    attachResponseByMode: {
      direct: createChromeDirectSession(),
      relay: createChromeRelaySession()
    },
    requests: []
  };

  await withStubBridge(state, async (baseUrl) => {
    const result = await runDemo("chrome-direct", { baseUrl });

    assert.match(result.stdout, /Requested route: chrome-direct/);
    assert.match(result.stdout, /Capabilities: kind=chrome-readonly/);
    assert.match(result.stdout, /Selected path: Chrome \(direct, read-only\)/);
    assert.match(result.stdout, /Diagnostics readiness: state=ready, ready=true/);
    assert.match(result.stdout, /Attaching via Chrome \(direct, read-only\)/);
    assert.match(result.stdout, /Session kind: chrome-readonly/);
    assert.match(result.stdout, /Session attach mode: direct/);
    assert.match(result.stdout, /User-facing label: Chrome \(direct, read-only\)/);
    assert.match(result.stdout, /Show inspect\/resume UI only\. Hide activate\/navigate\/screenshot\./);

    assert.deepEqual(
      state.requests.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /v1/capabilities", "GET /v1/diagnostics?browser=chrome", "POST /v1/attach"]
    );
    assert.deepEqual(state.requests[2]?.body, {
      browser: "chrome",
      attach: { mode: "direct" }
    });
  });
});

test("http demo smoke: chrome-relay route renders shared-tab labeling and relay resume prompt", async () => {
  const state: StubState = {
    capabilities: createCapabilitiesPayload(),
    diagnosticsByBrowser: {
      chrome: createChromeDiagnostics({
        direct: { ready: false, state: "unavailable" },
        relay: { ready: true, state: "ready" }
      }),
      safari: createSafariDiagnostics()
    },
    attachResponseByMode: {
      direct: createChromeDirectSession(),
      relay: createChromeRelaySession()
    },
    requests: [],
    resumeResponse: {
      resumedSession: createChromeRelaySession()
    }
  };

  await withStubBridge(state, async (baseUrl) => {
    const result = await runDemo("chrome-relay", { baseUrl, sessionId: "saved-relay-session" });

    assert.match(result.stdout, /Requested route: chrome-relay/);
    assert.match(result.stdout, /Selected path: Chrome \(shared tab, read-only\)/);
    assert.match(result.stdout, /Diagnostics readiness: state=ready, ready=true/);
    assert.match(result.stdout, /Resuming saved session saved-relay-session for Chrome \(shared tab, read-only\)/);
    assert.match(result.stdout, /Session kind: chrome-readonly/);
    assert.match(result.stdout, /Session attach mode: relay/);
    assert.match(result.stdout, /User-facing label: Chrome \(shared tab, read-only\)/);
    assert.match(result.stdout, /Describe this as a shared-tab session, not a browser-wide Chrome session\./);
    assert.match(result.stdout, /Resume semantics: current-shared-tab/);
    assert.match(
      result.stdout,
      /Resume prompt: That shared-tab grant is no longer active\. Click the relay extension again on the original tab, then retry resume\./
    );

    assert.deepEqual(
      state.requests.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /v1/capabilities", "GET /v1/diagnostics?browser=chrome", "POST /v1/sessions/saved-relay-session/resume"]
    );
  });
});

test("http demo smoke: readiness blockers surface documented prompts without attempting attach", async () => {
  const state: StubState = {
    capabilities: createCapabilitiesPayload(),
    diagnosticsByBrowser: {
      chrome: createChromeDiagnostics({
        direct: {
          ready: false,
          state: "unavailable",
          blockers: [
            {
              code: "direct_unavailable_attach_endpoint_missing",
              message: "missing local DevTools endpoint"
            }
          ]
        },
        relay: { ready: false, state: "unavailable" }
      }),
      safari: createSafariDiagnostics()
    },
    attachResponseByMode: {
      direct: createChromeDirectSession(),
      relay: createChromeRelaySession()
    },
    requests: []
  };

  await withStubBridge(state, async (baseUrl) => {
    const result = await runDemo("chrome-direct", { baseUrl });

    assert.match(
      result.stdout,
      /User prompt: Chrome direct attach needs a local DevTools endpoint that is already available on this machine\./
    );
    assert.match(result.stdout, /Attach skipped because the selected path is not ready\./);
    assert.deepEqual(
      state.requests.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /v1/capabilities", "GET /v1/diagnostics?browser=chrome"]
    );
  });
});
