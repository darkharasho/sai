# Pairing Device Identity — Design

**Date:** 2026-05-26
**Scope:** Remote pairing flow (mobile renderer + bridge server + pairing store)

## Problem

Every QR re-pair from the same mobile browser creates a brand-new device row with a label derived from `navigator.userAgent.slice(0, 64)`. During development we frequently re-pair to test, and the paired-devices list in `RemoteSettings` floods with near-identical rows that can't be told apart. There is no notion that "this is the same device as last time."

## Goals

1. Re-pairing from the same mobile browser should not stack up rows — the prior pairing for that browser is replaced.
2. The default device label should be human-readable at a glance (e.g. `iPhone · Safari`) and include a short stable suffix so two genuinely different devices with the same UA can still be distinguished.

## Non-goals

- Cross-browser device identity (clearing localStorage = new identity, by design).
- User-editable labels (separate concern; not in this spec).
- Surfacing the auto-revoke event in UI (silent by design — see Q1).
- Preserving history of superseded pairings.

## Design

### Stable client ID

The mobile renderer generates a UUID once on first load and stores it in localStorage under a new key (`sai.remote.clientId`). This ID is sent on every `/pair/claim` request as `clientId`. It survives across re-pairs on the same browser; it does not survive a localStorage wipe.

The renderer also sends a parsed, human-readable `deviceLabel` (see Label below) instead of the raw UA slice.

### Bridge server

`POST /pair/claim` body extends to accept an optional `clientId: string`. The handler passes it through to `pairing.issue(label, clientId)`. Existing clients that don't send a `clientId` continue to work — they just never trigger auto-revoke.

### Pairing store

`Row` gains a `clientId: string | null` field. `PairedDevice` likewise gains `clientId: string | null` (so the desktop settings UI can display the suffix if desired later).

`issue(label, clientId?)` behavior:

1. If `clientId` is provided, iterate existing rows: for any non-revoked row with the same `clientId`, set `revokedAt = now()`.
2. Insert the new row with the provided `clientId` (or `null`).
3. Persist once at the end (single write).

`verify`, `revoke`, and `list` are unchanged except that `list` includes `clientId` in its result. Existing rows on disk that predate this change have no `clientId` field; on load they're treated as `clientId: null` and never collide.

The `PairingStore` file format is forward-compatible — adding an optional field to each row doesn't break the existing JSON. No migration step required.

### Label

A new module `src/renderer-remote/deviceLabel.ts` exports `describeDevice(ua: string, clientId: string): string`.

Parsing rules (UA sniffing is fine here — this is best-effort cosmetic):

- Platform: `iPhone`, `iPad`, `Android`, `Mac`, `Windows`, `Linux`, or fallback `Device`.
- Browser: `Safari`, `Chrome`, `Firefox`, `Edge`, or fallback omitted.
- Suffix: `#` + first 4 chars of `clientId`.

Examples:
- `Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) … Safari/605.1.15` → `iPhone · Safari · #a3f4`
- `Mozilla/5.0 (X11; Linux x86_64) … Firefox/121.0` → `Linux · Firefox · #9c10`

The label is computed on the mobile side and sent to the server, which stores it verbatim. The server does not re-parse — keeps server simple and avoids drift between what the user saw and what got stored.

### Component boundaries

- **`deviceLabel.ts`** (new, mobile): pure function `(ua, clientId) → string`. Trivially unit-testable.
- **`wire.ts` `pair()`** (mobile): signature changes from `pair(code, deviceLabel)` to `pair(code, deviceLabel, clientId)`. One call site (`App.tsx`).
- **`App.tsx`** (mobile): owns the localStorage key and is the only place that reads/writes `clientId`. Builds the label via `describeDevice`.
- **`bridge-server.ts`** (server): one new optional body field, threaded to `pairing.issue`.
- **`PairingStore`** (server): owns the dedupe logic. Self-contained.

## Data flow

```
Mobile (App.tsx)
  ├─ localStorage.getOrCreate('sai.remote.clientId') → clientId
  ├─ describeDevice(navigator.userAgent, clientId) → label
  └─ POST /pair/claim { code, deviceLabel: label, clientId }
                                              │
                                              ▼
Bridge (bridge-server.ts)
  └─ pairing.issue(label, clientId)
                                              │
                                              ▼
PairingStore.issue
  ├─ for row of rows where row.clientId === clientId && !row.revokedAt: row.revokedAt = now()
  ├─ rows.push({ id: uuid, label, clientId, ... })
  └─ persist()
```

## Error handling

- Missing `clientId` in claim body → fall through old behavior (insert without dedupe). No error.
- localStorage unavailable on mobile (private mode quirks) → `crypto.randomUUID()` per session; dedupe just won't fire for that session. Logged once to console; not surfaced to user.
- Persist failure after revoke + insert → existing `writeChain` swallow-and-retry behavior in `PairingStore` covers this.

## Testing

**Unit — `tests/unit/remote/pairing-store.test.ts` (extend):**
- `issue(label, clientId)` with a matching prior row marks that prior row `revokedAt` and inserts a new row.
- `issue(label, clientId)` does not touch rows with a different `clientId`.
- `issue(label, clientId)` does not touch rows with `clientId === null`.
- `issue(label)` (no clientId) inserts without revoking anything.
- `list()` returns `clientId` in each entry.
- Loading a JSON file with pre-existing rows that lack `clientId` works (treated as null).

**Unit — `tests/unit/remote/bridge-server-pair.test.ts` (extend):**
- `POST /pair/claim` with `clientId` calls `pairing.issue(label, clientId)`.
- `POST /pair/claim` without `clientId` calls `pairing.issue(label)` (or `pairing.issue(label, undefined)`).

**Unit — `tests/unit/remote/device-label.test.ts` (new):**
- Sample UAs for iPhone Safari, Android Chrome, Mac Safari, Windows Chrome, Linux Firefox map to expected strings.
- Suffix is `#` + first 4 chars of the supplied clientId.
- Unrecognized UA falls back to `Device · #xxxx`.

## Files

- `electron/services/remote/pairing-store.ts` — add `clientId` field + dedupe in `issue`.
- `electron/services/remote/bridge-server.ts` — accept `clientId` in claim body.
- `src/renderer-remote/wire.ts` — `pair(code, deviceLabel, clientId?)`.
- `src/renderer-remote/App.tsx` — get-or-create clientId, build label, pass both to `pair`.
- `src/renderer-remote/deviceLabel.ts` — **new**.
- `tests/unit/remote/pairing-store.test.ts` — extend.
- `tests/unit/remote/bridge-server-pair.test.ts` — extend.
- `tests/unit/remote/device-label.test.ts` — **new**.
