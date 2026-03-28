# Consuming local-browser-bridge

This guide is for any client that wants to integrate with `local-browser-bridge` without coupling itself to a specific agent runtime.

Examples of consumers:

- coding agents
- editor extensions
- desktop apps
- shell scripts
- local daemons
- test harnesses

The primary agent/client contract is [Agent Integration Contract](./agent-integration-contract.md).
If you are wiring this into an OpenClaw/browser-style UX, see the more product-facing adapter note at [OpenClaw-style consumer integration guide](./openclaw-style-consumer-integration.md).

## Integration model

The bridge exposes the same product contract through two local transports:

- **CLI** for one-shot invocation
- **HTTP** for long-running local integrations

Both surfaces return JSON and share the same contract concepts, including the same stable contract anchors for Safari actionable and Chrome/Chromium read-only behavior:

- `schemaVersion`
- `kind`
- `target`
- `session`
- `status`
- `capabilities`
- `semantics`

## Recommended client flow

1. Query **capabilities** once at startup or connector init.
2. Select a browser adapter by `browser` + `kind`, not by prose docs.
3. Decide which UI/actions to expose from `operations` and session-level `capabilities`.
4. Treat session payloads as self-describing; do not require a second lookup just to know whether a session can act.
5. Use `session.attach` plus `session.semantics` to distinguish direct Chrome sessions from relay-shared Chrome sessions.
6. For Chrome relay sessions, treat saved `tab.windowIndex` / `tab.tabIndex` as synthetic shared-tab placeholders, not as a live browser position.
7. Handle runtime failures separately from contract discovery:
   - **capabilities** = product contract
   - **diagnostics** = current machine/runtime state

## Stable contract rules

Current stable values:

- `schemaVersion: 1`
- `kind: "safari-actionable" | "chrome-readonly"`

Recommended handling:

- If `schemaVersion !== 1`, treat the payload as outside the current compatibility envelope.
- If `kind === "safari-actionable"`, action flows may be available, but still check `session.capabilities` before invoking a specific action.
- If `kind === "chrome-readonly"`, treat the session as inspect/resume oriented only and suppress runtime `activate`, `navigate`, and `screenshot` actions.
- If `session.attach.mode === "relay"`, treat the session as a saved reference to the last explicitly shared tab only.
- If `session.semantics.inspect === "shared-tab-only"`, do not imply that `/v1/tab` or `/v1/tabs` can enumerate general Chrome state through relay.
- If `session.semantics.resume === "current-shared-tab"`, present resume as "re-check the currently shared tab" rather than "re-open the saved browser tab".
- Prefer additive parsing. Ignore unknown future fields unless your client explicitly requires them.

## CLI example

Read capabilities:

```bash
local-browser-bridge capabilities
```

Attach a Safari tab and inspect the returned session metadata:

```bash
local-browser-bridge attach --browser safari --window-index 1 --tab-index 2
```

Resume a saved session later:

```bash
local-browser-bridge resume --id <session-id>
```

## HTTP example

Start the local server:

```bash
local-browser-bridge serve --host 127.0.0.1 --port 3000
```

Read capabilities:

```bash
curl "http://127.0.0.1:3000/v1/capabilities"
```

Attach a tab:

```bash
curl -X POST http://127.0.0.1:3000/v1/attach \
  -H "content-type: application/json" \
  -d '{"browser":"safari","target":{"windowIndex":1,"tabIndex":2}}'
```

Get a saved session later:

```bash
curl "http://127.0.0.1:3000/v1/sessions/<session-id>"
```

## Capability-routing example

A consumer can make a first-pass routing decision like this:

```ts
if (session.schemaVersion !== 1) {
  throw new Error("Unsupported local-browser-bridge schemaVersion");
}

switch (session.kind) {
  case "safari-actionable":
    // show activate/navigate/screenshot only if the exact capability bit is true
    break;
  case "chrome-readonly":
    // allow inspect + resume UX, suppress runtime tab actions
    if (session.attach.mode === "relay") {
      // label this as a saved shared-tab reference, not a browser-wide session
    }
    break;
}
```

## Practical HTTP consumer demo

A practical OpenClaw/browser-style consumer demo lives at [`examples/clients/http-node.ts`](../examples/clients/http-node.ts).

Quickest way to run it locally:

```bash
npm install
npm run build

# terminal 1
npm run serve

# terminal 2
npx tsx examples/clients/http-node.ts safari
# or: npx tsx examples/clients/http-node.ts chrome-direct
# or: npx tsx examples/clients/http-node.ts chrome-relay

# optional: resume a saved session for the selected path
LOCAL_BROWSER_BRIDGE_SESSION_ID=<session-id> npx tsx examples/clients/http-node.ts chrome-relay
```

This keeps the sample consumer-neutral: the bridge is still just an HTTP server, and `npx tsx` is only a convenient one-shot runner for the example file.

It shows one thin-adapter client flow:

1. fetch `/v1/capabilities`
2. fetch `/v1/diagnostics?browser=...` for the selected path
3. reject unknown `schemaVersion` values
4. choose an explicit route: `safari`, `chrome-direct`, or `chrome-relay`
5. attach or resume via `LOCAL_BROWSER_BRIDGE_SESSION_ID`
6. render different labels, prompts, and affordances for Safari actionable vs Chrome direct read-only vs Chrome relay read-only

How to interpret the demo:

- `safari`:
  - fetches Safari diagnostics and reports permission or browser-state blockers before attach
  - attaches with `attach.mode = direct`
  - shows actionable wording only when the returned session capability bits allow it
- `chrome-direct`:
  - fetches Chrome diagnostics and checks `attach.direct`
  - attaches with `attach.mode = direct`
  - keeps the UX browser-level but read-only
- `chrome-relay`:
  - fetches Chrome diagnostics and checks `attach.relay`
  - attaches with `attach.mode = relay`
  - keeps the UX scoped to the explicitly shared tab and may warn that resume needs another user gesture

Important:

- The demo does not imply Chrome actions exist.
- The demo does not silently switch from direct to relay or from relay to direct.
- If a selected path is not ready, the demo prints the relevant user-facing prompt and skips attach instead of masking the difference.

## Practical behavior summary

### Safari actionable path

Use when your client needs an actionable browser/session path for:

- inspect
- attach
- resume
- activate
- navigate
- screenshot

### Chrome read-only path

Use when your client needs a read-only browser/session path for:

- inspect
- attach
- resume

Do not assume runtime actions are available.

For Chrome relay specifically:

- `/v1/attach` with `attach.mode = relay` only succeeds for the tab currently shared by the local relay.
- `/v1/sessions` and `/v1/sessions/:id` return a saved relay-scoped session record; they do not imply broader Chrome inspection access.
- `/v1/sessions/:id/resume` only checks whether the currently shared relay tab still matches the saved session and may fail until the user shares again.

## Reference fixtures

- `examples/capabilities.example.json`
- `examples/session.safari-actionable.example.json`
- `examples/session.chrome-readonly.example.json`
- `examples/session.chrome-relay-readonly.example.json`
