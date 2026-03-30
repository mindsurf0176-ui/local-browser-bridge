# Adapter Patterns

This document is the canonical adapter-pattern reference for consumers that want to integrate `local-browser-bridge` as a shared local browser surface without coupling the contract to one runtime, transport wrapper, or agent product.

Use this document alongside the general [Agent Integration Contract](./agent-integration-contract.md). The contract defines what is stable; this document shows how different consumer shapes can wrap the same contract honestly.

Examples of consumers that can use the same bridge contract:

- OpenClaw
- AWOS
- Codex
- Claude Code
- custom scripts, apps, and test harnesses

## Core guidance

Treat the bridge as one local product contract with two transport options:

- CLI for one-shot invocation
- local HTTP for long-running connectors

Keep the core integration rules transport-neutral and agent-agnostic:

1. Read `capabilities` first and gate on `schemaVersion` and `kind`.
2. Read `diagnostics` for the selected browser/mode before attach or resume.
3. Choose an explicit route instead of silently switching between Safari, Chrome direct, and Chrome relay.
4. Treat attach/resume responses as the authoritative runtime object.
5. Expose actions only from session capability bits, not from browser name or consumer branding.
6. Preserve shared-tab wording when `attach.mode = "relay"` or relay error details say the path is scoped to the current shared tab.

The bridge contract should stay recognizable across all consumers:

- `kind = "safari-actionable"` means the route may support runtime actions
- `kind = "chrome-readonly"` means the route is read-only in the current phase
- `session.capabilities.*` decides exact action exposure
- `session.attach` plus `session.semantics` decides browser-level vs shared-tab wording
- `error.details` remains the transport-neutral relay failure branch surface

## Canonical thin-adapter shape

`local-browser-bridge` now exposes this shared reference shape from its public entrypoint:

```ts
import { connectViaBridge, createBridgeAdapter, type BridgeAdapter } from "local-browser-bridge";
```

Every consumer can use the same minimal adapter loop even if the surrounding product UX differs:

```ts
type BridgeAdapter = {
  getCapabilities(): Promise<unknown>;
  getDiagnostics(browser: "safari" | "chrome"): Promise<unknown>;
  attach(args: { browser: "safari" | "chrome"; attachMode?: "direct" | "relay" }): Promise<unknown>;
  resume(sessionId: string): Promise<unknown>;
};

async function connectViaBridge(adapter: BridgeAdapter, route: {
  browser: "safari" | "chrome";
  attachMode?: "direct" | "relay";
  sessionId?: string;
}) {
  const capabilities = await adapter.getCapabilities();
  const diagnostics = await adapter.getDiagnostics(route.browser);

  if (route.sessionId) {
    return { capabilities, diagnostics, session: await adapter.resume(route.sessionId) };
  }

  return { capabilities, diagnostics, session: await adapter.attach(route) };
}
```

The exported `connectViaBridge(...)` helper is intentionally thin:

- it fetches `capabilities` and `diagnostics`
- it chooses `attach` vs `resume` from `sessionId`
- it normalizes either a raw session or `{ session }` result shape
- it returns `routeUx` and `sessionUx` using the shared helper surface

## Thin transport adapter modules

For consumers that want a ready-made transport wrapper instead of hand-rolling `BridgeAdapter`, the public entrypoint also exposes two narrow transport modules:

```ts
import {
  connectViaBridge,
  createCliBridgeAdapter,
  createHttpBridgeAdapter
} from "local-browser-bridge";
```

Use them as transport-specific shims over the same shared reference adapter contract:

- `createHttpBridgeAdapter(...)` maps HTTP JSON envelopes like `capabilities`, `diagnostics`, `session`, and `resumedSession` into the shared `BridgeAdapter` surface
- `createCliBridgeAdapter(...)` maps JSON CLI commands like `capabilities`, `diagnostics`, `attach`, and `resume` into the same surface

These modules stay intentionally modest. They do not redefine contract meaning or add product-specific behavior; they only adapt the existing HTTP or CLI transport into `createBridgeAdapter(...)`/`connectViaBridge(...)` friendly form.

What changes across consumers is the wrapper around this flow:

- how the route gets chosen
- where prompts get rendered
- whether the transport is CLI, HTTP, or a local abstraction over either

What should not change:

- contract gating from `schemaVersion`, `kind`, `session.capabilities`, `session.attach`, and `session.semantics`
- explicit direct vs relay labeling
- honest suppression of unsupported Chrome actions

## Shared consumer surface

Keep all consumer wrappers aligned to the same public helper surface and contract fields:

```ts
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession,
  interpretChromeRelayFailure
} from "local-browser-bridge";
```

Use the helpers as a thin interpretation layer over the same returned payloads:

- `interpretBrowserAttachUxFromDiagnostics(...)` for pre-attach route labeling and blocker prompts
- `interpretBrowserAttachUxFromSession(...)` for attached/resumed route labels and shared-tab wording
- `interpretBrowserAttachUxFromError(...)` for transport-neutral attach/resume failure messaging
- `interpretChromeRelayFailure(...)` when a consumer only needs relay-specific branching from `error.details`

## Consumer pattern examples

These are phrased as consumer styles, not privileged runtimes. Each pattern should integrate the same bridge contract.

### OpenClaw-style browser connector

Use the bridge as a local browser connector behind a richer browser UX:

- fetch and cache `capabilities` at connector startup
- read `diagnostics` before showing attach prompts
- normalize returned sessions into product labels such as Safari actionable, Chrome direct read-only, and Chrome shared-tab read-only
- keep action buttons driven by `session.capabilities`, not by browser-family assumptions

OpenClaw-specific UX notes can still live in a separate wrapper doc, but they should wrap this contract rather than redefine it.

Minimal adapter skeleton:

```ts
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromSession
} from "local-browser-bridge";

export async function connectBrowserRoute(adapter: BridgeAdapter, route: {
  browser: "safari" | "chrome";
  attachMode?: "direct" | "relay";
  sessionId?: string;
}) {
  const diagnostics = await adapter.getDiagnostics(route.browser);
  const routeUx = interpretBrowserAttachUxFromDiagnostics({
    browser: route.browser,
    attachMode: route.attachMode,
    diagnostics
  });

  const result = route.sessionId
    ? await adapter.resume(route.sessionId)
    : await adapter.attach(route);

  return {
    routeUx,
    sessionUx: interpretBrowserAttachUxFromSession({
      session: result.session,
      operation: route.sessionId ? "resumeSession" : "attach"
    }),
    session: result.session
  };
}
```

### AWOS-style local tool surface

Use the bridge as one local tool among other system integrations:

- expose bridge operations as local tool calls or internal actions
- route the caller into Safari, Chrome direct, or Chrome relay explicitly
- surface diagnostics blockers as next-step user instructions
- return saved-session metadata without hiding shared-tab limitations

The bridge stays a local browser integration surface, not an AWOS-specific protocol.

Minimal adapter skeleton:

```ts
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromError
} from "local-browser-bridge";

export async function runBrowserTool(adapter: BridgeAdapter, input: {
  browser: "safari" | "chrome";
  attachMode?: "direct" | "relay";
}) {
  const diagnostics = await adapter.getDiagnostics(input.browser);
  const routeUx = interpretBrowserAttachUxFromDiagnostics({
    browser: input.browser,
    attachMode: input.attachMode,
    diagnostics
  });

  if (routeUx.state === "blocked") {
    return { ok: false, routeUx };
  }

  try {
    return { ok: true, result: await adapter.attach(input) };
  } catch (error) {
    return {
      ok: false,
      errorUx: interpretBrowserAttachUxFromError({
        details: (error as { details?: unknown }).details
      })
    };
  }
}
```

### Codex-style coding agent integration

Use the bridge as a deterministic local dependency for a coding agent:

- call the CLI directly for one-shot operations, or wrap the local HTTP server for multi-step sessions
- branch on `kind` and `session.capabilities` before describing available browser actions
- keep relay failures structured by reading `error.details` instead of parsing prose output
- avoid presenting Chrome relay as browser-wide inspection access

If you want that shape as an actual thin helper instead of re-wiring the route mapping every time, import `normalizeCodexRoute(...)`, `connectCodexViaCli(...)`, or `connectCodexViaHttp(...)` from the package root. They keep the same route names (`safari`, `chrome-direct`, `chrome-relay`) and only layer Codex-oriented route normalization plus transport setup on top of the shared adapter/reference helpers.

Minimal adapter skeleton:

```ts
import {
  interpretBrowserAttachUxFromError,
  interpretBrowserAttachUxFromSession,
  interpretChromeRelayFailure
} from "local-browser-bridge";

export async function runAgentStep(adapter: BridgeAdapter, request: {
  browser: "safari" | "chrome";
  attachMode?: "direct" | "relay";
}) {
  try {
    const attached = await adapter.attach(request);

    return {
      session: attached.session,
      sessionUx: interpretBrowserAttachUxFromSession({
        session: attached.session,
        operation: "attach"
      })
    };
  } catch (error) {
    const details = (error as { details?: unknown }).details;

    return {
      errorUx: interpretBrowserAttachUxFromError({ details }),
      relay: interpretChromeRelayFailure(details)
    };
  }
}
```

### Claude Code-style tool wrapper

Use the bridge as a local tool wrapper with explicit user-facing prompts.

If you want the documented pattern as an actual thin shared-tool helper instead of copy-pasting the skeleton, import `normalizeClaudeCodeRoute(...)` and `prepareClaudeCodeRoute(...)` from the package root. They keep the same route names (`safari`, `chrome-direct`, `chrome-relay`), run diagnostics before attach/resume, short-circuit blocked routes into a prompt, and otherwise return the same shared-tool connection/session UX shape.

Use the bridge as a local tool wrapper with explicit user-facing prompts:

- check `diagnostics` before attach so the agent can explain local blockers cleanly
- keep Safari permission prompts separate from Chrome direct endpoint prompts and Chrome relay share prompts
- preserve `resumeRequiresUserGesture` and shared-tab scope wording when resuming relay sessions
- suppress unavailable runtime actions instead of hinting that the consumer can perform them anyway

Minimal adapter skeleton:

```ts
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromSession
} from "local-browser-bridge";

export async function prepareToolPrompt(adapter: BridgeAdapter, route: {
  browser: "safari" | "chrome";
  attachMode?: "direct" | "relay";
  sessionId?: string;
}) {
  const diagnostics = await adapter.getDiagnostics(route.browser);
  const routeUx = interpretBrowserAttachUxFromDiagnostics({
    browser: route.browser,
    attachMode: route.attachMode,
    diagnostics
  });

  if (routeUx.state === "blocked") {
    return { prompt: routeUx.prompt, routeUx };
  }

  const result = route.sessionId
    ? await adapter.resume(route.sessionId)
    : await adapter.attach(route);

  return {
    prompt: interpretBrowserAttachUxFromSession({
      session: result.session,
      operation: route.sessionId ? "resumeSession" : "attach"
    }).prompt,
    session: result.session
  };
}
```

### Custom consumer

Use the bridge as a reusable local browser contract regardless of implementation language or runtime:

- prefer additive parsing and ignore unknown future fields unless your consumer explicitly requires them
- keep the contract boundary at JSON payloads, not at a consumer-specific object model leaked back into the bridge
- choose CLI or HTTP based on lifecycle needs, not on contract differences
- keep examples, labels, and prompts scope-honest for Safari actionable vs Chrome read-only vs Chrome shared-tab read-only

Minimal adapter skeleton:

```ts
import {
  interpretBrowserAttachUxFromDiagnostics,
  interpretBrowserAttachUxFromSession
} from "local-browser-bridge";

export async function connect(adapter: BridgeAdapter, route: {
  browser: "safari" | "chrome";
  attachMode?: "direct" | "relay";
  sessionId?: string;
}) {
  const capabilities = await adapter.getCapabilities();
  const diagnostics = await adapter.getDiagnostics(route.browser);

  const result = route.sessionId
    ? await adapter.resume(route.sessionId)
    : await adapter.attach(route);

  return {
    capabilities,
    routeUx: interpretBrowserAttachUxFromDiagnostics({
      browser: route.browser,
      attachMode: route.attachMode,
      diagnostics
    }),
    sessionUx: interpretBrowserAttachUxFromSession({
      session: result.session,
      operation: route.sessionId ? "resumeSession" : "attach"
    }),
    session: result.session
  };
}
```

## Transport-neutral implementation choices

Choose transport by integration shape, not by semantics:

- CLI fits shell scripts, one-shot agents, and simple local orchestration
- HTTP fits long-running connectors, desktop apps, and local multiplexers

Both transports should preserve the same contract meaning:

- the same `schemaVersion`
- the same `kind`
- the same attach-mode distinction
- the same session capability bits
- the same relay error details when relay attach or resume fails

If a consumer wraps both transports, it should normalize them into one internal adapter and keep the bridge contract visible at the edges.

## Scope-honest consumer wording

Recommended wording principles:

- call Safari "actionable" only when the returned session capability bits allow action flows
- call Chrome "read-only" in the current phase
- call Chrome relay "shared-tab" when the session or error details indicate shared-tab scope
- do not imply browser-wide Chrome visibility from relay sessions or relay failures
- do not imply that any consumer can grant permissions, click extension buttons, or reopen the user's tab for them

## Related references

- [Agent Integration Contract](./agent-integration-contract.md)
- [Consuming local-browser-bridge](./consuming-the-bridge.md)
- [OpenClaw-style Consumer Integration Guide](./openclaw-style-consumer-integration.md)
