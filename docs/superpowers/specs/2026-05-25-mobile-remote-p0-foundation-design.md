# Mobile Remote — Phase 0: Foundation Design

Status: design spec. Implementation plan follows in a separate doc.

Parent roadmap: `2026-05-25-mobile-remote-roadmap.md`.

Reference implementation to port from: `../../../otto/src/main/remote/` (Otto's `remote/` module is ~1700 LOC across 7 source + 7 test files — the design here lifts its shape with SAI-specific adaptations).

## Scope

Phase 0 establishes the foundation for every subsequent mobile-remote phase:

- HTTP+WS bridge that binds only to a Tailscale interface
- Pairing flow (QR → single-use code → argon2id bearer)
- PWA shell at `src/renderer-remote/` showing only a "paired ✓" status screen
- Desktop settings tab to manage pairings and view bridge status
- Supervisor that handles tailnet IP changes and one-shot bridge restart

**No application surfaces are exposed yet.** Chat lands in Phase 1 on top of this foundation.

## Goals

1. Phone scans a QR generated in SAI's Settings → Mobile Remote, opens in Safari, pairs over Tailscale, lands on a status page showing `paired ✓` and basic device info.
2. Pairing survives desktop restart (stable port `17829` preserved by re-binding to it).
3. Revoking a device from Settings closes that device's WS within one heartbeat cycle.
4. Bridge refuses to start when there is no Tailscale interface (no LAN/0.0.0.0/127 fallback).
5. All Otto's known boundary bugs are pre-empted by design choices (see "Decisions locked in" in the roadmap).

## Non-goals (Phase 0)

- Chat events, approvals, tool cards, sessions on the wire
- Files, terminal, git, settings surfaces other than the new "Mobile Remote" tab
- Push notifications, offline-first PWA caching beyond what Vite/Workbox ships by default
- Multi-tenant auth, public-internet exposure

## Architecture

```
electron/services/remote/                 (new directory)
├── bridge-server.ts          HTTP + WS, binds tailnet IP only, port 17829
├── pairing-store.ts          better-sqlite3 at userData/sai-remote.db
├── session-bus.ts            fan-out: subscribeAll() + subscribe(topic) + history(topic, since)
├── tailnet.ts                shells `tailscale ip -4` and `tailscale status --json`
├── screenshot-urls.ts        HMAC + nonce signer (built now, used later)
└── index.ts                  RemoteModule supervisor

electron/main.ts                          wire RemoteModule into app lifecycle
electron/preload.ts                       expose remote IPC (mintPairCode, listDevices, revoke, status)

src/renderer-remote/                      (new Vite entry, separate from main renderer)
├── index.html
├── main.tsx                  bootstraps PWA
├── App.tsx                   reads ?code= → POST /pair → WS connect → render Status
├── Status.tsx                paired ✓ screen
├── wire.ts                   WS helpers (auth, ping watchdog, reconnect)
└── styles.css                Tailwind entry

src/components/Settings/RemoteSettings.tsx     (new) — Mobile Remote settings tab
src/components/SettingsModal.tsx                 update — add 'remote' to SettingsPage union, wire tab

vite.config.pwa.ts                                (new) — standalone PWA build
scripts/build-pwa.{cjs,sh}                        (new) — driven by main `build` script

docs/superpowers/notes/2026-05-25-mobile-remote-p0-smoke.md   (new) — manual smoke checklist
```

## Component-by-component

### `tailnet.ts` — Tailscale resolution

Ported almost verbatim from Otto. Two exports:

- `resolveTailnetIp(opts?)`: `execFile('tailscale', ['ip', '-4'])`. Returns first IPv4 line or `null`.
- `resolveTailnetEndpoint(opts?)`: `execFile('tailscale', ['status', '--json'])`. Returns `{ ip, host }` where `host` is built from `Self.HostName` + `MagicDNSSuffix`, falling back to `Self.DNSName`.

The CLI dependency means users with Tailscale installed but `tailscale` not on PATH (some macOS GUI installs) need a path override. Add an optional `TAILSCALE_CLI` env var honored by `resolveTailnetEndpoint`. Confirm SAI's `shellEnv.ts` already augments PATH for spawned processes — if so, reuse.

Both functions accept an `exec` injection point for tests (Otto's pattern).

### `pairing-store.ts` — Bearer token storage

Match Otto's schema exactly:

```sql
CREATE TABLE IF NOT EXISTS paired_devices (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  paired_at    INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);
```

API (`PairingStore`):

- `issue(label)` → `{ deviceId, token }`. Generates UUID + 32-byte base64url token, argon2id-hashes it, inserts row.
- `verify(token)` → `PairedDevice | null`. Iterates non-revoked rows, argon2id-verifies. On match, updates `last_seen_at` and returns the device.
- `revoke(deviceId)` → sets `revoked_at`.
- `list()` → all rows ordered by `paired_at desc`.

Database file: `<userData>/sai-remote.db` (separate from any future SAI main-process DBs). Open once at module load via a small factory; `better-sqlite3` is synchronous and fine for single-digit row counts.

Argon2id verify cost ~50–100ms; acceptable because verification only happens at WS-auth time (once per connection), not per frame.

### `session-bus.ts` — Output fan-out

Even though Phase 0 doesn't yet emit application events, build the bus now so Phase 1 doesn't have to. Lifted from Otto with one rename: topics are strings (not `sessionId`) so non-chat surfaces (terminal, git) can reuse the same primitive in later phases.

```ts
interface SessionBus {
  publish(topic: string, event: BusEvent): void;
  subscribe(topic: string, fn: (event: BusEvent) => void): () => void;
  subscribeAll(fn: (topic: string, event: BusEvent) => void): () => void;
  history(topic: string, since: number): { events: BusEvent[]; lastSeq: number };
}
```

Per-topic ring buffer (256 events). Sequence numbers per topic, used by reconnecting clients to replay missed events (Phase 1+ will use this; Phase 0 just provides it).

**Critical: from day one, `subscribeAll` is the only thing the bridge uses.** Otto's worst bug was subscribing to `activeSessionId()` at WS-auth time and silently dropping every event when that returned null.

### `bridge-server.ts` — HTTP + WS

Port shape from Otto. Key differences from Otto's:

- Drop the `activeSessionId()` option (Otto kept it for legacy reasons; we never want it).
- Default `port` field is `0` inside the class; production caller passes `17829`. Same anti-contention pattern.
- Static asset root is `dist/renderer-remote/` (electron-vite v2 PWA build output).

**HTTP routes** (Phase 0):
- `POST /pair` body `{ code, deviceLabel? }` → `{ token, deviceId, wsUrl: '/ws' }`. Rate-limit 10/min per remote IP.
- `GET /healthz` → `{ status: 'ok', version }` (no auth, for tailnet probes)
- `GET /*` → SPA static from `pwaDir` with path-traversal protection + `index.html` fallback for unknown routes

**WS** (`/ws`):
- Client first frame must be `{ type: 'auth', token }`. Otherwise close `4001 auth_failed`.
- Server replies `{ v: 1, type: 'auth_ok', deviceLabel }` on success.
- Server subscribes to `bus.subscribeAll` and forwards `{ v: 1, topic, ...event }` frames.
- Client may send `{ type: 'ping' }` → server replies `{ type: 'pong' }`. Phase 0 has no other inbound message types.
- Server closes WS for any device that gets revoked (RemoteModule keeps a `deviceId → ws` map and closes on revoke).

**Pairing code lifecycle** (kept in BridgeServer's in-memory Map, never persisted):
- `mintPairingCode()` → 32-byte base64url, 120s TTL.
- Verified and deleted on first `/pair` POST. Single-use guarantee comes from delete-on-consume.

### `screenshot-urls.ts` — Signed URL signer

Build now, use in Phase 3+. Otto pattern:

- `sign(id)` → `/screenshot/<id>?exp=<unix>&nonce=<rand>&sig=<hmac(id|exp|nonce)>`
- `verify(url)` → `{ ok, id }`. Single-use enforced by an in-memory set of consumed nonces with TTL eviction.

Including the nonce from day one prevents Otto's "two URLs signed for the same id at the same instant are identical" bug.

### `index.ts` — RemoteModule supervisor

Port verbatim from Otto:

- `start()`: resolves tailnet endpoint, makes bridge, calls `bridge.start()`. On failure, schedules one retry after 1s. After second failure, stays down with `reason` populated.
- `stop()`: clears poll timer, tears down bridge.
- `poll()` (60s interval): re-resolves tailnet endpoint, rebinds if IP/host changed.
- `mintPairingCode()` → `{ code, url, expiresAt }` where `url` is `http://<host or ip>:<port>/?code=<code>`. Prefer MagicDNS host over bare IP.
- `status()` → `{ running, url, reason, pairedCount }`.

### Settings UI

Add `'remote'` to `SettingsPage` in `src/components/SettingsModal.tsx`, alongside `'swarm'` and `'keybindings'`. New component `src/components/Settings/RemoteSettings.tsx`:

- **Enable Mobile Remote** toggle (boolean setting, persisted via existing settings store; default `false`)
- **Bridge Status** block (poll `remote.status` every 5s via IPC):
  - `running` indicator (green/red dot)
  - `url` (clickable to copy)
  - `reason` (when not running)
  - `pairedCount`
- **Pair a new device** button → opens an inline panel showing the QR (rendered via `qrcode` to a canvas) + the 120s countdown + the URL underneath as a fallback if the QR can't be scanned
- **Paired devices** list: label, `last_seen_at` (relative), Revoke button per row

IPC surface (preload):
- `remote.status()` → `RemoteModuleStatus`
- `remote.mintPairCode()` → `{ code, url, expiresAt }`
- `remote.listDevices()` → `PairedDevice[]`
- `remote.revoke(deviceId)` → `void`
- `remote.setEnabled(enabled)` → `void` (kicks RemoteModule start/stop)

### PWA shell

`src/renderer-remote/App.tsx` flow:

1. On mount, parse `?code=` from `location.search`.
2. If a `code` is present and no bearer in `localStorage['sai-remote-bearer']`: POST `/pair` with `{ code, deviceLabel: navigator.userAgent }`. On success, store `{ token, deviceId }` in `localStorage`; replace history to strip `?code`.
3. If bearer is present: open WS to `/ws`, send `{ type: 'auth', token }`, wait for `auth_ok`.
4. Render `Status.tsx` showing: paired ✓, device label, server URL, ping latency, "Disconnect" button (clears localStorage and reloads).
5. On WS close with code `4001` or `1008`: clear bearer, render "Re-pair required" screen with instructions.
6. 30s client-side watchdog: if no `auth_ok` within 30s of WS open, close with reason and show a retry button.

### Build wiring

- `vite.config.pwa.ts`: separate Vite config, `root: 'src/renderer-remote'`, `build.outDir: '../../dist/renderer-remote'`, no Electron preload.
- Main `package.json` `build` script: invoke `vite build && vite build --config vite.config.pwa.ts && electron-builder ...`
- `tailwind.config` / `tsconfig.json`: extend `content` / `include` to cover `src/renderer-remote/`.
- electron-builder `files`: include `dist/renderer-remote/**`.
- Native modules: `better-sqlite3` and `argon2` need electron-rebuild. Check `scripts/` for an existing rebuild pattern; if not present, add a `postinstall` running `electron-rebuild -f -w better-sqlite3 argon2`.

### Dependencies to add

- `better-sqlite3` (dep)
- `argon2` (dep)
- `ws` + `@types/ws` (dep + devDep)
- `qrcode` + `@types/qrcode` (dep + devDep)

## Wire formats (Phase 0)

### POST /pair

```jsonc
// req
{ "code": "<32-byte-base64url>", "deviceLabel": "iPhone (Safari)" }
// 200
{ "token": "<32-byte-base64url>", "deviceId": "<uuid>", "wsUrl": "/ws" }
// 401: invalid/expired code (also after first use — single-use)
// 429: rate limited
```

### WS frames

```jsonc
// → server
{ "type": "auth", "token": "<bearer>" }
{ "type": "ping" }

// ← server
{ "v": 1, "type": "auth_ok", "deviceLabel": "iPhone (Safari)" }
{ "v": 1, "type": "pong" }
// (future) { "v": 1, "topic": "...", ...event }
```

Close codes:
- `4001 auth_failed`
- `1008 revoked` (server-initiated on device revoke)

## Testing strategy

### Vitest unit

- `pairing-store.test.ts`: issue → verify happy path; verify after revoke returns null; verify with wrong token returns null; `last_seen_at` updates on verify.
- `screenshot-urls.test.ts`: sign + verify round trip; tampered URL rejected; replay (same nonce) rejected; expired URL rejected.
- `tailnet.test.ts`: parses `tailscale ip -4` output; parses `tailscale status --json`; returns `null` on missing CLI / non-zero exit.
- `session-bus.test.ts`: `subscribeAll` receives events from any topic with the topic name attached; ring buffer caps at 256; `history` replays from `since`.
- `bridge-server.test.ts`: refuses to start without tailnet IP; `/pair` happy path; rate-limit kicks in; expired pairing code rejected; single-use enforced (second `/pair` with same code returns 401); WS auth happy path; WS auth_failed close code; `subscribeAll` forwards events.
- `index.test.ts` (RemoteModule): start with valid tailnet → running; start without tailnet → `reason` populated; first bridge throw → one retry; second throw → stays down; tailnet endpoint change → rebind.

### Vitest integration (Node-level E2E)

One file, `electron/services/remote/end-to-end.test.ts`, using real `ws` + `fetch`:

1. Start a `RemoteModule` with a stubbed tailnet returning `127.0.0.1` (test-only override flag) and ephemeral port.
2. `mintPairingCode()` → POST `/pair` → bearer.
3. WS connect → `auth` → `auth_ok`.
4. Server-side `bus.publish('test', { type: 'noop' })` → client receives `{ topic: 'test', type: 'noop' }`.
5. `pairing.revoke(deviceId)` → server closes WS with code 1008.
6. Reconnect with same bearer → `auth_failed` 4001.

### Manual smoke checklist

`docs/superpowers/notes/2026-05-25-mobile-remote-p0-smoke.md`:

- Install Tailscale on phone (one-time).
- Enable Mobile Remote in SAI Settings → status shows `running`, URL uses MagicDNS host.
- Tap "Pair a new device" → scan QR with iOS Camera → Safari opens → paired ✓ within 5s.
- Quit and relaunch SAI → phone reconnects without re-pairing (stable port verified).
- From SAI, revoke the device → phone WS closes within 30s, "Re-pair required" screen appears.
- Toggle Tailscale off on phone → WS disconnects; toggle back on → reconnects.
- Disable Mobile Remote in Settings → bridge stops, status shows `running: false`.

## Failure modes

| Condition | Behavior |
|---|---|
| `tailscale` CLI not installed | `reason: 'tailnet IP not detected'`, bridge does not start |
| Tailscale installed, not logged in | Same as above (CLI returns non-zero) |
| Port `17829` in use | Fall back to ephemeral, log warning. Status URL reflects actual port. Phone bookmark may break; documented as a known trade-off when something else owns the port. |
| `bridge.start()` throws | One retry after 1s; second failure stays down with `reason` populated |
| Tailnet IP changes (laptop sleeps and wakes on a different network) | 60s poll detects, rebinds to new IP. Existing WS connections close, clients reconnect. |
| Argon2 native binding fails to load | Bridge start throws; surfaces via `reason` in settings. User sees clear "Mobile Remote unavailable: <error>" |

## Open questions (resolved during implementation)

1. **Electron-rebuild pattern in SAI**: confirm whether SAI already has an electron-rebuild step or whether `postinstall` needs adding.
2. **shellEnv on PATH**: confirm SAI's `electron/services/shellEnv.ts` augments PATH for `execFile` calls so `tailscale` is found even when SAI is launched from a GUI on macOS.
3. **Settings persistence layer**: SAI's existing settings store mechanism — match it for the new `mobileRemote.enabled` field.

These are small wrap-point checks that will be resolved when writing the implementation plan, not blockers on design.

## Exit criteria

1. All vitest unit tests pass.
2. The Node-level end-to-end test passes.
3. Manual smoke checklist completed on real hardware (laptop + iPhone over Tailscale).
4. Phone retains pairing across desktop restart.
5. Revoke from desktop kicks the phone within one heartbeat cycle.
6. Bridge refuses to start without Tailscale (verified by disabling Tailscale and observing `reason`).

## Next steps after this spec

Hand off to the `writing-plans` skill to produce an implementation plan (`docs/superpowers/plans/2026-05-25-mobile-remote-p0-foundation.md`). Plan will break this into ~15–25 tasks with test-first ordering matching Otto's: tailnet → pairing-store → screenshot-urls → session-bus → bridge-server (per-route) → index (RemoteModule) → IPC + settings UI → PWA shell → end-to-end test → smoke checklist.
