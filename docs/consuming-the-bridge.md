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
The canonical runtime-neutral wrapper guidance is [Adapter Patterns](./adapter-patterns.md).
If you are wiring this into an OpenClaw/browser-style UX, see the more product-facing adapter note at [OpenClaw-style consumer integration guide](./openclaw-style-consumer-integration.md).
If you are building the local Chrome relay writer itself, see [Chrome relay producer contract](./chrome-relay-producer-contract.md).

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

If your consumer needs examples for different wrapper styles without changing the underlying contract, use [Adapter Patterns](./adapter-patterns.md) as the canonical reference.

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
- After a successful relay resume, prefer the returned `resumedSession.session.attach` metadata over any previously cached relay session fields; `trustedAt`, `expiresAt`, `resumable`, and `resumeRequiresUserGesture` may have been refreshed from the current shared-tab probe.
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

## Runnable consumer examples

For narrow adapter-based consumer examples that stay runtime-neutral, use:

- HTTP consumer: [`examples/clients/http-consumer.ts`](../examples/clients/http-consumer.ts)
- CLI consumer: [`examples/clients/cli-consumer.ts`](../examples/clients/cli-consumer.ts)
- Expanded HTTP walkthrough: [`examples/clients/http-node.ts`](../examples/clients/http-node.ts)

The first two examples use the shared public helper path directly:

- `createHttpBridgeAdapter(...)` or `createCliBridgeAdapter(...)`
- `connectViaBridge(...)` for the attach vs resume flow
- `interpretBrowserAttachUxFromError(...)` for transport-neutral failure messaging

For a Codex-style route wrapper on the same shared stack, the package root also exposes:

- `normalizeCodexRoute(...)` for `safari | chrome-direct | chrome-relay` route names
- `connectCodexViaCli(...)` for a one-call CLI adapter + connect flow
- `connectCodexViaHttp(...)` for a one-call HTTP adapter + connect flow

See [`../examples/clients/codex-consumer.ts`](../examples/clients/codex-consumer.ts) for a runnable CLI-oriented example that stays on the same shared toolkit surface.

For a Claude Code-style consumer wrapper, the package root also exposes:

- `normalizeClaudeCodeRoute(...)` for `safari | chrome-direct | chrome-relay` route names
- `prepareClaudeCodeRoute(...)` for the explicit diagnostics-first, attach-or-resume, prompt-oriented wrapper flow

See [`../examples/clients/claude-code-tool.ts`](../examples/clients/claude-code-tool.ts) for a runnable CLI-oriented example that stays on the same shared toolkit surface.

They intentionally keep the same route choices across transports: `safari`, `chrome-direct`, and `chrome-relay`, plus optional resume through `LOCAL_BROWSER_BRIDGE_SESSION_ID`.

## Chrome relay parity example

Chrome relay uses the same contract semantics over both local transports:

- request relay explicitly with `attach.mode = relay`
- treat the returned session as `kind = "chrome-readonly"`
- label it as a shared-tab session when `semantics.inspect = "shared-tab-only"`
- treat `tab.windowIndex` / `tab.tabIndex` as synthetic placeholders when `semantics.tabReference.* = "synthetic-shared-tab-position"`
- present resume as "check the currently shared tab again" when `semantics.resume = "current-shared-tab"`

CLI:

```bash
local-browser-bridge diagnostics --browser chrome
local-browser-bridge attach --browser chrome --attach-mode relay
local-browser-bridge resume --id <session-id>
```

HTTP:

```bash
curl "http://127.0.0.1:3000/v1/diagnostics?browser=chrome"
curl -X POST http://127.0.0.1:3000/v1/attach \
  -H "content-type: application/json" \
  -d '{"browser":"chrome","attach":{"mode":"relay"}}'
curl -X POST "http://127.0.0.1:3000/v1/sessions/<session-id>/resume"
```

Consumers should make the same decisions from the returned `session.attach` and `session.semantics` fields regardless of whether the session came from CLI or HTTP.

When relay attach or relay resume fails, both transports emit the same additive transport-neutral error envelope. Formal artifacts:

- schema: [`schema/chrome-relay-error.schema.json`](../schema/chrome-relay-error.schema.json)
- example: [`examples/error.chrome-relay-share-required.example.json`](../examples/error.chrome-relay-share-required.example.json)

The stable additive `error.details` contract is:

- `error.details.context.browser = "chrome"`
- `error.details.context.attachMode = "relay"`
- `error.details.context.operation = "attach" | "resumeSession"`
- `error.details.relay.branch` for stable UX branching such as `click-toolbar-button`, `share-tab`, `share-original-tab-again`, `use-current-shared-tab`, `install-extension`, or `reconnect-extension`
- `error.details.relay.phase = "diagnostics" | "target-selection" | "session-precondition" | "shared-tab-match"`
- `error.details.relay.sharedTabScope = "current-shared-tab"`
- `error.details.relay.retryable` / `userActionRequired` so clients can decide whether to re-prompt, retry, or stop
- optional relay fields when relevant to the failure path: `currentSharedTabMatches`, `resumable`, `resumeRequiresUserGesture`, `expiresAt`, `sessionId`

Treat those fields as transport-neutral hints layered on top of the existing error `code` and `statusCode`. Do not infer browser-wide Chrome visibility from relay failures: relay remains shared-tab scoped, and consumers should not silently fall back between direct and relay paths.

### Relay failure UX branching

For Chrome relay failures, branch from `error.details` first and treat the branch as more reliable than transport status or free-form message text.

Recommended consumer mapping:

- `relay.branch = "share-tab"` or `"share-original-tab-again"` -> `share required`: ask the user to explicitly share the target tab again before retrying the same relay path.
- `relay.userActionRequired = true` -> `user action required`: keep the next step user-facing and do not imply the client can click the toolbar button, install the extension, or re-share for them.
- `relay.retryable = true` -> `retryable relay failure`: keep the selected relay route intact and offer a targeted retry after the stated user action or local fix completes.
- `relay.retryable = false` -> `non-retryable relay failure`: stop automatic retries on that route and surface the failure directly until diagnostics or product state changes.
- `relay.branch = "use-current-shared-tab"` or `relay.sharedTabScope = "current-shared-tab"` -> `shared-tab read-only scope limitation`: explain that relay only covers the currently shared tab and still does not imply browser-wide Chrome access or runtime actions.

Minimal consumer-neutral example:

```ts
import { interpretChromeRelayFailure } from "../src";

const interpretation = interpretChromeRelayFailure(error.details);

if (interpretation?.category === "share-required") {
  // ask the user to share the tab again, then retry the same relay path
}

if (interpretation?.category === "shared-tab-read-only-scope-limitation") {
  // keep the shared-tab wording explicit and do not imply browser-wide Chrome access
}
```

The helper returns a stable consumer-facing interpretation with category, retryable, userActionRequired, and shared-tab/read-only hints derived from `error.details.relay` without changing the underlying contract wording.

Both helpers are now intentionally discoverable through the package root re-export at [`src/index.ts`](../src/index.ts), so consumers can treat them as part of the public helper surface instead of reaching into sample-only paths.

The example HTTP consumer at [`examples/clients/http-node.ts`](../examples/clients/http-node.ts) uses the same public entrypoint and prints a relay failure category, retry guidance, and a shared-tab scope note from `error.details`.

### Attach/resume UX helper

If you want one small consumer-facing interpretation layer for diagnostics, sessions, and structured relay failures, use the stable public helper exported from [`src/index.ts`](../src/index.ts) and implemented in [`src/browser-attach-ux-helper.ts`](../src/browser-attach-ux-helper.ts).

It stays transport-neutral and agent-agnostic while standardizing a few stable UX fields:

- `state`: `ready`, `blocked`, `attached`, `resumed`, `user-action-required`, `retryable-failure`, or `non-retryable-failure`
- `label`: the same consumer-facing route/session label used for Safari actionable, Chrome direct read-only, and Chrome relay shared-tab read-only
- `prompt`, `retryGuidance`, and `scopeNote`: optional user-facing text derived from diagnostics, session metadata, or relay failure metadata
- `readOnly` and `sharedTabScoped`: explicit booleans so consumers do not imply browser-wide access for relay sessions or failures

Minimal example:

```ts
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession
} from "../src";

const routeUx = interpretBrowserAttachUxFromDiagnostics({
  browser: "chrome",
  attachMode: "relay",
  diagnostics
});

const sessionUx = interpretBrowserAttachUxFromSession({
  session,
  operation: "resumeSession"
});

const errorUx = interpretBrowserAttachUxFromError({
  details: error.details
});
```

This helper builds on the stable relay helper exported from [`src/index.ts`](../src/index.ts) and implemented in [`src/chrome-relay-error-helper.ts`](../src/chrome-relay-error-helper.ts) rather than replacing it. Use the narrower relay helper directly if you only need structured relay failure branching.

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

A practical consumer-neutral HTTP demo lives at [`examples/clients/http-node.ts`](../examples/clients/http-node.ts).

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
For equivalent wrapper guidance phrased for OpenClaw, AWOS, Codex, Claude Code, and custom consumers without privileging one runtime, see [Adapter Patterns](./adapter-patterns.md).

It shows one thin-adapter client flow:

1. fetch `/v1/capabilities`
2. fetch `/v1/diagnostics?browser=...` for the selected path
3. reject unknown `schemaVersion` values
4. choose an explicit route: `safari`, `chrome-direct`, or `chrome-relay`
5. attach or resume via `LOCAL_BROWSER_BRIDGE_SESSION_ID`
6. render different labels, prompts, and affordances for Safari actionable vs Chrome direct read-only vs Chrome relay shared-tab read-only

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
