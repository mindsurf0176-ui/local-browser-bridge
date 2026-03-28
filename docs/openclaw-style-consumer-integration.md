# OpenClaw-style Consumer Integration Guide

This note is an OpenClaw-specific wrapper around the general [Agent Integration Contract](./agent-integration-contract.md).

This note is for a real browser consumer that wants to present `local-browser-bridge` behind an OpenClaw/browser-style UX.

The goal is simple:

- route users into the right browser path
- present honest affordances
- avoid offering actions the bridge cannot actually perform

In the current contract, that means:

- **Safari** is the actionable path
- **Chrome direct** is a read-only user-browser path
- **Chrome relay** is a read-only shared-tab path

Do not treat those three cases as interchangeable.

## Recommended fetch order

For a long-running consumer, fetch in this order:

1. **`/v1/capabilities`** once at startup and on reconnect
2. **`/v1/diagnostics?browser=...`** when the user is about to attach, or when attach UX needs explanation
3. **`/v1/sessions`** only for saved-session UI, resume UI, or restoration flows

Why this order:

- **Capabilities** tell you the stable product contract.
- **Diagnostics** tell you what is ready on this machine right now.
- **Sessions** tell you what the user attached before.

A consumer should not try to infer readiness from saved sessions alone.

## The decision tree

### Step 1: branch on `kind`

Treat `kind` as the top-level behavior gate.

- `safari-actionable` → actions may be available
- `chrome-readonly` → attach/resume/inspect only

This is the first and most important split. Do not branch on browser name alone.

### Step 2: branch on `attach.mode`

Inside Chrome, use `attach.mode` to decide how to explain the session:

- `direct` → attached to the user's local Chrome/Chromium environment through discoverable DevTools
- `relay` → attached only to the currently shared tab exposed by the extension relay

This is a UX and trust distinction, not a different top-level product line.

### Step 3: refine with `session.semantics`

For relay sessions, treat `session.semantics` as authoritative:

- `inspect: "shared-tab-only"` means the session should be presented as one shared tab, not as general browser visibility
- `resume: "current-shared-tab"` means resume is a re-check against the currently shared tab, not a browser-wide restore
- `tabReference.windowIndex/tabIndex: "synthetic-shared-tab-position"` means those indexes are placeholders and should not be shown as real browser coordinates

## Consumer behavior by case

### 1) Safari actionable session

Typical meaning:

- the consumer has an actionable browser session
- activate/navigate/screenshot may be surfaced if the exact session capability bits are true

Recommended consumer UX:

- show normal attach/resume controls
- show runtime actions only when `session.capabilities.activate|navigate|screenshot` are true
- if diagnostics report Safari permission blockers, explain those blockers before the user blames the consumer

Suggested user-facing label:

- **Safari (actionable)**

Suggested prompt when attach is blocked:

- **Safari needs macOS Automation permission before I can control tabs. Grant access, then try again.**
- **Safari screenshots also require Screen Recording permission on this Mac.**

### 2) Chrome direct read-only session

Typical meaning:

- the consumer has attached to Chrome through a local DevTools-discoverable path
- the bridge can inspect/attach/resume honestly
- the bridge still cannot activate, navigate, or screenshot in this phase

Recommended consumer UX:

- allow inspect/resume style flows
- suppress runtime action buttons and tool calls
- explain that this is a browser-level read-only connection, not an actionable automation session

Suggested user-facing label:

- **Chrome (direct, read-only)**

Suggested prompt when direct attach is not ready:

- **Chrome direct attach needs a local DevTools endpoint that is already available on this machine. Once Chrome is running in that mode, I can inspect tabs in read-only mode.**

### 3) Chrome relay read-only session

Typical meaning:

- the consumer can only see the tab the user explicitly shared through the relay
- the session is narrower than direct attach
- resume may require the user to share again

Recommended consumer UX:

- label the session as a shared-tab session, not a Chrome browser session
- suppress runtime action buttons and tool calls
- treat resume as “check whether the shared tab is still available”
- if `resumeRequiresUserGesture === true`, explain that the user may need to click the toolbar button again
- if `expiresAt` is present, surface it as a trust-expiry hint, not as a promise of availability

Suggested user-facing label:

- **Chrome (shared tab, read-only)**

Suggested relay prompts:

- Toolbar click needed:
  - **To connect this Chrome tab, click the relay extension button on the tab you want to share.**
- Shared tab required:
  - **Chrome relay only works for a tab you explicitly share. Share the tab first, then retry.**
- Resume needs user gesture:
  - **That shared-tab grant is no longer active. Click the relay extension again on the original tab, then retry resume.**

## Action suppression rules

A consumer modeled on OpenClaw/browser-style UX should suppress actions when any of the following is true:

- `kind === "chrome-readonly"`
- `session.capabilities.activate === false`
- `session.capabilities.navigate === false`
- `session.capabilities.screenshot === false`
- relay diagnostics are not ready for `attach.mode = relay`

In practice, for the current bridge:

- **Safari** may surface runtime actions
- **all Chrome sessions** should hide or disable runtime actions

Do not present disabled Chrome action buttons with vague wording like “coming soon” unless your product explicitly wants teaser UI. Honest omission is better.

## Suggested adapter shape

A thin consumer adapter can be implemented as:

1. Read `capabilities`
2. Read `diagnostics` for the target browser
3. Choose attach mode
4. Attach or resume
5. Normalize the returned session into consumer UX flags

Pseudo-code:

```ts
type ConsumerRoute = {
  label: string;
  attachMode: "direct" | "relay";
  canInspect: boolean;
  canResume: boolean;
  canAct: boolean;
  prompt?: string;
};

function routeBrowserSession(args: {
  kind: "safari-actionable" | "chrome-readonly";
  attachMode: "direct" | "relay";
  diagnostics?: any;
  session?: any;
}): ConsumerRoute {
  const { kind, attachMode, diagnostics, session } = args;

  if (kind === "safari-actionable") {
    return {
      label: "Safari (actionable)",
      attachMode: "direct",
      canInspect: true,
      canResume: true,
      canAct: Boolean(session?.capabilities?.activate || session?.capabilities?.navigate || session?.capabilities?.screenshot),
      prompt: diagnostics?.preflight?.automation?.ready === false
        ? "Safari needs local macOS permissions before control can work."
        : undefined,
    };
  }

  if (attachMode === "relay") {
    const relayReady = diagnostics?.attach?.relay?.ready === true;
    const relayBlocker = diagnostics?.attach?.relay?.blockers?.[0]?.code;

    return {
      label: "Chrome (shared tab, read-only)",
      attachMode: "relay",
      canInspect: true,
      canResume: true,
      canAct: false,
      prompt: relayReady
        ? undefined
        : relayBlocker === "relay_toolbar_not_clicked"
          ? "Click the relay extension button on the tab you want to share."
          : relayBlocker === "relay_share_required"
            ? "Share the target Chrome tab through the relay first."
            : "Chrome relay is not ready yet on this machine."
    };
  }

  return {
    label: "Chrome (direct, read-only)",
    attachMode: "direct",
    canInspect: true,
    canResume: true,
    canAct: false,
    prompt: diagnostics?.attach?.direct?.ready === true
      ? undefined
      : "Chrome direct attach needs a discoverable local DevTools endpoint."
  };
}
```

## Recommended attach UX

### If the user asked for Safari control

- check Safari diagnostics
- if ready, attach Safari normally
- if blocked, show the macOS permission explanation first

### If the user asked for Chrome without specifying mode

Recommended default behavior:

1. check Chrome diagnostics
2. if direct is ready, prefer **direct** for general read-only browser inspection
3. if direct is not ready but relay is the intended product path, explicitly instruct the user to share the target tab
4. after a relay session is attached, keep describing it as a **shared tab**

Important: do not silently switch a general Chrome request into relay mode without telling the user that scope became tab-only.

### If the user explicitly asked for relay/shared-tab attach

- use relay-specific prompting immediately
- do not offer browser-wide language like “connected to Chrome”
- say “connected to the shared tab” or equivalent

## Anti-patterns to avoid

### 1) Branching on browser name alone

Bad:

- `if browser === "chrome" then show Chrome controls`

Why it fails:

- the stable behavior split is `kind`, not brand name
- future Chrome modes may evolve without changing that basic contract rule

### 2) Treating relay as browser-wide attach

Bad:

- showing all Chrome tabs as available after a relay attach
- presenting relay resume as if it restores a saved browser tab

Why it fails:

- relay is explicitly scoped to the shared tab only

### 3) Offering actions for any `chrome-readonly` session

Bad:

- showing activate/navigate/screenshot for Chrome because the consumer assumes Chrome is a “real browser”

Why it fails:

- the bridge contract explicitly says Chrome is read-only in this phase

### 4) Hiding the trust difference between direct and relay

Bad:

- “Chrome connected” for both cases

Why it fails:

- direct means browser-level read-only inspection
- relay means user-mediated shared-tab scope
- users deserve to know which one happened

### 5) Using relay tab indexes as real positions

Bad:

- “Window 1, Tab 1” as if it maps to live Chrome coordinates

Why it fails:

- relay sessions may use synthetic placeholder indexes

### 6) Using sessions as a readiness source

Bad:

- seeing a saved session and assuming attach/resume is ready now

Why it fails:

- readiness lives in diagnostics, not in historical session presence

### 7) Silent fallback between direct and relay

Bad:

- trying direct, then automatically using relay without telling the user

Why it fails:

- the user experience, scope, and trust model changed
- the consumer should narrate that change explicitly

## Headline recommendation

For an OpenClaw-style consumer, the cleanest integration is:

- **route first by `kind`**
- **explain Chrome sessions with `attach.mode`**
- **treat relay semantics as shared-tab-only truth**
- **suppress all Chrome runtime actions until the bridge can honestly support them**

That keeps the UX clean without pretending Chrome direct and Chrome relay are the same thing, and without leaking low-level transport details into the main product UI.
