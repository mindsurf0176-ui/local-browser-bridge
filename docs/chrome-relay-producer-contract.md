# Chrome Relay Producer Contract

This document defines the producer-side JSON contract for the local Chrome relay state file consumed by `local-browser-bridge`.

Canonical machine-readable schema: [`schema/chrome-relay-state.schema.json`](../schema/chrome-relay-state.schema.json)

Audience:

- a Chrome extension that shares one tab with the bridge
- a local host helper that writes or refreshes relay state on behalf of that extension

Scope:

- producer-side relay state only
- Chrome/Chromium relay only
- v1 read-only shared-tab behavior only

This is not a browser automation contract. In v1, Chrome relay remains a read-only, shared-tab path.

## File location

The bridge reads the first available file from:

1. `LOCAL_BROWSER_BRIDGE_CHROME_RELAY_STATE_PATH`
2. `./.local-browser-bridge/chrome-relay-state.json`
3. `~/.local-browser-bridge/chrome-relay-state.json`

Producer guidance:

- write exactly one authoritative file per machine/user context
- overwrite the full file atomically when state changes
- do not append multiple JSON objects to one file
- prefer creating the parent directory ahead of time

The bridge treats the file as local machine state, not as a remotely trusted artifact.

## JSON shape

Current bridge-consumed shape:

```json
{
  "version": "1.1.0",
  "updatedAt": "2026-03-28T11:00:00.000Z",
  "extensionInstalled": true,
  "connected": true,
  "userGestureRequired": false,
  "shareRequired": false,
  "resumable": true,
  "resumeRequiresUserGesture": false,
  "expiresAt": "2026-03-28T12:00:00.000Z",
  "sharedTab": {
    "id": "tab-123",
    "title": "Relay Example",
    "url": "https://example.com/shared"
  }
}
```

Unknown extra fields are currently ignored by the bridge. Producers may add internal metadata, but should not rely on the bridge consuming it.

## Required and optional fields

Top-level fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | string | No | Producer contract/version label for debugging and forward evolution. |
| `updatedAt` | string (ISO 8601 UTC timestamp) | Strongly recommended | Freshness timestamp for the current snapshot. The bridge surfaces this as the effective relay trust/freshness time today. |
| `extensionInstalled` | boolean | No | `false` means the extension is known to be missing. |
| `connected` | boolean | No | `false` means the extension/helper is installed but not currently connected to the local bridge path. |
| `userGestureRequired` | boolean | No | `true` means the user must click the extension toolbar entry or otherwise perform the required gesture before sharing can proceed. |
| `shareRequired` | boolean | No | `true` means the relay is connected, but no current share grant exists for a usable tab. |
| `resumable` | boolean | No | Whether a saved relay session can resume without creating a brand-new relay session. |
| `resumeRequiresUserGesture` | boolean | No | `true` means saved-session resume should require the user to share again. |
| `expiresAt` | string (ISO 8601 UTC timestamp) | No | Expiration time for the current shared-tab grant, if the producer can determine one. |
| `sharedTab` | object or `null` | Conditionally required | The currently shared tab when one exists. Use `null` when the producer wants to say "connected, but no shared tab". |

`sharedTab` fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | No | Producer-defined stable identifier for the currently shared tab. |
| `title` | string | No | Best-effort tab title. |
| `url` | string | No | Best-effort full tab URL. |

Practical minimum for a useful ready state:

- `extensionInstalled: true`
- `connected: true`
- `userGestureRequired: false` or omitted
- `shareRequired: false` or omitted
- `sharedTab` present with at least one useful identity signal, usually `url` and ideally `id` plus `title`

## Timestamp semantics

Use RFC 3339 / ISO 8601 UTC timestamps such as `2026-03-28T11:00:00.000Z`.

Semantics:

- `updatedAt`: when this exact file snapshot became true according to the producer
- `expiresAt`: when the current shared-tab grant should no longer be treated as valid
- `trustedAt`: not a separate file field today

Current bridge behavior:

- the bridge reads `updatedAt`
- when a relay session is created, the bridge carries that value forward as the session's effective trusted/freshness time
- the bridge checks `expiresAt` if present and treats expired scope as unavailable

Producer guidance:

- set `updatedAt` every time any material relay state changes
- if grant expiry is unknown, omit `expiresAt`
- do not write guessed timestamps if the producer cannot support them truthfully

## Shared-tab identity

Relay is shared-tab scoped in v1. The bridge does not treat this file as browser-wide visibility.

Identity guidance:

- `sharedTab.id` should be stable for the same live shared tab when possible
- `sharedTab.url` should reflect the exact currently shared page URL if the producer can observe it
- `sharedTab.title` is helpful but should be treated as descriptive, not authoritative

The bridge currently derives its saved-session match from the tab metadata it constructs from this payload. In practice, keeping `id`, `url`, and `title` stable for the same shared tab improves resume behavior.

## State combinations

The producer should write truthful combinations, not optimistic ones.

Recommended meanings:

- `extensionInstalled: false`
  - extension is known absent
  - other fields may be omitted
- `extensionInstalled: true`, `connected: false`
  - extension/helper exists but is not connected
- `connected: true`, `userGestureRequired: true`
  - the next blocker is the required user click/gesture
- `connected: true`, `shareRequired: true`
  - the next blocker is explicit sharing of a tab
- `connected: true`, `sharedTab: null`
  - no shared tab is currently available
- `connected: true`, `sharedTab` object present
  - a shared tab is currently available for relay attach

Avoid contradictory payloads where possible, for example:

- `extensionInstalled: false` with `connected: true`
- `userGestureRequired: true` with a fully usable `sharedTab`
- expired `expiresAt` with `shareRequired: false` and a supposedly ready share

If contradictory state is unavoidable during transitions, prefer writing the blocking state and omit `sharedTab`.

## Click/share state transitions

Typical producer transition sequence:

1. Extension/helper starts:
   - write `extensionInstalled: true`
   - write `connected: false` until the helper/bridge path is actually connected
2. Relay path connected:
   - set `connected: true`
   - if the toolbar click or equivalent gesture has not happened yet, set `userGestureRequired: true`
3. User performs the required click/gesture:
   - set `userGestureRequired: false`
   - if a tab still must be explicitly shared, set `shareRequired: true`
4. User shares a tab:
   - set `shareRequired: false`
   - write `sharedTab`
   - optionally write `updatedAt`, `expiresAt`, `resumable`, and `resumeRequiresUserGesture`
5. Share revoked, tab lost, or scope expires:
   - clear the ready state
   - set `shareRequired: true` or `sharedTab: null`, depending on what the producer actually knows

Do not imply that a click alone creates a usable shared tab. `userGestureRequired` and `shareRequired` describe different blockers.

## Resume semantics

The bridge only supports honest shared-tab resume semantics in v1.

Producer expectations:

- `resumable: true` means the producer believes a saved relay session may resume against the current shared tab
- `resumeRequiresUserGesture: true` means resume should be treated as blocked until the user shares again

Recommended combinations:

- resumable without another share:
  - `resumable: true`
  - `resumeRequiresUserGesture: false`
- resumable only after the user shares again:
  - `resumable: true`
  - `resumeRequiresUserGesture: true`
- not resumable:
  - `resumable: false`
  - `resumeRequiresUserGesture`: omit or set truthfully if the reason is specifically another required gesture

The bridge does not turn relay into a general saved-browser restore flow. Resume remains "re-check the currently shared tab".

## Write/update expectations

Recommended file-write behavior:

- write complete JSON snapshots, not partial fragments
- replace the whole file on each material state change
- keep the file UTF-8 JSON object encoded
- if possible, write to a temporary file and rename into place

Practical reasons:

- the bridge may read while the producer is updating
- partial writes can look like invalid JSON and cause the relay probe to be rejected temporarily

## Local trust model

The bridge treats the file as local machine input from a trusted local producer path.

That means:

- there is no cryptographic verification in this contract
- the bridge does not validate that `sharedTab.url` came from Chrome itself
- the bridge does not verify producer identity beyond local file access

Producer guidance:

- keep the file on the local machine
- avoid world-writable locations
- do not treat this file as a network protocol
- if a helper proxies extension state, preserve the same local-user trust boundary

## Invalid and failure handling guidance

What the bridge does today:

- missing file: relay is treated as not configured
- unreadable or invalid JSON object: relay is treated as invalid
- `extensionInstalled: false`: relay reports extension-not-installed
- `connected: false`: relay reports disconnected
- `userGestureRequired: true`: relay reports toolbar click/user gesture required
- `shareRequired: true`: relay reports share required
- no `sharedTab`: relay reports no shared tab
- expired `expiresAt`: relay reports expired scope

Producer guidance:

- prefer omitting unsupported fields over writing inaccurate values
- prefer `sharedTab: null` over a stale old shared tab
- clear or replace stale `sharedTab` immediately when the share ends
- update `updatedAt` whenever the ready/blocking state changes
- keep `expiresAt` synchronized with the real scope lifetime if the producer exposes it

## Example states

Extension missing:

```json
{
  "version": "1.1.0",
  "updatedAt": "2026-03-28T11:00:00.000Z",
  "extensionInstalled": false
}
```

Connected, waiting for user click:

```json
{
  "version": "1.1.0",
  "updatedAt": "2026-03-28T11:00:00.000Z",
  "extensionInstalled": true,
  "connected": true,
  "userGestureRequired": true
}
```

Connected, waiting for share:

```json
{
  "version": "1.1.0",
  "updatedAt": "2026-03-28T11:05:00.000Z",
  "extensionInstalled": true,
  "connected": true,
  "userGestureRequired": false,
  "shareRequired": true,
  "sharedTab": null
}
```

Ready shared tab:

```json
{
  "version": "1.1.0",
  "updatedAt": "2026-03-28T11:10:00.000Z",
  "extensionInstalled": true,
  "connected": true,
  "userGestureRequired": false,
  "shareRequired": false,
  "resumable": true,
  "resumeRequiresUserGesture": false,
  "expiresAt": "2026-03-28T12:10:00.000Z",
  "sharedTab": {
    "id": "tab-123",
    "title": "Relay Example",
    "url": "https://example.com/shared"
  }
}
```
