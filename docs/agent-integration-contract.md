# Agent Integration Contract

This document is the general integration contract for any agent or client consuming `local-browser-bridge`.

Examples: OpenClaw, Claude Code, Codex, editor plugins, desktop apps, local scripts, and test harnesses.

Use this as the primary consumer contract. Consumer-specific notes may wrap or rephrase it, but should not replace it.

## Required call order

Consumers should use the bridge in this order:

1. **Capabilities**: read the stable product contract.
2. **Diagnostics**: read current machine/browser readiness for the selected browser.
3. **Attach or resume**: only after capabilities and diagnostics agree that the path is appropriate.
4. **Session-driven behavior**: after attach/resume, drive UX and tool affordances from the returned session.

Do not skip directly to saved sessions or attach and then try to infer what the product supports.

## What each step is for

### 1) Capabilities

Read once at startup, connector init, or reconnect.

Use capabilities to answer:

- which browser kinds exist
- whether the browser kind is actionable or read-only
- which attach modes exist
- which operations the product supports in principle

Capabilities are the stable contract, not a readiness check.

### 2) Diagnostics

Read right before attach, right before resume, and whenever the agent needs to explain why a path is blocked.

Use diagnostics to answer:

- whether Safari is currently inspectable/actionable on this machine
- whether Chrome direct is currently discoverable
- whether Chrome relay is currently installed, connected, and shared
- which blocker codes and messages should be surfaced to the user

Diagnostics are current runtime state, not a substitute for capabilities.

### 3) Attach or resume

After selecting an explicit path:

- attach Safari as an actionable path
- attach Chrome direct as a browser-level read-only path
- attach Chrome relay as a shared-tab read-only path
- resume only when the selected path and current diagnostics still make sense for that saved session

Do not silently switch between Safari, Chrome direct, and Chrome relay.

### 4) Session-driven behavior

After attach or resume, treat the returned session as the authoritative runtime object.

Use the session to decide:

- what label to show
- whether the session is actionable or read-only
- whether `activate`, `navigate`, or `screenshot` should be exposed
- whether the session is browser-level or shared-tab scoped
- how resume should be explained

## Stable fields to rely on

These are the most important stable fields for agent consumers.

### Contract and routing

- `capabilities.schemaVersion`
- `capabilities.browsers[*].browser`
- `capabilities.browsers[*].kind`
- `capabilities.browsers[*].attachModes[*].mode`
- `capabilities.browsers[*].operations.*`

### Diagnostics and readiness

- `diagnostics.browser`
- `diagnostics.preflight.inspect.ready`
- `diagnostics.preflight.automation.ready`
- `diagnostics.preflight.screenshot.ready`
- `diagnostics.attach.direct.mode`
- `diagnostics.attach.direct.ready`
- `diagnostics.attach.direct.state`
- `diagnostics.attach.direct.blockers[]`
- `diagnostics.attach.relay.mode`
- `diagnostics.attach.relay.ready`
- `diagnostics.attach.relay.state`
- `diagnostics.attach.relay.blockers[]`

### Session behavior

- `session.schemaVersion`
- `session.kind`
- `session.status.state`
- `session.capabilities.resume`
- `session.capabilities.activate`
- `session.capabilities.navigate`
- `session.capabilities.screenshot`
- `session.attach.mode`
- `session.attach.scope`
- `session.semantics.inspect`
- `session.semantics.resume`
- `session.semantics.tabReference.windowIndex`
- `session.semantics.tabReference.tabIndex`

## Minimal behavior rules

### Compatibility gate

- Reject or downgrade when `schemaVersion !== 1`.
- Ignore unknown additive fields unless your consumer explicitly depends on them.

### Top-level behavior gate

Use `kind` first:

- `safari-actionable` = potentially actionable
- `chrome-readonly` = read-only in this phase

Do not infer actionability from browser name alone.

### Exact action gate

Use `session.capabilities` for actual tool exposure:

- show or call `activate` only when `session.capabilities.activate === true`
- show or call `navigate` only when `session.capabilities.navigate === true`
- show or call `screenshot` only when `session.capabilities.screenshot === true`

### Chrome mode gate

Use `attach.mode` plus `semantics` to separate:

- `direct` = browser-level read-only path
- `relay` = current shared-tab read-only path

If `session.attach.mode === "relay"`, treat the session as a saved shared-tab reference, not a browser-wide Chrome session.

## Decision tree

### A. Need actionable browser behavior

1. Read capabilities.
2. Require a browser entry with `kind === "safari-actionable"`.
3. Read Safari diagnostics.
4. If `diagnostics.preflight.inspect.ready !== true` or `diagnostics.preflight.automation.ready !== true`, stop and prompt from blockers.
5. Attach or resume Safari.
6. Expose runtime actions only from `session.capabilities.*`.

### B. Need Chrome browser visibility in read-only mode

1. Read capabilities.
2. Require a browser entry with `kind === "chrome-readonly"` and an attach mode with `mode === "direct"`.
3. Read Chrome diagnostics.
4. If `diagnostics.attach.direct.ready !== true`, stop and prompt from direct blockers.
5. Attach Chrome with `attach.mode = "direct"`.
6. Keep the session read-only even after attach.

### C. Need Chrome shared-tab read-only mode

1. Read capabilities.
2. Require a browser entry with `kind === "chrome-readonly"` and an attach mode with `mode === "relay"`.
3. Read Chrome diagnostics.
4. If `diagnostics.attach.relay.ready !== true`, stop and prompt from relay blockers.
5. Attach Chrome with `attach.mode = "relay"`.
6. Treat the returned session as shared-tab scoped.
7. Explain that resume may require the user to share the tab again.

## How to generate user prompts

Agents should generate prompts from machine-readable blockers first, then use blocker messages as fallback wording.

Recommended prompt rules:

1. Use the selected path only. Do not mix Safari blockers into Chrome prompts or vice versa.
2. Prefer the first blocker code for the main prompt.
3. Keep the prompt short, concrete, and action-oriented.
4. State what the user must do next.
5. Do not imply the agent can grant permissions, enable DevTools, or click the Chrome relay share button for the user.

### Prompt template

- **What is blocked**
- **What the user should do next**
- **What will happen after retry**

Example shape:

- `Safari needs macOS Automation permission. Grant access, then retry attach.`
- `Chrome direct is not available because no local DevTools endpoint was found. Start Chrome in that mode, then retry.`
- `Chrome relay is not ready because no tab is currently shared. Share the target tab, then retry.`

### High-signal blocker mappings

These codes should usually produce direct user instructions:

#### Safari

- `browser_not_running` → open Safari and retry
- `browser_no_windows` → open a normal Safari window and retry
- `browser_no_tabs` → focus or open a normal Safari tab and retry
- `apple_events_permission_denied` → grant macOS Automation/Apple Events permission and retry
- `screen_recording_permission_denied` → grant macOS Screen Recording permission and retry if screenshots are needed

#### Chrome direct

- `debugging_endpoint_not_found` or equivalent discovery blocker → start or expose Chrome with a local DevTools endpoint, then retry

#### Chrome relay

- `relay_extension_not_installed` → install the relay extension
- `relay_extension_disconnected` → reconnect or re-enable the relay extension
- `relay_toolbar_not_clicked` → click the relay toolbar button on the target tab
- `relay_share_required` → share the current tab, then retry
- `relay_no_shared_tab` → share a tab first, then retry
- `relay_session_expired` → share the original tab again, then retry resume

When an exact code is unknown, fall back to the blocker `message` and keep the wording honest.

## Anti-patterns to avoid

1. **Do not use diagnostics as the stable contract.**
   - Capabilities define what the product supports.
   - Diagnostics define what is ready now.

2. **Do not use saved sessions as readiness proof.**
   - A saved session can exist while the browser path is currently blocked.

3. **Do not branch on browser name alone.**
   - Use `kind`, `attach.mode`, and session capability bits.

4. **Do not silently fall back between routes.**
   - If the user or tool selected Safari, do not auto-switch to Chrome relay.
   - If the user or tool selected Chrome direct, do not quietly downgrade to relay.

5. **Do not present Chrome as actionable.**
   - In this phase, Chrome direct and Chrome relay are read-only.

6. **Do not treat relay as browser-wide Chrome access.**
   - Relay only represents the currently shared tab.

7. **Do not trust relay `windowIndex` / `tabIndex` as live browser coordinates.**
   - Treat them as synthetic placeholders when semantics say so.

8. **Do not expose actions without checking `session.capabilities`.**
   - Especially after resume.

## Prompt-friendly integration rules

These short rules are intended for agent prompts, tool wrappers, and thin adapters.

- Read `capabilities` first, `diagnostics` second, then attach or resume.
- Use `schemaVersion` for compatibility and `kind` for top-level routing.
- Treat Safari as the only actionable path in the current contract.
- Treat Chrome direct as browser-level read-only.
- Treat Chrome relay as shared-tab read-only.
- Never infer action support from browser name alone.
- Only expose `activate`, `navigate`, or `screenshot` when `session.capabilities` says they are true.
- Generate user prompts from blocker codes first and blocker messages second.
- Do not silently switch between Safari, Chrome direct, and Chrome relay.
- Do not imply the agent can perform user-only permission or share gestures.

## Related notes

- General consumer guide: [./consuming-the-bridge.md](./consuming-the-bridge.md)
- OpenClaw-specific wrapper: [./openclaw-style-consumer-integration.md](./openclaw-style-consumer-integration.md)
- OpenClaw adapter draft: [./openclaw-adapter-draft.md](./openclaw-adapter-draft.md)
