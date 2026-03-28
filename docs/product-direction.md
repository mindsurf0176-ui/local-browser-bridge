# local-browser-bridge Product Direction

This document is the short direction summary for `local-browser-bridge`.

For the canonical, fuller product requirements document, see [../PRD.md](../PRD.md).

## Manifesto

`local-browser-bridge` exists to give agents, local developer tools, desktop apps, and scripts one stable way to inspect browser state, persist/resume sessions, and perform only the scoped actions that the active browser adapter honestly supports without binding the product to a single agent runtime.

## Product definition

- Agent-agnostic: the bridge is a local systems component, not an opinionated agent framework.
- Safari actionable in v1: Safari on macOS is the first production adapter and the quality bar for the contract.
- Bridge-first: the core artifact is the transport-agnostic contract for browser capabilities, targets, sessions, and actions; adapters plug into that contract.
- Local-first: execution stays on the user's machine, with local CLI and local HTTP surfaces as the primary integration points.

## Near-term direction

- Keep the stable machine-readable contract explicit and consumer-neutral.
- Keep CLI and HTTP output aligned so external clients can discover support without scraping prose docs.
- Preserve the existing Safari behavior while keeping the contract generic enough for future adapters.
- Expose Chrome/Chromium through the contract honestly as read-only in this phase.
- Treat diagnostics as runtime state and capabilities as product contract; both should remain queryable independently.

## Stable contract anchors

- `schemaVersion = 1`
- `kind = "safari-actionable" | "chrome-readonly"`

## Non-goals for this phase

- Building a remote browser grid or hosted control plane.
- Replacing browser-native debugging protocols where they already exist.
- Broadening into full browser automation beyond scoped bridge operations.

## Related design notes

- [Chrome attach model](./chrome-attach-model.md): proposed direct user-browser attach vs extension/relay attach model for future Chrome evolution.
