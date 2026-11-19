# Task 8 report: machines and pairing

Status: DONE_WITH_CONCERNS

## Changes
- mobile/src/native.ts: `FullNativeApi extends NativeApi` (Task 7's openUrl/copyText/toast) adding keychainGet/Set/Remove and `http()`. `createNative()` picks Capacitor vs web via `Capacitor.isNativePlatform()`. Keychain = local `Keychain` plugin via `registerPlugin`; web fallback = in-memory Map. `http` on native = `CapacitorHttp.request` with connectTimeout/readTimeout; on web = fetch + AbortController. Both default 10s, healthz passes 3s.
- mobile/src/machines/store.ts: Machine list in `sai.machines.v1`, `sai.clientId.v1` (randomUUID), add (dedupe by baseUrl, same id, token replaced), rename, `removeMachine(id)` (deletes keychain token `token:<id>` and list entry), getToken.
- pairing.ts: `parsePairUrl`, `pair()`, `PairError`. 401 -> "code expired", 429 -> rate limit, network/timeout -> "can't reach desktop — is Tailscale on?". Machine label defaults to the host; the deviceLabel sent to the desktop is the phone's name.
- reachability.ts: `checkReachable` GET /healthz, 3s, true only on 200.
- hooks.ts (`useMachines`), MachineList.tsx (dot, label, host, tap select, long-press/context menu with Rename/Remove), PairScreen.tsx (getUserMedia + jsQR at 10fps, stops on first valid URL and on unmount, paste field, device label default "iPhone", inline errors). Plain React, SAI CSS vars, no Tailwind.
- Tests: tests/unit/mobile/machines.test.ts, pairing.test.ts, native.test.ts (mocks @capacitor/core: CapacitorHttp + Keychain). Token never appears in localStorage (asserted).

## Verification
- RED: with machines/ moved away, both new test files failed to load (2 failed, no tests).
- GREEN: `npx vitest run --project unit --maxWorkers=2 tests/unit/mobile` -> 5 files, 62 tests passed.
- `tsc -p mobile/tsconfig.json`: 0 errors. `tsc -p .`: no non-TS6059 errors. `tsc -p tsconfig.node.json`: 5 non-TS6059 errors (pre-existing, none in new files; 16 TS6059).
- `npm run build:mobile`: success.

## Concerns
- WebSocket path (Task 7 V2Client) from capacitor://localhost to ws:// is NOT covered by native.http; needs a device check (mixed content).
- PairScreen/MachineList have no component tests (presentational; camera path untestable in jsdom). Needs device check, plus NSCameraUsageDescription in Info.plist and the Swift Keychain plugin existing/registered (not part of this task; unverified).
- Removing a machine with a live V2Client is Task 9's job.
- Pair URL with a path prefix or https on a non-default setup is reduced to its origin.
