# Universal Toolkit Summary

`local-browser-bridge` has recently tightened from a browser-specific integration path into a shared local toolkit that multiple consumers can use without changing the core contract.

## What changed

- The Chrome relay path now has a structured error contract that stays aligned across CLI and local HTTP, with a schema and example payload for consumer branching instead of transport-specific guessing.
- Schemas, examples, and docs were brought into closer alignment so the stable contract anchors and relay failure details read the same way across machine-readable and human-readable surfaces.
- Relay/direct attach flows now have shared UX helpers for turning diagnostics, sessions, and attach/resume failures into honest route labels and prompts.
- The repo now exposes a public helper surface from `src/index.ts` so downstream consumers can import the shared interpretation logic instead of copying private wiring.
- A reference adapter shape now sits between the product contract and individual runtimes, with narrow HTTP and CLI transport adapters that map both transports into the same consumer-facing interface.
- Runnable consumer examples now demonstrate that shared adapter shape directly, instead of treating one transport or one host product as the privileged integration path.
- The adapter-pattern and onboarding docs now point new consumers toward universal wrapper patterns first, then transport choice at the edge.

## Why it matters

The bridge is easier to consume as one local product instead of as separate agent- or transport-specific integrations. Consumers can gate on the same contract fields, use the same helper surface, and switch between CLI and local HTTP without redefining behavior.

That broadens reuse, but it does not widen the product claims. The scope is still honest:

- Safari is the actionable v1 adapter.
- Chrome/Chromium is still read-only in v1.
- Relay attach/resume is scoped to the currently shared tab, not to general browser control.

## Where to start now

Start in this order:

1. [Agent Integration Contract](./agent-integration-contract.md) for the stable contract.
2. [Adapter Patterns](./adapter-patterns.md) for the shared consumer shape.
3. [Consuming local-browser-bridge](./consuming-the-bridge.md) for transport usage and runnable examples.
4. [src/index.ts](../src/index.ts) if you are importing the toolkit as code.

Use these artifacts when you need the concrete relay/error surfaces:

- [schema/chrome-relay-error.schema.json](../schema/chrome-relay-error.schema.json)
- [examples/error.chrome-relay-share-required.example.json](../examples/error.chrome-relay-share-required.example.json)
- [examples/clients/http-consumer.ts](../examples/clients/http-consumer.ts)
- [examples/clients/cli-consumer.ts](../examples/clients/cli-consumer.ts)
