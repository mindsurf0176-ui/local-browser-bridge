# local-browser-bridge PRD

## Document status

- **Product:** `local-browser-bridge`
- **Document type:** Product Requirements Document
- **Scope:** v1 product definition and near-term roadmap
- **Canonical status:** This is the canonical PRD for the repository.
- **Related docs:**
  - Direction summary: [`docs/product-direction.md`](docs/product-direction.md)
  - Consumer guide: [`docs/consuming-the-bridge.md`](docs/consuming-the-bridge.md)
  - Contract schema: [`schema/capabilities.schema.json`](schema/capabilities.schema.json)

---

## 1. Problem / context

Local AI clients and developer tools increasingly need access to the user's real browser state: what tab is open, what page is selected, whether a previously attached tab can be found again, and whether the client can safely perform a scoped action such as activate, navigate, or capture a screenshot.

Today, that need is often handled in brittle, consumer-specific ways:

- one-off scripts tied to a single agent runtime
- browser-specific glue with no stable contract
- hidden assumptions that a browser is actionable when it is not
- prose documentation that humans can read but clients cannot reliably route on
- transport-specific behavior drift between CLI and HTTP integrations

This creates real product problems for both tool builders and end users:

- clients must implement custom logic for each integration surface
- UX becomes misleading when a client offers actions that the local adapter cannot truly support
- browser support cannot evolve cleanly because consumers couple to implementation details instead of a product contract
- the same local machine capability has to be rediscovered separately by shells, editors, desktop apps, and agent runtimes

`local-browser-bridge` exists to solve that problem with one reusable, consumer-neutral local bridge for browser inspection and scoped action flows.

The product is not meant to belong to one app, one agent, or one orchestration framework. It is a shared local systems component that multiple clients can rely on consistently.

---

## 2. Product definition

`local-browser-bridge` is a local-first browser bridge that exposes a stable, machine-readable contract for inspecting browser state, attaching to tabs, persisting sessions, resuming those sessions later, and performing only the actions that the active browser adapter can honestly support.

The product has two primary integration surfaces:

- a JSON CLI for shells, scripts, and coding agents
- a local HTTP JSON API for long-running clients such as desktop apps, editor extensions, or local daemons

The product is:

- **agent-agnostic:** compatible with Claude Code, Codex, AWOS, custom scripts, editor tooling, and future clients
- **bridge-first:** the main artifact is the stable contract, not a single browser adapter implementation
- **local-first:** it runs on the user's machine and exposes local transports only
- **capability-honest:** clients should be able to discover what is supported without guessing from browser names or marketing language
- **additive-by-design:** future adapters and capabilities should extend the contract without breaking existing clients that parse it defensively

---

## 3. Target consumers / personas

### Primary consumer personas

#### 3.1 Coding agent integrator

A team building or configuring an agent that needs to inspect a user's real browser state and optionally perform scoped actions.

Examples:

- Claude Code integrations
- Codex-powered local tooling
- AWOS integrations
- custom agent harnesses

Needs:

- one stable contract instead of bespoke per-browser logic
- predictable JSON from CLI or HTTP
- honest capability bits for routing action flows

#### 3.2 Desktop or editor tool developer

A developer building a desktop app, menu bar utility, IDE plugin, or extension that needs local browser context.

Needs:

- long-running local API surface
- machine-readable diagnostics and capabilities
- compatibility that does not depend on a specific agent runtime

#### 3.3 Script / automation author

A user or developer writing shell scripts, local automation, or test harnesses.

Needs:

- one-shot CLI usage
- stable session persistence
- deterministic error shapes
- simple browser targeting modes

#### 3.4 End user of an AI client

A non-integrator user who expects their local tool to correctly describe what it can and cannot do with their browser.

Needs:

- no false promises about action support
- predictable behavior when permissions are missing
- clarity when a browser is inspectable but not actionable

---

## 4. Jobs-to-be-done

When a local client needs browser context, it should be able to:

1. **Discover available browser support** without scraping docs or relying on browser-name heuristics.
2. **Inspect the current or targeted tab** through a stable JSON response.
3. **Attach to a tab and persist a session** that remains meaningful beyond a single invocation.
4. **Resume a saved session later** even if a tab has moved, when the adapter can still match it.
5. **Route UX and actions honestly** based on machine-readable capability bits.
6. **Use either CLI or local HTTP** without re-learning a different conceptual model.
7. **Separate contract understanding from runtime health** by reading capabilities and diagnostics independently.
8. **Integrate once and support multiple clients** instead of rewriting browser glue for every runtime.

---

## 5. Product principles

### 5.1 Consumer neutrality

The bridge must not assume one preferred agent runtime. Product language, contracts, and examples should stay usable for any client category.

### 5.2 Honest capability signaling

The product must explicitly distinguish:

- what the contract allows in principle
- what a given browser kind supports
- what a specific saved/current session can do right now
- what runtime conditions or permissions are currently blocking execution

### 5.3 Transport parity

CLI and local HTTP should expose the same concepts, return shapes, and capability model wherever practical.

### 5.4 Stable core contract

Clients should be able to key off a small, dependable compatibility surface. For v1, that stable surface is centered on `schemaVersion` and `kind`.

### 5.5 Additive evolution

New browsers, fields, and operations should be added in ways that preserve compatibility for clients that defensively ignore unknown fields.

### 5.6 Scoped action surface

The bridge should focus on browser inspection, session attachment/resume, and a bounded set of supported actions. It is not a general-purpose browser automation platform.

### 5.7 Local-first trust model

The bridge runs on the user's machine and should minimize hidden remote dependencies, opaque state, and surprising behavior.

---

## 6. v1 goals

### 6.1 Core product goals

- Define and publish a canonical PRD for the reusable local browser bridge product.
- Ship one stable machine-readable contract that works across supported consumers.
- Keep the two local surfaces aligned: JSON CLI and local HTTP API.
- Preserve the current Safari adapter as the primary actionable implementation.
- Expose Chrome/Chromium honestly through the same contract as read-only in this phase.
- Make session payloads self-describing enough that clients can route behavior from the session itself.
- Make diagnostics queryable independently from capabilities.

### 6.2 v1 user outcome goals

By the end of v1, an integrator should be able to:

- determine compatibility using `schemaVersion = 1`
- distinguish browser behavior using `kind = "safari-actionable" | "chrome-readonly"`
- build one connector that works over CLI or HTTP
- suppress unsupported actions automatically from machine-readable contract data
- persist and resume sessions without bespoke per-browser state formats

---

## 7. Non-goals

The following are explicitly out of scope for this phase:

- building a hosted or remote browser control plane
- acting as a cloud browser grid or multi-machine orchestration layer
- replacing browser-native debugging protocols where they already solve a different problem well
- becoming a full browser automation framework
- promising equivalent action support across all browsers in v1
- hiding browser/runtime limitations behind optimistic UX
- coupling the product contract to a single agent framework, app shell, or vendor

---

## 8. Stable contract overview

The v1 stable contract is the main compatibility surface for consumers.

### 8.1 Stable fields

- `schemaVersion = 1`
- `kind = "safari-actionable" | "chrome-readonly"`

These values appear in:

- the bridge capabilities payload
- saved/returned session payloads

### 8.2 Contract intent

#### `schemaVersion`

Used for compatibility gating. Consumers should treat `schemaVersion: 1` as the current stable envelope and reject or degrade gracefully outside that envelope.

#### `kind`

Used as the top-level behavior switch for browser/session behavior.

- `safari-actionable`: expected to support action flows, subject to exact capability bits and runtime conditions
- `chrome-readonly`: inspection and resume-oriented behavior only in this phase; runtime actions are intentionally unavailable

### 8.3 Required client behavior

Consumers should:

- gate compatibility on `schemaVersion`
- route top-level behavior on `kind`
- confirm exact actions from `operations` and `session.capabilities`
- use `status.state` and related fields for user-facing labels
- avoid inferring support from browser name alone

### 8.4 Contract stability rules

- v1 changes should be additive where possible.
- Existing stable values must remain reliable for current consumers.
- New browsers or capabilities may be added without changing the meaning of v1 fields.
- Transport-specific discrepancies should be treated as defects.

---

## 9. Browser support matrix

| Browser / adapter | Kind | v1 support level | Inspect current/target tab | Attach session | Resume session | Activate | Navigate | Screenshot | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Safari on macOS | `safari-actionable` | Primary | Yes | Yes | Yes | Yes | Yes | Yes | Actionable adapter using local macOS automation primitives |
| Chrome / Chromium via discoverable local DevTools endpoint | `chrome-readonly` | Experimental read-only | Yes, when local endpoint is discoverable | Yes | Yes | No | No | No | Exposed through the same contract, but intentionally non-actionable in v1 |

### 9.1 Safari actionable

Safari is the first production-quality adapter and the quality bar for the contract.

Expected behavior in v1:

- inspect front tab and targeted tabs
- list tabs
- attach and persist sessions
- resume saved sessions after tab movement through fallback matching
- activate the matched target
- navigate the matched target
- capture screenshots

### 9.2 Chrome read-only

Chrome/Chromium participates in the same product contract, but the product must remain explicit that it is read-only in v1.

Expected behavior in v1:

- inspect front tab and targeted tabs when a local DevTools endpoint is already discoverable
- list tabs when available through the local endpoint
- attach and persist sessions
- resume matching saved sessions in read-only mode
- no runtime activate, navigate, or screenshot support

---

## 10. Surfaces

## 10.1 CLI surface

The CLI is the one-shot local integration surface for:

- shell usage
- scripts
- coding agents
- test harnesses
- development workflows

CLI requirements:

- return machine-readable JSON for normal operation
- expose the same core concepts as HTTP
- provide deterministic error shapes
- support capability discovery, diagnostics, inspection, attach, session lookup, and resume
- expose action commands only where the product contract defines them, even if runtime support varies by browser

## 10.2 Local HTTP surface

The local HTTP API is the long-running integration surface for:

- desktop apps
- editor extensions
- local daemons
- multi-process local systems

HTTP requirements:

- remain local-first in deployment model
- mirror the CLI contract closely
- support capabilities, diagnostics, inspection, attach, session lookup, resume, and action routes where applicable
- return the same conceptual entities and error semantics as the CLI

## 10.3 Surface parity expectations

Across CLI and HTTP, the product should preserve:

- the same contract vocabulary
- the same stable identifiers and field meanings
- the same browser kinds and capability logic
- the same session semantics
- the same distinction between product capabilities and runtime diagnostics

---

## 11. Functional requirements

### 11.1 Capability discovery

The product must:

- return a machine-readable capabilities payload
- include `schemaVersion`
- enumerate supported browsers/adapters and their `kind`
- expose operation-level support per browser
- describe targeting modes available through the bridge
- allow capability discovery independently from runtime diagnostics

### 11.2 Diagnostics

The product must:

- expose runtime diagnostics independently from capabilities
- describe local availability constraints such as permissions or endpoint discovery failures
- help clients distinguish unsupported contract behavior from temporarily unavailable runtime state

### 11.3 Inspection

The product must support:

- reading the current front/selected tab where the adapter allows it
- reading a specifically targeted tab by supported targeting modes
- listing visible tabs with enough metadata for client routing and display

### 11.4 Targeting

The product must support stable targeting concepts across surfaces, including:

- front/current tab
- indexed targeting
- signature-based targeting

The product should avoid requiring consumers to implement browser-specific target resolution logic.

### 11.5 Attach and session persistence

The product must:

- allow attaching to a targeted tab
- persist a session locally
- return a self-describing session payload
- preserve the session's `schemaVersion`, `kind`, `status`, and capability metadata

### 11.6 Resume

The product must:

- resume a previously saved session when the adapter can still match it
- support fallback matching strategies where applicable
- return clear failure information when resume is not possible

### 11.7 Browser actions

For adapters that support them, the product must provide scoped actions:

- activate
- navigate
- screenshot

For adapters that do not support them, the product must:

- signal that clearly in capabilities and session metadata
- avoid implying parity with actionable adapters

### 11.8 Error handling

The product must:

- return machine-readable errors
- use stable error codes where practical
- allow consumers to distinguish validation issues, unsupported actions, and runtime failures
- keep transport-neutral structured error details aligned across CLI and local HTTP when the same failure branch is being reported

#### 11.8.1 Chrome relay structured failure contract

For Chrome relay attach/resume failures, the product should expose an additive structured error contract that sits under the normal error envelope rather than replacing it.

Requirements:

- the canonical schema and example should be published as repository artifacts, not only described in prose
- the contract should remain consumer-neutral and transport-neutral so shells, desktop apps, coding agents, and custom clients can branch on the same fields
- the contract should be additive so existing consumers can continue keying off `error.code` / `statusCode` while newer consumers branch on richer relay details
- the contract must preserve truthful scope signaling: relay errors describe a shared-tab path only and must not imply browser-wide Chrome access

The canonical relay-specific fields are:

- `error.details.context.browser = "chrome"`
- `error.details.context.attachMode = "relay"`
- `error.details.context.operation = "attach" | "resumeSession"`
- `error.details.relay.branch`
- `error.details.relay.phase`
- `error.details.relay.sharedTabScope = "current-shared-tab"`
- `error.details.relay.retryable`
- `error.details.relay.userActionRequired`

Optional additive relay detail fields may include `currentSharedTabMatches`, `resumable`, `resumeRequiresUserGesture`, `expiresAt`, and `sessionId` when those facts are relevant to the failure path.

### 11.9 Session storage

The product must maintain local session persistence suitable for:

- reloading sessions across invocations
- exposing saved sessions to both CLI and HTTP consumers
- preserving enough metadata for later resume and capability routing

---

## 12. UX requirements for honest capability signaling

This product is consumed by other tools, but its contract directly shapes end-user UX. Honest capability signaling is therefore a product requirement, not just documentation quality.

### 12.1 Capability truthfulness

The bridge must never make a browser look actionable when the contract for that browser kind is read-only.

### 12.2 Session self-description

A client should be able to inspect a returned session and decide:

- whether the session is actionable
- which actions are supported
- how to label the session in UI

without having to infer behavior from browser name alone.

### 12.3 Clear distinction between unsupported and unavailable

Clients must be able to distinguish:

- **unsupported**: the contract/browser kind does not provide the action
- **unavailable**: the action exists in principle, but current runtime state blocks it

### 12.4 Action suppression guidance

When `kind = "chrome-readonly"` or session capabilities are false, consumers should suppress action affordances rather than showing them and failing late.

### 12.5 User-facing labels

The contract should support simple, accurate labels such as:

- actionable
- read-only
- resumable
- unavailable due to permissions/runtime state

### 12.6 No marketing drift

Examples, docs, fixtures, and payloads must all tell the same truth about browser support. If Chrome is read-only in v1, every surface should reinforce that.

---

## 13. Success metrics

### 13.1 Product metrics

- Consumers can integrate using documented contract fields without custom per-consumer patches.
- CLI and HTTP examples remain contract-aligned with no intentional semantic drift.
- At least one actionable browser kind and one read-only browser kind are represented cleanly under one stable contract.
- Session payloads are sufficient for downstream capability routing.

### 13.2 UX metrics

- Integrators can suppress unsupported actions without needing prose exceptions.
- Users are not offered Chrome actions that the bridge does not actually support.
- Runtime problems are diagnosed as runtime problems, not mistaken for missing product support.

### 13.3 Quality / maintainability metrics

- Schema and fixtures continue to reflect the canonical contract.
- Additive changes can be introduced without breaking current `schemaVersion: 1` consumers.
- Product docs clearly separate canonical PRD, consumer guidance, and implementation/schema references.

---

## 14. Rollout / roadmap

### 14.1 Phase 0: current foundation

- establish the product name and consumer-neutral positioning
- define the stable contract around `schemaVersion = 1` and browser `kind`
- support Safari as actionable and Chrome as read-only
- expose aligned CLI and HTTP surfaces

### 14.2 Phase 1: v1 completion

- ship canonical PRD and align repository docs around it
- keep README, consumer guide, schema, and examples consistent
- harden capability discovery and diagnostics separation
- validate that clients can route behavior entirely from contract data

### 14.3 Phase 2: contract expansion

Potential future work, subject to product review:

- additional browser adapters
- richer capability descriptors
- stronger session matching metadata
- clearer compatibility/version negotiation patterns
- more explicit permission and runtime-state reporting

### 14.4 Phase 3: ecosystem adoption

Potential future outcome:

- multiple agent and non-agent clients consuming the same bridge
- standardized local browser context handoff across tools
- broader adapter support without losing capability honesty

---

## 15. Open questions / risks

### 15.1 Open questions

- How should future browser kinds be named so they remain capability-honest and easy for clients to route on?
- Should there be a more explicit distinction between browser-family identity and behavioral kind in future schema versions?
- How much session-matching detail should be exposed without overfitting clients to adapter internals?
- What is the right threshold for introducing new top-level contract fields versus expanding nested capability metadata?
- Should local permission requirements eventually be normalized into a more structured diagnostics schema?

### 15.2 Product risks

- **Consumer coupling risk:** integrators may still key off browser names instead of `kind` and `schemaVersion`.
- **Honesty drift risk:** docs or examples may accidentally imply Chrome actionability before the product supports it.
- **Transport drift risk:** CLI and HTTP may diverge semantically over time.
- **Adapter leakage risk:** Safari implementation details could leak into the generic product model and bias future expansion.
- **Versioning risk:** future changes could tempt breaking semantics instead of additive evolution.
- **Runtime confusion risk:** users or clients may conflate missing permissions with missing product support unless diagnostics stay clear.

---

## 16. Canonical positioning summary

`local-browser-bridge` is a reusable, agent-agnostic local browser bridge that provides one stable contract for browser inspection, session persistence, session resume, and scoped actions where honestly supported.

In v1, the stable compatibility surface is:

- `schemaVersion = 1`
- `kind = "safari-actionable" | "chrome-readonly"`

Safari is the primary actionable adapter. Chrome/Chromium is intentionally read-only in this phase. CLI and local HTTP are equal product surfaces over the same contract.
