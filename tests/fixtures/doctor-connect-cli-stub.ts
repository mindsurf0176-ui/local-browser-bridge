export {};

function writeJson(payload: unknown) {
  process.stdout.write(JSON.stringify(payload));
}

const [command, ...args] = process.argv.slice(2);
const route = args[1];

if (command === "doctor" && args[0] === "--route" && route === "chrome-relay") {
  writeJson({
    ok: false,
    command: "doctor",
    outcome: "blocked",
    status: "blocked",
    category: "route-blocked",
    reason: {
      code: "relay_share_required",
      message: "Share the tab first."
    },
    summary: "Chrome (shared tab, read-only) is not ready yet. It remains read-only and only covers the currently shared tab.",
    prompt: "Chrome relay only works for a tab you explicitly share. Share the tab first, then retry.",
    nextStep: {
      action: "fix-blocker",
      prompt: "Chrome relay only works for a tab you explicitly share. Share the tab first, then retry."
    },
    routeUx: {
      label: "Chrome (shared tab, read-only)",
      state: "blocked",
      readOnly: true,
      sharedTabScoped: true
    }
  });
} else if (command === "doctor" && args[0] === "--route" && route === "safari") {
  writeJson({
    ok: true,
    command: "doctor",
    outcome: "success",
    status: "ready",
    category: "route-ready",
    summary: "Safari (actionable) is ready for attach. It is actionable.",
    nextStep: {
      action: "connect",
      prompt: "Run local-browser-bridge connect --route safari to continue.",
      command: "local-browser-bridge connect --route safari"
    },
    routeUx: {
      label: "Safari (actionable)",
      state: "ready",
      readOnly: false,
      sharedTabScoped: false
    }
  });
} else if (command === "connect" && args[0] === "--route" && route === "safari") {
  writeJson({
    ok: true,
    command: "connect",
    connected: true,
    outcome: "success",
    status: "connected",
    category: "session-connected",
    summary: "Connected Safari (actionable) session session-safari-demo. It is actionable.",
    nextStep: {
      action: "session-ready",
      prompt: "Use session session-safari-demo for follow-up actions like activate, navigate, or screenshot."
    },
    routeUx: {
      label: "Safari (actionable)",
      state: "ready",
      readOnly: false,
      sharedTabScoped: false
    },
    sessionUx: {
      label: "Safari (actionable)",
      state: "ready",
      readOnly: false,
      sharedTabScoped: false
    },
    session: {
      id: "session-safari-demo",
      kind: "safari-actionable",
      capabilities: {
        activate: true,
        navigate: true,
        screenshot: true
      }
    }
  });
} else {
  process.stderr.write(`Unexpected args: ${[command, ...args].join(" ")}`);
  process.exitCode = 1;
}
