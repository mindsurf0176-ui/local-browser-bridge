# local-browser-bridge

Reusable, agent-agnostic local browser bridge for AI clients, developer tools, and scripts.

`local-browser-bridge` is a small TypeScript/Node product that exposes a user's real local browser state through two consumer-neutral surfaces:

- a JSON CLI for local scripts, shells, and coding agents
- a local HTTP JSON API for editor plugins, desktop apps, daemon processes, or other clients

The project started as `safari-attach-tool`, but the product surface is now intentionally broader than any one consumer or agent runtime.

## Quick start

If you are new to the repo, start here:

- **Understand the toolkit surface first:** [src/index.ts](src/index.ts) is the shared consumer entrypoint. It re-exports the transport-neutral helper surface plus the reference CLI/HTTP adapters used by downstream runtimes and clients.
- **Use the contract artifacts as the source of truth:** start with [docs/agent-integration-contract.md](docs/agent-integration-contract.md), then the machine-readable schemas in [schema/capabilities.schema.json](schema/capabilities.schema.json) and [schema/chrome-relay-error.schema.json](schema/chrome-relay-error.schema.json), plus the example payloads in [examples/](examples/).
- **Pick a transport only at the edge:** the toolkit exposes the same bridge contract through the JSON CLI and the local HTTP API. Choose whichever fits your runtime; neither is the privileged path.
- **Copy from runnable consumers when wiring a client:** use [examples/clients/http-consumer.ts](examples/clients/http-consumer.ts), [examples/clients/cli-consumer.ts](examples/clients/cli-consumer.ts), and the end-to-end demo at [examples/clients/http-node.ts](examples/clients/http-node.ts).

## Canonical artifacts and docs

Use these artifacts as the canonical sources for product intent, integration behavior, consumer guidance, and the Chrome relay error contract:

- [PRD.md](PRD.md) - product requirements and direction
- [docs/universal-toolkit-summary.md](docs/universal-toolkit-summary.md) - short progress summary of the shared-toolkit direction and where to start
- [docs/agent-integration-contract.md](docs/agent-integration-contract.md) - transport-neutral integration contract
- [docs/adapter-patterns.md](docs/adapter-patterns.md) - canonical runtime-neutral adapter patterns for shared consumers
- [docs/consuming-the-bridge.md](docs/consuming-the-bridge.md) - consumer implementation guidance
- [src/index.ts](src/index.ts) - shared helper/reference-adapter entrypoint for consumers importing the toolkit as code
- [schema/capabilities.schema.json](schema/capabilities.schema.json) - stable capabilities contract schema
- [schema/chrome-relay-error.schema.json](schema/chrome-relay-error.schema.json) - Chrome relay error schema
- [examples/error.chrome-relay-share-required.example.json](examples/error.chrome-relay-share-required.example.json) - Chrome relay share-required example

## What this product is

`local-browser-bridge` is:

- **agent-agnostic**: Claude Code, Codex, AWOS, custom scripts, or any other client can consume the same contract
- **local-first**: it runs on the user's machine and exposes only local CLI and local HTTP transports
- **bridge-first**: the stable product artifact is the browser/session contract, not a single browser-specific script
- **Safari actionable in v1**: Safari on macOS is the first actionable adapter and sets the quality bar for the contract
- **Chrome/Chromium read-only in v1**: Chrome participates through the same contract, but action flows are intentionally unavailable in this phase

The canonical product requirements document lives in [PRD.md](PRD.md).
The short direction summary lives in [docs/product-direction.md](docs/product-direction.md).
The primary agent/client integration contract lives in [docs/agent-integration-contract.md](docs/agent-integration-contract.md).
The canonical runtime-neutral adapter patterns live in [docs/adapter-patterns.md](docs/adapter-patterns.md).
The client-consumption guide lives in [docs/consuming-the-bridge.md](docs/consuming-the-bridge.md).
For OpenClaw/browser-style consumer wiring specifically, see [docs/openclaw-style-consumer-integration.md](docs/openclaw-style-consumer-integration.md).
For the next-step OpenClaw adapter shape, see [docs/openclaw-adapter-draft.md](docs/openclaw-adapter-draft.md).

## Stable contract

The bridge has a stable additive contract that clients should key off directly:

- `schemaVersion = 1`
- `kind = "safari-actionable" | "chrome-readonly"`

Those fields appear in:

- the bridge capabilities payload (`capabilities.schemaVersion`, `capabilities.browsers[*].kind`)
- every saved/returned session payload (`session.schemaVersion`, `session.kind`)

### Contract guidance for clients

Treat the contract as follows:

- **Use `schemaVersion` for compatibility gates.** Current stable value is `1`.
- **Use `kind` as the top-level behavior switch.**
  - `safari-actionable` means the saved/current session is expected to support action flows.
  - `chrome-readonly` means inspection and saved-session resume may work, but runtime tab actions are intentionally unavailable in this phase.
- **Use `session.capabilities` for exact per-session checks** before showing or calling `activate`, `navigate`, or `screenshot`.
- **Use `session.attach` plus `session.semantics` for trust and UX labeling.**
  - Direct Chrome sessions represent a saved browser tab reference.
  - Relay Chrome sessions represent the last explicitly shared tab only.
- **Use `session.status.state` for quick UX labeling**:
  - `actionable`
  - `read-only`
- **Do not infer actionability from browser name alone.** Consume `kind`, `status`, and `capabilities` instead.

The machine-readable schema is in [schema/capabilities.schema.json](schema/capabilities.schema.json).

## Current browser behavior

### Safari: actionable

Safari on macOS is the primary adapter. It uses `osascript`/JXA plus `screencapture`; it is not a browser-native automation/debugging stack.

Current Safari behavior:

- inspect front tab / selected tab / tab list
- attach and persist sessions
- resume saved sessions after tab movement via fallback matching strategies
- activate a target or saved session
- navigate a target or saved session
- capture screenshots

Safari sessions are emitted as:

- `kind: "safari-actionable"`
- `status.state: "actionable"`
- session capabilities with `activate`, `navigate`, and `screenshot` set to `true`

### Chrome/Chromium: read-only

Chrome/Chromium is exposed through the same bridge contract, but in this phase it is deliberately honest and read-only.

Current Chrome/Chromium behavior:

- inspect front tab / selected tab / tab list when a local DevTools HTTP endpoint is already discoverable
- attach and persist sessions
- resume saved sessions in read-only mode when the same inspectable target can still be matched
- **no** runtime `activate`, `navigate`, or `screenshot`

Chrome sessions are emitted as:

- `kind: "chrome-readonly"`
- `status.state: "read-only"`
- session capabilities with `activate`, `navigate`, and `screenshot` set to `false`

## Features

- Inspect the current front tab
- Inspect an explicit tab by indexes or by signature
- List visible tabs with stable-ish identity metadata
- Attach and persist sessions locally
- Persist self-describing sessions with stable `schemaVersion` and `kind` metadata
- Resume saved sessions even after tabs move
- Return a machine-readable capabilities contract for clients and tools
- Report diagnostics about local browser/runtime constraints independently from capabilities
- Expose all supported functionality through both CLI and local HTTP

## Requirements

- macOS with Safari installed for Safari support
- Node.js 20+
- `osascript`
- `screencapture`

## Install

```bash
npm install
npm run build
```

Install from git as a dependency:

```bash
npm install <git-url>#<commit-ish>
```

The package uses `prepare`, so a git install builds `dist/` during installation and exposes the same stable root helper surface plus declarations through `local-browser-bridge`.

## Consumer surfaces and examples

### CLI

Primary binary:

```bash
local-browser-bridge --help
```

Compatibility alias:

```bash
safari-attach-tool --help
```

Common commands:

```bash
npm run cli -- capabilities
npm run cli -- capabilities --browser safari
npm run cli -- capabilities --browser chrome
npm run cli -- diagnostics --browser safari
npm run cli -- front-tab --browser safari
npm run cli -- tabs --browser safari
npm run cli -- attach --browser safari --window-index 1 --tab-index 2
npm run cli -- sessions
npm run cli -- session --id <session-id>
npm run cli -- resume --id <session-id>
npm run cli -- session-activate --id <session-id>
npm run cli -- session-navigate --id <session-id> --url https://example.com/next
npm run cli -- session-screenshot --id <session-id> --output .tmp/session.png
npm run cli -- serve --host 127.0.0.1 --port 3000
```

Commands:

- `front-tab [--browser safari|chrome]`
- `tab [--browser safari|chrome] (--window-index <n> --tab-index <n> | --signature <sig>)`
- `tabs [--browser safari|chrome]`
- `attach [--browser safari|chrome] [target flags]`
- `activate [--browser safari|chrome] [target flags]`
- `navigate [--browser safari|chrome] [target flags] --url <url>`
- `screenshot [--browser safari|chrome] [target flags] [--output <path>]`
- `capabilities [--browser safari|chrome]`
- `diagnostics [--browser safari|chrome]` (includes Safari `preflight.inspect|automation|screenshot` readiness when available)
- `sessions`
- `session --id <session-id>`
- `resume --id <session-id>`
- `session-activate --id <session-id>`
- `session-navigate --id <session-id> --url <url>`
- `session-screenshot --id <session-id> [--output <path>]`
- `serve [--host 127.0.0.1] [--port 3000]`

### Local HTTP API

Start the server:

```bash
npm run serve -- --host 127.0.0.1 --port 3000
```

Health:

```bash
curl http://127.0.0.1:3000/health
```

Capabilities:

```bash
curl "http://127.0.0.1:3000/v1/capabilities"
curl "http://127.0.0.1:3000/v1/capabilities?browser=safari"
curl "http://127.0.0.1:3000/v1/capabilities?browser=chrome"
```

Inspection and actions:

```bash
curl "http://127.0.0.1:3000/v1/front-tab?browser=safari"
curl "http://127.0.0.1:3000/v1/tabs?browser=safari"
curl "http://127.0.0.1:3000/v1/tab?browser=safari&windowIndex=1&tabIndex=2"

curl -X POST http://127.0.0.1:3000/v1/attach \
  -H "content-type: application/json" \
  -d '{"browser":"safari","target":{"windowIndex":1,"tabIndex":2}}'

curl -X POST http://127.0.0.1:3000/v1/sessions/<session-id>/resume
```

See [docs/consuming-the-bridge.md](docs/consuming-the-bridge.md) for fuller CLI and HTTP examples, including the practical HTTP consumer demo at [examples/clients/http-node.ts](examples/clients/http-node.ts).
For runtime-neutral wrapper patterns across OpenClaw, AWOS, Codex, Claude Code, and custom consumers, including copyable minimal adapter skeletons built on the shared helper surface, see [docs/adapter-patterns.md](docs/adapter-patterns.md).
If you are importing the toolkit directly instead of shelling out or calling HTTP, start from [src/index.ts](src/index.ts), which re-exports the shared helpers plus the CLI/HTTP reference adapters used in [examples/clients/cli-consumer.ts](examples/clients/cli-consumer.ts) and [examples/clients/http-consumer.ts](examples/clients/http-consumer.ts).

Quick copy-paste run for the demo:

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

The demo fetches `/v1/capabilities` plus `/v1/diagnostics`, then renders different consumer-facing labels and prompts for Safari actionable, Chrome direct read-only, and Chrome relay read-only. It keeps Chrome direct and relay explicit and does not silently fall back between them.

## Capability payload example

Reference fixture: [examples/capabilities.example.json](examples/capabilities.example.json)

```json
{
  "capabilities": {
    "schemaVersion": 1,
    "schema": {
      "path": "schema/capabilities.schema.json",
      "version": "1.0.0"
    },
    "product": {
      "name": "local-browser-bridge",
      "displayName": "local-browser-bridge",
      "summary": "Reusable, agent-agnostic local browser bridge with honest capability signaling. Safari is actionable; Chrome/Chromium is read-only in v1."
    },
    "targeting": {
      "modes": ["front", "indexed", "signature"]
    },
    "browsers": [
      {
        "kind": "safari-actionable",
        "browser": "safari",
        "maturity": "primary",
        "attachModes": [
          {
            "mode": "direct",
            "source": "user-browser",
            "scope": "browser",
            "supported": true,
            "readiness": "ready"
          }
        ],
        "operations": {
          "attach": true,
          "resumeSession": true,
          "activate": true,
          "navigate": true,
          "screenshot": true
        }
      },
      {
        "kind": "chrome-readonly",
        "browser": "chrome",
        "maturity": "experimental-readonly",
        "attachModes": [
          {
            "mode": "direct",
            "source": "user-browser",
            "scope": "browser",
            "supported": true,
            "readiness": "degraded"
          },
          {
            "mode": "relay",
            "source": "extension-relay",
            "scope": "tab",
            "supported": true,
            "readiness": "unavailable"
          }
        ],
        "operations": {
          "attach": true,
          "resumeSession": true,
          "activate": false,
          "navigate": false,
          "screenshot": false
        }
      }
    ]
  }
}
```

## Session payload examples

Reference fixtures:

- [examples/session.safari-actionable.example.json](examples/session.safari-actionable.example.json)
- [examples/session.chrome-readonly.example.json](examples/session.chrome-readonly.example.json)
- [examples/session.chrome-relay-readonly.example.json](examples/session.chrome-relay-readonly.example.json)
- [examples/error.chrome-relay-share-required.example.json](examples/error.chrome-relay-share-required.example.json)

Chrome relay failure contract artifacts:

- [schema/chrome-relay-error.schema.json](schema/chrome-relay-error.schema.json)
- [docs/consuming-the-bridge.md](docs/consuming-the-bridge.md)

### Safari session example

```json
{
  "session": {
    "schemaVersion": 1,
    "kind": "safari-actionable",
    "browser": "safari",
    "attach": {
      "mode": "direct",
      "source": "user-browser",
      "scope": "browser"
    },
    "semantics": {
      "inspect": "browser-tabs",
      "list": "saved-session",
      "resume": "saved-browser-target",
      "tabReference": {
        "windowIndex": "browser-position",
        "tabIndex": "browser-position"
      }
    },
    "status": {
      "state": "actionable",
      "canAct": true
    },
    "capabilities": {
      "resume": true,
      "activate": true,
      "navigate": true,
      "screenshot": true
    }
  }
}
```

### Chrome session example

```json
{
  "session": {
    "schemaVersion": 1,
    "kind": "chrome-readonly",
    "browser": "chrome",
    "attach": {
      "mode": "direct",
      "source": "user-browser",
      "scope": "browser"
    },
    "semantics": {
      "inspect": "browser-tabs",
      "list": "saved-session",
      "resume": "saved-browser-target",
      "tabReference": {
        "windowIndex": "browser-position",
        "tabIndex": "browser-position"
      }
    },
    "status": {
      "state": "read-only",
      "canAct": false
    },
    "capabilities": {
      "resume": true,
      "activate": false,
      "navigate": false,
      "screenshot": false
    }
  }
}
```

## Error shape

CLI stderr and HTTP errors share the same machine-readable structure:

```json
{
  "error": {
    "code": "missing_url",
    "message": "--url is required.",
    "statusCode": 400
  }
}
```

## Constraints

### Safari/macOS constraints

- Safari diagnostics now include a machine-readable `preflight` section so clients can distinguish attach/action readiness before calling attach, activate, navigate, or screenshot.
- Browser capability descriptors may now include additive `attachModes` metadata, and sessions may now include additive `attach` metadata so clients can distinguish direct user-browser attach from future extension relay attach without changing `kind`.
- Sessions now also include additive `semantics` metadata so clients can render truthful inspect/list/resume UX, especially for relay-scoped Chrome sessions.
- Chrome diagnostics now include a machine-readable `attach.direct` / `attach.relay` section with per-mode readiness, state, and blockers. Relay uses a local probe when available, and a minimal read-only relay attach can now create a session for the currently shared tab.
- When Safari has open windows but zero inspectable tabs, `front-tab`/tab resolution now returns `browser_no_tabs` instead of a generic availability error, matching the `preflight` blocker and empty `tabs` list.
- Safari access depends on Apple Events permission.
- Screenshots depend on Screen Recording permission.
- Activation, navigation, and screenshots visibly focus Safari.
- Session matching is heuristic, based on signature/url/title plus fallback indexes.
- If multiple tabs share the same URL/title, the first visible match may win.

### Chrome/Chromium constraints

- Inspection currently requires an already-running local DevTools HTTP endpoint.
- The adapter is intentionally read-only in this phase.
- Diagnostics enumerate attempted endpoint discovery sources when inspection is unavailable.
- Relay diagnostics can optionally consume a local JSON probe from `LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH`, `./.local-browser-bridge/chrome-relay-state.json`, or `~/.local-browser-bridge/chrome-relay-state.json`.
- Relay probe states distinguish extension missing, disconnected, user-click/share required, no-shared-tab, and expired-scope cases. When a shared tab is present, `attach.mode = relay` can create a read-only Chrome session for that tab.
- Chrome relay sessions are saved shared-tab references. They do not make `/v1/tab` or `/v1/tabs` relay-aware, and their `tab.windowIndex` / `tab.tabIndex` should be treated as synthetic shared-tab placeholders.
- Relay attach/resume failures reuse the same shared-tab-scoped `error.details` contract over CLI and HTTP. Consumers should branch on the returned relay metadata rather than guessing or silently falling back between direct and relay paths.

### Chrome relay probe

If you have a local extension/helper that can write relay state, point the bridge at a JSON file:

```bash
export LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH="$PWD/.local-browser-bridge/chrome-relay-state.json"
```

Producer contract and field guidance:

- [docs/chrome-relay-producer-contract.md](docs/chrome-relay-producer-contract.md)

Reference helper for local simulation:

```bash
npm run build

# defaults to ./.local-browser-bridge/chrome-relay-state.json unless --output or
# LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH is set
npx local-browser-bridge-chrome-relay extension-missing
npx local-browser-bridge-chrome-relay disconnected
npx local-browser-bridge-chrome-relay click-required
npx local-browser-bridge-chrome-relay share-required
npx local-browser-bridge-chrome-relay shared-tab --tab-id relay-42 --title "Shared Docs" --url https://example.com/docs
npx local-browser-bridge-chrome-relay expired-share --tab-id relay-42 --url https://example.com/docs
npx local-browser-bridge-chrome-relay clear-shared-tab
```

The helper reuses the bridge's relay validator before writing and replaces the full JSON snapshot through a temp-file rename, matching the producer contract's overwrite model.

Example probe payload:

```json
{
  "version": "1.1.0",
  "updatedAt": "2026-03-28T11:00:00.000Z",
  "extensionInstalled": true,
  "connected": true,
  "shareRequired": false,
  "userGestureRequired": false,
  "sharedTab": {
    "id": "tab-123",
    "title": "Relay Example",
    "url": "https://example.com/shared"
  }
}
```

If the probe reports a currently shared tab, `attach.relay.ready` becomes `true` and you can explicitly request relay attach with `--attach-mode relay` or `{ "attach": { "mode": "relay" } }`. Relay sessions stay `chrome-readonly`, are scoped to that one shared tab, and may carry truthful `resumable`, `resumeRequiresUserGesture`, `expiresAt`, and `trustedAt` metadata when the probe provides it. On successful saved-session resume, use the returned session as the fresh source of relay metadata for that currently shared tab. Saved relay sessions should be presented as "resume against the currently shared tab" rather than as general Chrome browser sessions.

If relay attach or relay resume fails, CLI stderr JSON and HTTP error responses now stay aligned through additive `error.details` metadata. Consumers can branch on `error.details.context.operation` plus `error.details.relay.branch` rather than inferring UX only from status codes or free-form text. The package root now re-exports two stable consumer utilities from `src/index.ts`: the narrower relay helper from `src/chrome-relay-error-helper.ts` and the broader attach/resume UX helper from `src/browser-attach-ux-helper.ts`. The sample HTTP client uses that public helper entrypoint directly.

## Contract files

- Canonical PRD: `PRD.md`
- Direction summary: `docs/product-direction.md`
- Consumer guide: `docs/consuming-the-bridge.md`
- Relay producer guide: `docs/chrome-relay-producer-contract.md`
- Relay state schema: `schema/chrome-relay-state.schema.json`
- Capabilities schema: `schema/capabilities.schema.json`
- Example fixtures: `examples/*.json`
- Runtime capability payloads: CLI `capabilities` and HTTP `GET /v1/capabilities`

## Storage

- Sessions: `.data/sessions.json`
- Screenshots: `.data/screenshots/*.png`

## Validation

```bash
npm test
```
