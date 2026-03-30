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
      ready: true,
      state: "ready" as const,
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
  id: "sess-cli-relay",
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
  session,
  tab: session.tab,
  resumedAt: "2026-03-30T12:05:00.000Z",
  resolution: {
    strategy: "front" as const,
    matched: true,
    attachMode: "relay" as const,
    semantics: "current-shared-tab" as const
  }
};

function writeJson(payload: unknown) {
  process.stdout.write(JSON.stringify(payload));
}

const [command, ...args] = process.argv.slice(2);

if (command === "capabilities") {
  writeJson({ capabilities });
} else if (command === "diagnostics" && args[0] === "--browser" && args[1] === "chrome") {
  writeJson({ diagnostics });
} else if (command === "resume" && args[0] === "--id" && args[1] === "sess-cli-relay") {
  writeJson({ resumedSession });
} else {
  process.stderr.write(`Unexpected args: ${[command, ...args].join(" ")}`);
  process.exitCode = 1;
}
