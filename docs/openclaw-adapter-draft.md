# OpenClaw Adapter Draft for local-browser-bridge

This note describes the next-step adapter that OpenClaw should own on the consumer side when integrating `local-browser-bridge`.

The goal is not to re-implement bridge semantics inside OpenClaw. The adapter should be a thin normalization and routing layer that:

- boots from bridge capabilities
- checks runtime diagnostics before attach/resume
- keeps direct vs relay trust boundaries explicit
- exposes one stable internal model to the rest of OpenClaw/browser consumers
- suppresses unsupported actions honestly

## Headline recommendation

Build one OpenClaw-side adapter module around a **normalized browser connection model**.

That adapter should:

- route first by bridge `kind`
- refine Chrome behavior with `attach.mode`
- treat Safari as the only actionable path in the current phase
- treat Chrome direct as browser-level read-only
- treat Chrome relay as shared-tab read-only
- keep attach/readiness/prompting separate from session rendering

Do not let the rest of OpenClaw inspect raw bridge payloads directly.

## Adapter responsibilities

### 1) Capabilities bootstrap

At connector startup and reconnect, the adapter should fetch `/v1/capabilities` once and cache:

- `schemaVersion`
- available browser entries
- supported attach modes
- stable product-level operation support

The adapter should reject unknown schema versions early and return one compatibility error for the caller.

It should not use diagnostics as a substitute for the stable contract.

### 2) Diagnostics and readiness checks

Before attach, resume, or any user-facing "connect browser" flow, the adapter should fetch `/v1/diagnostics?browser=...` and normalize readiness into OpenClaw states.

Use diagnostics for:

- Safari permission blockers
- Safari browser-not-running / no-window states
- Chrome direct endpoint availability
- Chrome direct approval / readiness issues
- Chrome relay extension / connection / share / expiry issues

The adapter should convert raw blockers into deterministic UX states plus one primary prompt.

### 3) Direct vs relay path selection

OpenClaw should choose a path explicitly, not silently.

Recommended selection behavior:

- If the caller asks for Safari control, route to Safari only.
- If the caller asks for Chrome shared-tab or relay, route to Chrome relay only.
- If the caller asks for Chrome generically:
  - prefer Chrome direct when direct diagnostics are ready and the product wants browser-level inspection
  - otherwise offer the relay path explicitly as a narrower shared-tab flow
- If the caller asks for a generic "browser" attach:
  - prefer Safari when actionability is required
  - otherwise choose the browser requested by the surrounding UX, but still expose which route was actually selected

Never downgrade direct to relay without changing the label and prompting language.

### 4) Safari actionable vs Chrome read-only routing

Current routing rules should be hard-coded from bridge truth:

- `kind = safari-actionable` -> actionable route candidate
- `kind = chrome-readonly` -> read-only route candidate

Then refine with per-session capability bits:

- show `activate` only if `session.capabilities.activate === true`
- show `navigate` only if `session.capabilities.navigate === true`
- show `screenshot` only if `session.capabilities.screenshot === true`

In the current bridge, this means:

- Safari may expose attach, resume, activate, navigate, screenshot
- Chrome direct may expose inspect, attach, resume only
- Chrome relay may expose inspect, attach, resume only, with shared-tab semantics and possible re-share requirements

### 5) Session attach and resume handling

The adapter should own attach/resume orchestration so callers do not need to understand bridge quirks.

Attach flow responsibilities:

- choose browser + attach mode
- run diagnostics first
- issue attach only when the selected path is ready or when the user has been given the needed prompt
- normalize the returned session immediately

Resume flow responsibilities:

- load the saved session
- preserve original route metadata from the saved session
- re-check diagnostics for that browser/mode before trying resume
- if relay session metadata says `resumeRequiresUserGesture === true`, short-circuit into a prompt state before attempting resume
- if relay `expiresAt` is already expired, return a re-share-required state instead of generic failure
- after resume, return the same normalized model shape as attach

## Suggested internal adapter interface

A practical split is one transport client plus one adapter.

```ts
type BrowserRouteRequest =
  | { browser: "safari"; mode?: "direct" }
  | { browser: "chrome"; mode?: "direct" | "relay" }
  | { browser: "auto"; requireActionable?: boolean };

type NormalizedBrowserConnection = {
  schemaVersion: number;
  sessionId?: string;
  browser: "safari" | "chrome";
  kind: "safari-actionable" | "chrome-readonly";
  route: "safari-direct" | "chrome-direct" | "chrome-relay";
  status: "ready" | "attention-required" | "blocked" | "attached" | "resumed" | "error";
  state: "actionable" | "read-only" | "unavailable";
  scope: "browser" | "tab";
  trust: "user-browser" | "shared-tab";
  canInspect: boolean;
  canAttach: boolean;
  canResume: boolean;
  canActivate: boolean;
  canNavigate: boolean;
  canScreenshot: boolean;
  diagnosticsReady: boolean;
  primaryBlockerCode?: string;
  primaryPrompt?: string;
  resumeRequiresUserGesture?: boolean;
  expiresAt?: string;
  semantics: {
    inspect: string;
    resume: string;
    tabReferenceWindowIndex: "browser-position" | "synthetic-shared-tab-position";
    tabReferenceTabIndex: "browser-position" | "synthetic-shared-tab-position";
  };
  tab?: {
    title: string;
    url: string;
    windowIndex?: number;
    tabIndex?: number;
    signature?: string;
    nativeTargetId?: string;
  };
  raw: {
    diagnostics?: unknown;
    session?: unknown;
    capabilities?: unknown;
  };
};

interface LocalBrowserBridgeAdapter {
  bootstrap(): Promise<void>;
  getCapabilities(): Promise<NormalizedBrowserConnection[]>;
  checkReadiness(request: BrowserRouteRequest): Promise<NormalizedBrowserConnection>;
  attach(request: BrowserRouteRequest): Promise<NormalizedBrowserConnection>;
  resume(sessionId: string): Promise<NormalizedBrowserConnection>;
  getSession(sessionId: string): Promise<NormalizedBrowserConnection>;
  listSessions(): Promise<NormalizedBrowserConnection[]>;
  getUserPrompt(request: BrowserRouteRequest | { sessionId: string }): Promise<string | undefined>;
}
```

### Why this interface is useful

It gives OpenClaw one place to ask:

- what path is available
- what path was selected
- whether the current route is actionable or read-only
- what prompt should be shown next
- what operations can be surfaced right now

The rest of OpenClaw should consume `NormalizedBrowserConnection`, not raw bridge JSON.

## Normalized model mapping

### Route mapping

| Bridge payload | OpenClaw normalized route |
|---|---|
| `browser=safari`, `kind=safari-actionable`, `attach.mode=direct` | `safari-direct` |
| `browser=chrome`, `kind=chrome-readonly`, `attach.mode=direct` | `chrome-direct` |
| `browser=chrome`, `kind=chrome-readonly`, `attach.mode=relay` | `chrome-relay` |

### State mapping

| Bridge data | OpenClaw state |
|---|---|
| `status.state = actionable` | `state = actionable` |
| `status.state = read-only` | `state = read-only` |
| diagnostics not ready / blockers present | `status = attention-required` or `blocked` |
| attach success | `status = attached` |
| resume success | `status = resumed` |

### Trust/scope mapping

| Bridge data | OpenClaw fields |
|---|---|
| `attach.source = user-browser` | `trust = user-browser` |
| `attach.source = extension-relay` | `trust = shared-tab` |
| `attach.scope = browser` | `scope = browser` |
| `attach.scope = tab` | `scope = tab` |

### Operation mapping

| Bridge field | OpenClaw flag |
|---|---|
| `capabilities.resume` | `canResume` |
| `capabilities.activate` | `canActivate` |
| `capabilities.navigate` | `canNavigate` |
| `capabilities.screenshot` | `canScreenshot` |
| any attached session | `canInspect = true` |

### Semantics mapping

| Bridge field | OpenClaw meaning |
|---|---|
| `semantics.inspect = browser-tabs` | browser-level inspection language is allowed |
| `semantics.inspect = shared-tab-only` | label as shared tab, not browser-wide attach |
| `semantics.resume = saved-browser-target` | normal saved-session resume copy |
| `semantics.resume = current-shared-tab` | resume copy must say re-check current shared tab |
| `semantics.tabReference.* = synthetic-shared-tab-position` | do not render window/tab index as real browser coordinates |

## Mapping to OpenClaw/browser UI states and actions

### UI state: Safari actionable ready

Conditions:

- route `safari-direct`
- diagnostics ready
- session or capabilities indicate actionable support

Surface:

- connect/attach
- resume
- activate
- navigate
- screenshot

### UI state: Safari attention required

Conditions:

- Safari diagnostics blocker on automation or screenshot preflight

Surface:

- permission explanation
- retry action
- no misleading "connected" state

### UI state: Chrome direct read-only ready

Conditions:

- route `chrome-direct`
- direct diagnostics ready

Surface:

- connect/attach
- resume
- inspect/read-only browsing context label
- no activate/navigate/screenshot

### UI state: Chrome relay read-only waiting for share

Conditions:

- route `chrome-relay`
- blocker like `relay_toolbar_not_clicked`, `relay_share_required`, `relay_no_shared_tab`, or expired scope

Surface:

- one shared-tab instruction
- retry attach or resume
- no browser-wide language
- no runtime actions

### UI state: Chrome relay read-only attached

Conditions:

- relay diagnostics ready
- relay attach succeeded

Surface:

- shared tab title/url
- resume copy that may mention re-share requirement
- no runtime actions

## User prompt handling

The adapter should return prompts as structured state first, human string second. OpenClaw can localize or rephrase later.

### Safari permissions

Trigger when Safari diagnostics report automation or screenshot blockers.

Recommended prompt family:

- **Safari needs macOS Automation permission before OpenClaw can control tabs. Grant access, then retry.**
- **Safari screenshots also require Screen Recording permission on this Mac.**
- **Safari is not running or has no inspectable window open yet. Open Safari and retry.**

### Chrome direct endpoint / approval issues

Trigger when direct diagnostics are not ready.

Recommended prompt family:

- **Chrome direct attach needs a local DevTools endpoint that is already available on this machine.**
- **Chrome direct attach is waiting on local browser approval or attach readiness. Finish that step, then retry.**
- **Chrome is reachable only in read-only mode here; runtime tab actions are not available.**

Do not imply that OpenClaw can grant or bypass Chrome approval itself.

### Chrome relay click / share issues

Trigger from relay blockers such as:

- `relay_toolbar_not_clicked`
- `relay_share_required`
- `relay_no_shared_tab`
- `relay_attach_scope_expired`
- `relay_extension_not_installed`
- `relay_extension_disconnected`

Recommended prompt family:

- **To connect this Chrome tab, click the relay extension button on the tab you want to share.**
- **Chrome relay only works for a tab you explicitly share. Share the tab first, then retry.**
- **That shared-tab grant expired. Click the relay extension again on the original tab, then retry.**
- **The Chrome relay extension is not installed or not connected on this machine yet.**

## Anti-patterns to avoid

1. **Letting UI code branch on browser name alone**
   - always branch on `kind`, then refine with `attach.mode`

2. **Exposing raw bridge payloads throughout OpenClaw**
   - normalize once in the adapter

3. **Pretending Chrome relay is equivalent to browser-wide Chrome attach**
   - it is a shared-tab path only

4. **Showing Chrome action buttons in disabled or optimistic form**
   - current Chrome path is read-only; omit runtime actions

5. **Using saved sessions as readiness proof**
   - saved session presence is not current readiness

6. **Treating relay tab indexes as real window/tab coordinates**
   - they may be synthetic placeholders

7. **Silent fallback between Chrome direct and relay**
   - route changes must be visible to the user

8. **Mixing contract and runtime concerns**
   - capabilities answer what the product supports
   - diagnostics answer what is ready now

9. **Hiding resume restrictions for relay**
   - `resumeRequiresUserGesture` and `expiresAt` should become explicit UX state

## Phased implementation plan

### Phase 1: read-only integration

Goal: land the adapter and normalized model without Chrome or Safari runtime actions inside OpenClaw.

Scope:

- build transport client for `/v1/capabilities`, `/v1/diagnostics`, `/v1/attach`, `/v1/sessions`, `/v1/sessions/:id`, `/v1/sessions/:id/resume`
- implement normalization into `NormalizedBrowserConnection`
- wire Chrome direct and Chrome relay as separate read-only routes
- wire Safari attach/resume/readiness, but keep action buttons behind a later feature gate if needed
- add prompt mapping for Safari permissions and Chrome relay/share issues
- ensure session list and session detail render trust/scope accurately

Success criteria:

- OpenClaw can truthfully show Safari actionable readiness vs Chrome read-only readiness
- OpenClaw can attach and resume saved sessions
- OpenClaw never offers unsupported Chrome runtime actions

### Phase 2: Safari actionable wiring

Goal: expose Safari runtime operations through the same normalized adapter.

Scope:

- add `activate(sessionId)`
- add `navigate(sessionId, url)`
- add `screenshot(sessionId)`
- gate each operation from normalized capability flags, not browser name
- return action failures as adapter-level promptable states when permissions or browser state regress

Success criteria:

- Safari actions work through one normalized session object
- permission regressions map to explicit prompts instead of generic errors
- no Chrome path accidentally shares Safari action affordances

### Phase 3: future Chrome actionable support if ever added

Goal: extend the same adapter without rewriting consumer code.

Scope:

- keep `route` and `trust` stable
- introduce future Chrome actionability by changing normalized capability flags and, if needed, future bridge `kind`
- continue to distinguish `chrome-direct` and `chrome-relay` by trust path even if both become actionable one day
- preserve prompt handling for approval vs relay user gesture as distinct concerns

Success criteria:

- OpenClaw UI still consumes the same normalized model
- consumer logic does not need raw-payload branching to absorb future Chrome capability changes
- no fake assumption is baked in today about Chrome becoming actionable later
