# Chrome Attach Model for local-browser-bridge

This note proposes how `local-browser-bridge` should grow from **Chrome/Chromium read-only** into an OpenClaw-style local Chrome attach model without coupling the product to a single consumer.

The key design distinction is between two user-trust paths:

1. **Direct user-browser attach**: the bridge attaches to the user's existing browser profile and may enumerate or control tabs the browser makes available.
2. **Extension/relay attach**: the user explicitly clicks a toolbar button on the current tab to authorize a scoped attach for that tab.

The bridge should treat those as two **attach modes under the Chrome family**, not as consumer-specific product branches.

## Why this is better than consumer-specific hacks

Consumer-specific attach logic creates brittle behavior:

- each agent/runtime invents its own tab-discovery and permission story
- UX differs across clients even though the browser trust model is the same
- diagnostics become impossible to compare across consumers
- browser support gets fragmented into one-off integrations instead of a durable contract

`local-browser-bridge` should instead own one stable local contract for:

- capabilities
- attach flow
- session shape
- diagnostics
- trust boundaries

That lets OpenClaw-style clients, coding agents, desktop apps, and custom scripts consume the same model while rendering different UX on top.

## Product model

Chrome should remain one browser family with multiple attach modes.

### Mode A: direct user-browser attach

OpenClaw calls this the `profile=user` style concept.

In `local-browser-bridge` terms, this means:

- the bridge connects to a real local Chrome/Chromium instance associated with the user's profile
- the browser itself is the source of truth for available tabs and actions
- attach may require a one-time local consent step or browser attach approval
- the scope is broad relative to relay mode because the bridge is attaching to the user's browser environment, not just one tab

Best use cases:

- tab discovery across the user's current browser state
- richer session resume flows
- workflows where the client needs to choose among multiple tabs/windows
- trusted local tools where the user expects "use my browser" behavior

### Mode B: extension/relay attach

OpenClaw calls this the `profile=chrome-relay` style concept.

In `local-browser-bridge` terms, this means:

- a Chrome extension or relay helper exposes the currently active tab only after a user click on the toolbar button
- the click is the explicit consent gesture
- the bridge receives a scoped attach token/session for that tab or browsing context
- discovery is intentionally narrow and user-led

Best use cases:

- "attach to this tab now"
- sites where direct browser attach is unreliable, unavailable, or too broad for user comfort
- environments where the user should explicitly nominate the page before any inspection/control begins

## Recommendation: model this as a transport/runtime mode under Chrome

**Recommendation:** do **not** introduce a separate top-level actionable kind such as `chrome-relay-actionable` unless the session semantics meaningfully diverge long term.

Instead:

- keep Chrome as one browser family
- add **attach/runtime mode metadata** under Chrome sessions and capabilities
- continue to use `kind` for high-level action semantics, not attachment plumbing

Why:

- `kind` should answer "what can this session do?"
- attach mode should answer "how was trust established and what is the source of control?"
- direct attach and relay attach may both eventually be actionable, so splitting kinds too early would turn transport detail into product taxonomy
- clients can render the right UX from a stable combination of `browser`, `kind`, `capabilities`, and `attach.mode`

### Suggested shape

Illustrative only:

- `browser: "chrome"`
- `kind: "chrome-readonly" | "chrome-actionable"` in a future actionable phase
- `attach.mode: "direct" | "relay"`
- `attach.source: "user-browser" | "extension-relay"`
- `status.state: "read-only" | "actionable" | "attention-required"`

This keeps the contract honest:

- actionability lives in `kind` and per-session capabilities
- trust path and UX flow live in attach metadata and diagnostics

## Mapping onto local-browser-bridge concepts

### Capabilities

Capabilities should answer both **what Chrome supports in principle** and **which attach modes are currently available on this machine**.

Recommended additions:

- browser-level support for `attachModes.direct` and `attachModes.relay`
- diagnostics-backed readiness for each mode
- operation support per mode where needed

Examples:

- direct available, relay unavailable
- relay available, direct unavailable
- both available, but only relay approved for actionable control on the current tab

### Diagnostics

Diagnostics should become mode-aware, because the failure reasons differ.

Recommended split:

- `diagnostics.chrome.direct.*`
- `diagnostics.chrome.relay.*`

Direct attach diagnostics should report things like:

- browser not found
- attach approval pending
- remote debugging / attach endpoint unavailable
- profile access blocked
- browser version unsupported
- no inspectable targets found

Relay attach diagnostics should report things like:

- extension not installed
- extension installed but not connected
- relay host unreachable
- no tab shared yet
- shared tab expired
- user click required
- origin/page not relay-compatible if that ever matters

### Kind

Short term:

- keep `kind: "chrome-readonly"`
- add mode metadata now

Later, when Chrome actions are supported through either direct or relay paths:

- introduce `kind: "chrome-actionable"`
- keep direct vs relay as attach/runtime metadata, not as separate kinds

This gives clients one behavior gate for Chrome action support while preserving the trust-specific UX.

### Sessions

Sessions should record:

- browser family
- kind
- attach mode
- trust scope
- resumability constraints
- whether the session is tied to a whole browser context or one relayed tab

Direct session characteristics:

- usually broader discovery scope
- better multi-tab resume potential
- may survive tab switching if target identity remains matchable

Relay session characteristics:

- intentionally scoped to the user-nominated tab/context
- should make expiration/re-consent visible
- resume may require the user to click the toolbar button again if the relay grant is ephemeral
- list/session payloads should label these as saved shared-tab references, not as broader Chrome browser sessions
- any tab indexes surfaced for relay should be explicitly marked as synthetic placeholders for the shared-tab scope

### Attach flow

Direct attach flow:

1. Client checks capabilities and direct diagnostics.
2. If direct is available, client may call attach against current/front/chosen tab.
3. If approval is required, diagnostics should move to an attention-required state instead of failing generically.
4. On success, the returned session carries `attach.mode = direct`.

Relay attach flow:

1. Client checks capabilities and relay diagnostics.
2. If no live relay tab is available, client instructs the user to click the extension button on the tab they want.
3. The bridge receives or discovers the relay grant.
4. Client calls attach using the current relayed tab source.
5. The returned session carries `attach.mode = relay`.

### Trust model

This is the most important product distinction.

**Direct attach trust model**

- user trusts the bridge to connect to their browser environment
- scope is browser-level or profile-level, depending on adapter constraints
- best for power-user local tooling
- requires clearer warnings about breadth and visible browser presence

**Relay attach trust model**

- user trusts one explicit click on one current tab
- scope is narrower and easier to explain
- best for "use this page" interactions and first-run comfort
- gives a crisp user-consent ritual that is independent of any single AI client

The bridge should expose this difference clearly in both diagnostics and returned session metadata.

## UX constraints

The UX should make the two modes feel different on purpose.

### Direct attach UX constraints

- must clearly communicate that the bridge is attaching to the user's browser environment
- should prefer a chooser UX when multiple tabs are eligible
- must show when a browser approval/attach prompt is waiting
- should not silently fall back to relay without telling the user

### Relay attach UX constraints

- should be optimized for one instruction: **"Click the extension button on the tab you want to share."**
- should avoid suggesting global browser access when only a current-tab share is needed
- must surface expiry and re-click requirements plainly
- should not imply that all browser tabs are visible when only one relayed tab is in scope

### Cross-mode UX constraints

- clients should be able to ask for "best available attach" while still learning which mode was used
- diagnostics must be machine-readable enough for deterministic UI states
- mode changes should be visible in the session record so support/debugging is not guesswork

## Security and trust constraints

- local-only by default; no hidden remote control plane
- explicit user mediation for relay mode
- clear distinction between browser-wide attach and tab-scoped attach
- no fake capability claims: attach readiness and actionability must remain separate
- session persistence must not erase the original trust scope
- logs/diagnostics should avoid leaking more tab data than the current mode allows

A relay-scoped session should never be presented to consumers as equivalent to a fully attached user browser.

## Recommended diagnostics and error states

Recommended high-signal diagnostics states:

### Direct mode

- `direct_unavailable_browser_not_found`
- `direct_unavailable_attach_endpoint_missing`
- `direct_unavailable_profile_blocked`
- `direct_attention_user_approval_required`
- `direct_unavailable_no_targets`
- `direct_degraded_version_mismatch`

### Relay mode

- `relay_extension_not_installed`
- `relay_extension_disconnected`
- `relay_toolbar_not_clicked`
- `relay_share_required`
- `relay_no_shared_tab`
- `relay_unavailable_share_expired`
- `relay_degraded_bridge_extension_version_mismatch`

### Attach-time errors

- `attach_mode_not_supported`
- `attach_mode_not_ready`
- `attach_user_action_required`
- `attach_scope_expired`
- `attach_target_not_in_scope`
- `attach_session_not_resumable_in_current_mode`

These should be returned consistently across CLI and HTTP, with enough structure for clients to render exact next steps.

## Phased rollout

### v1.5

- Keep Chrome `kind` as `chrome-readonly`.
- Introduce Chrome attach-mode concepts in docs, capabilities, diagnostics, and session metadata.
- Support mode-aware diagnostics for `direct` and `relay` even before full action support exists.
- Add a preferred client flow of: check capabilities -> check diagnostics -> choose direct or instruct relay click -> attach.

This phase mainly standardizes product language and trust semantics.

### v2

- Add actionable Chrome support where the underlying attach path can honestly support it.
- Introduce `kind: "chrome-actionable"` only when operations like activate/navigate/screenshot are real and supportable.
- Preserve `attach.mode = direct|relay` as the explanation of how control was authorized.
- Keep some Chrome sessions read-only if the mode/runtime only supports inspection.

This phase upgrades capability, not just nomenclature.

## Decision / recommendation

### Headline recommendation

**Treat direct user-browser attach and extension/relay attach as two trust/transport modes under Chrome, not as separate Chrome product lines.**

### Concrete decision

- In the near term, keep Chrome under the existing browser family and keep `kind` focused on behavior (`chrome-readonly` now, `chrome-actionable` later).
- Add attach-mode metadata and diagnostics now: `direct` vs `relay`.
- Make relay the narrower explicit-consent path and direct the broader power-user path.
- Require clients to distinguish capability, readiness, and trust scope in UI.

That gives `local-browser-bridge` an OpenClaw-compatible local Chrome attach model while keeping the product consumer-neutral, diagnosable, and honest.
