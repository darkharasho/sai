# SAI for iOS, Part 3: Push Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native APNs notifications on the SAI iPhone app for four events: turn finished, approval needed, question asked, and turn errored. Tapping a notification opens that chat. The notifications go through a Cloudflare Worker relay that never sees chat content.

**Architecture:**
- **Seal.** At pairing, the phone and the desktop share a 32-byte seal key. The desktop seals each notification (AES-256-GCM) and POSTs it to the relay as `{pushId, secret, sealed}`.
- **Relay.** The relay (`relay/`, a Cloudflare Worker with D1 storage) maps `pushId` to the APNs token and holds the APNs `.p8` key as a secret. It signs an ES256 JWT and forwards a `mutable-content` alert.
- **Open.** On the phone, a Notification Service Extension (NSE) opens the sealed blob with CryptoKit, using the key from a shared Keychain access group. It then rewrites the title, body and route.
- **Suppression.** The desktop doesn't push for a chat the phone is showing in the foreground. The phone reports its foreground chat with a v2 `phone.presence` frame.

**Tech stack:**
- Cloudflare Workers, D1 and the rate-limit binding, with WebCrypto (`relay/`, its own `package.json`)
- `@capacitor/push-notifications` 8.x
- Swift with CryptoKit, for the NSE target
- Node WebCrypto, for the desktop sender
- vitest

**Spec:** `docs/superpowers/specs/2026-11-19-sai-ios-app-design.md`, section "Part 3 — Push notifications".

## Global Constraints

- **The relay never sees chat content.** It stores only `pushId`, the APNs token, the env, secret hashes and timestamps. Logs never contain payloads, tokens or secrets.
- **The desktop never sees the raw APNs token.** It holds only `{pushId, sendSecret, sealKey, keyId}` per paired phone.
- **Revocation.** Unpairing a desktop (on either side) revokes that desktop's send secret. If APNs answers `410 Unregistered` or `BadDeviceToken`, the relay deletes the registration.
- **Environments.** Sandbox or production is chosen per registration. Debug and TestFlight-from-Xcode use `sandbox`, and TestFlight/App Store archives use `production`. The phone reports which one it is.
- **Sealed format v1:** `base64(nonce[12] ‖ ciphertext ‖ tag[16])`, AES-256-GCM, no AAD. This is exactly CryptoKit's `AES.GCM.SealedBox(combined:)`.
- **Plaintext** is the JSON `{v:1, kind, chatId, projectPath, title, body, ts}`. `kind` is one of `done | approval | question | error`. `title` is at most 80 chars and `body` at most 180 chars. The sealed blob must fit the APNs 4 KB payload.
- **Fallback alert.** The visible text APNs carries without the NSE (it fails or the key is missing) is the fixed string "SAI" / "New activity in a chat". No content.
- **Rate limits.** The relay limits each `pushId` to 30 pushes per minute, and limits `register` to 10 per minute per IP.
- **Desktop suppression.** No push when the phone has that chat in the foreground. No push when the desktop window is focused and that chat's workspace is the active one: the user is at the desk. At most one push per `(chatId, kind, turn)`.
- **Tests.** vitest always runs with `--maxWorkers=2` or `--project unit|integration`. Never run `npm run dev`. Use no Mac locally; iOS compiles only in CI.
- **Shared components are adapted, never forked.** Phone code goes in `mobile/`, desktop code in `electron/services/push/`, and shared crypto in `src/lib/push/`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The branch is `ios-push` off `main`.

## Review Focus

1. **A phone reinstall or new APNs token.** A re-register with the same `ownerToken` updates the token in place, and existing desktop send secrets keep working.
2. **The NSE has no key** (machine removed, Keychain group missing). It must show the fallback alert, never a raw blob and never a crash.
3. **The desktop reconnects many times** in one turn, so `push.register` is replayed. The registration is idempotent, and pushes are not duplicated.
4. **A burst of approvals in one turn** (several tools). Each distinct approval pushes once and nothing repeats. The relay rate limit returns 429, and the desktop drops the push quietly with no retry storm.
5. **The relay is unreachable or slow.** The desktop's push send must never block or slow chat. It is fire-and-forget with a 5s timeout and is logged to devlog without the payload.

---

### Task 1: Shared seal format and test vectors

**Files:**
- Create: `src/lib/push/seal.ts`, `src/lib/push/types.ts`, `tests/fixtures/push/seal-vectors.json`
- Test: `tests/unit/push/seal.test.ts`

**Interfaces:**
- `type PushKind = 'done' | 'approval' | 'question' | 'error'`
- `interface PushPlain { v: 1; kind: PushKind; chatId: string; projectPath: string; title: string; body: string; ts: number }`
- `seal(keyB64: string, plain: PushPlain, nonce?: Uint8Array): Promise<string>`: WebCrypto AES-GCM, returns base64 combined.
- `open(keyB64: string, sealedB64: string): Promise<PushPlain | null>`: returns null on auth failure or bad JSON.
- `newSealKey(): string`: 32 random bytes, base64.
- `clampPlain(p): PushPlain`: enforces the 80/180-char limits on the visible text, cutting on code points.

- [ ] Tests:
  - `seal/open round-trips`
  - `open with wrong key returns null`
  - `fixed key+nonce matches seal-vectors.json` (three vectors, including unicode)
  - `clampPlain truncates title 80 / body 180 by code points`
  - `sealed blob for max-size plain is under 3000 base64 chars`
- [ ] Implement. Commit `feat(push): sealed push payload format`.

### Task 2: Relay Worker

**Files:**
- Create in `relay/`:
  - `relay/package.json`, `relay/wrangler.toml`, `relay/tsconfig.json`
  - `relay/src/index.ts` (router), `relay/src/apns.ts` (JWT and send), `relay/src/store.ts` (D1)
  - `relay/schema.sql`, `relay/README.md`
- Test: `relay/test/*.test.ts`, run with relay's own vitest using `@cloudflare/vitest-pool-workers`. If that pool can't run on this machine, use plain vitest with a `Store` interface backed by `node:sqlite` or an in-memory fake, and say so in the report.

**Interfaces (HTTP, JSON):**
- `POST /v1/register {apnsToken, env:'sandbox'|'production', ownerToken?, pushId?}`
  - Returns `{pushId, ownerToken}`.
  - With a valid `pushId` and `ownerToken`, it updates the token and env in place. Otherwise it creates a new registration.
  - `ownerToken` is 32 random bytes, base64url; only its SHA-256 is stored.
- `DELETE /v1/register {pushId, ownerToken}`: deletes the registration and all its send secrets.
- `POST /v1/secrets {pushId, ownerToken, label}`: returns `{secretId, sendSecret}`. Only a hash is stored.
- `DELETE /v1/secrets {pushId, ownerToken, secretId}`: revokes that secret.
- `POST /v1/push {pushId, sendSecret, sealed, kind}`: 202 on accept.
  - 401 for a bad secret, 404 for an unknown `pushId`, 413 if `sealed` is over 3500 chars, 429 when rate-limited.
  - 503 `{error:'apns_not_configured'}` when the APNs secrets are missing.
  - APNs request body: `{aps:{alert:{title:'SAI', body:'New activity in a chat'}, 'mutable-content':1, sound:'default', 'thread-id': <first 16 hex of SHA-256(pushId)>}, s: sealed, k: kind}`.
  - Headers: `apns-push-type: alert`, `apns-topic: com.project96.sai`, `apns-priority: 10`.
  - On APNs 410, or 400 `BadDeviceToken`, it deletes the registration.
- `GET /healthz` returns `{ok:true}`.
- **Secrets:** `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`. The JWT (ES256 over the PKCS8 `.p8`) is cached in module scope for 50 minutes.
- **Hosts:** `api.sandbox.push.apple.com` or `api.push.apple.com`, chosen by the registration's env.
- **CORS:** allow `capacitor://localhost` and `http://localhost` origins, for the phone's web fetch fallback.

- [ ] Tests:
  - `register then re-register with ownerToken updates token, keeps pushId and secrets`
  - `push with revoked secret is 401`
  - `push builds the exact APNs request` (mock `fetch`; assert URL, headers and body, with no plaintext anywhere)
  - `APNs 410 deletes the registration`
  - `missing APNS secrets → 503`
  - `JWT is ES256 and verifies with the public key` (use a test P-256 key)
  - `secrets and tokens are stored hashed only` (inspect rows)
  - `rate limit returns 429` (inject the limiter)
- [ ] Implement. Commit `feat(relay): APNs push relay worker`.

### Task 3: Desktop push sender

**Files:**
- Create:
  - `electron/services/push/registry.ts` (per-device registrations persisted in `userData/push-registrations.json`, mode 0600)
  - `electron/services/push/sender.ts`
  - `electron/services/push/triggers.ts`
  - `src/lib/push/config.ts` (`PUSH_RELAY_URL`)
- Modify:
  - `electron/services/remote/chat-v2.ts`: frames `push.register`, `push.unregister`, `phone.presence`
  - the device-revoke path in `electron/services/remote/*`: drop the registration on revoke
  - `electron/main.ts`: wiring
- Test: `tests/unit/push/registry.test.ts`, `tests/unit/push/triggers.test.ts`, `tests/integration/push/sender.test.ts` (with a fake relay HTTP server)

**Interfaces:**
- **v2 frames.**
  - `push.register {reqId, pushId, sendSecret, secretId, sealKey, keyId, env}` replies with `push.registered {reqId}`. Validate every field: base64 lengths, env enum, `keyId` matching `/^[A-Za-z0-9_-]{8,64}$/`.
  - `push.unregister {reqId}`.
  - `phone.presence {chatId: string|null, foreground: boolean}`. It is per socket, so a device's presence is the union over its sockets. It clears on socket close.
- **Registry.** `PushRegistry.set(deviceId, reg)`, `.get(deviceId)`, `.delete(deviceId)` and `.all()`. It is keyed by the bridge's `deviceId`, so it survives restarts, and the file is written atomically.
- **Triggers.** `createPushTriggers({chatlog, registry, presence, desktopPresence, send})` subscribes to chatlog entries in main:
  - **Fires on:** `done`/`result` that ends a turn → `done`, unless the turn was superseded or a stop was user-initiated. `approval_needed` → `approval`. `question_needed`, `plan_review_needed` or `user_input_needed` → `question`. A turn-ending `error` → `error`.
  - **Dedupe:** by `(chatId, kind, turnSeq, approvalId or questionId)`.
  - **Text:**
    - title = chat title (from meta) or the workspace folder name.
    - body for `done` = the first 180 chars of the final assistant text.
    - body for `approval` = "Approve <tool name>?"
    - body for `question` = the question text.
    - body for `error` = the error message.
  - **Suppression:** skips a device whose presence is `{foreground:true, chatId}`. Skips everyone when the desktop is focused with that chat's workspace active; reuse `notify.ts` focus tracking via an exported getter.
- **Sender.** `send(reg, plain)` calls `clampPlain` → `seal` → POST `${PUSH_RELAY_URL}/v1/push`, with a 5s timeout. It is fire-and-forget. On a 401 or 404 it deletes the registration. It logs `devlog('push', …)` with the kind, status and duration only.
- **Setting.** `pushNotifications` (default `true`), shown in the Remote settings section with copy "Send notifications to paired phones".

- [ ] Tests:
  - `approval_needed pushes once per approval id`
  - `done after superseded turn does not push`
  - `foreground presence for the chat suppresses push`
  - `desktop focused on the workspace suppresses push`
  - `register frame validates and persists; replay is idempotent`
  - `revoke device deletes registration`
  - `relay 401 deletes registration`
  - `relay timeout does not throw or block` (integration with a fake relay that sleeps 10s)
  - `payload posted to relay contains no plaintext`
- [ ] Implement. Commit `feat(push): desktop sends sealed push via relay`.

### Task 4: Phone registration, keys, presence and tap routing

**Files:**
- Create: `mobile/src/push/registration.ts`, `mobile/src/push/presence.ts`, `mobile/src/push/routing.ts`
- Modify:
  - `mobile/src/native.ts`: Keychain with access group, and push plugin wrappers
  - `mobile/src/machines/store.ts` and pairing: on pair, mint and send; on remove, revoke
  - `mobile/src/shell/App.tsx`: presence and tap routing
  - `package.json`: add `@capacitor/push-notifications` at the Capacitor 8 line
- Test: `tests/unit/mobile/push.test.ts`

**Interfaces:**
- **`ensurePushRegistration(native)`.**
  1. Requests permission after the first successful pairing, never on cold start before pairing.
  2. Gets the APNs token.
  3. Calls `POST /v1/register`, sending the previous `pushId` and `ownerToken` if they exist.
  4. Stores `push.pushId` and `push.ownerToken` in the Keychain.
  5. Re-runs on every `registration` event, because tokens rotate.
- **Env.** It comes from a native build flag that the Keychain plugin exposes as `Keychain.buildEnv() → {env}`, reading `aps-environment` from the embedded provisioning profile. When that's unknown it falls back to `production`.
- **`linkMachine(machine)`.** It calls `POST /v1/secrets` with `label = machine.label`. It then generates `newSealKey()` and `keyId = machine.id`, stores the seal key in the Keychain under `seal:<keyId>` in access group `$(AppIdentifierPrefix)com.project96.sai.shared`, and sends `push.register` over that machine's V2 connection. It is idempotent per machine: it reuses the stored secret and seal key on reconnect and resends the frame on each `auth_ok`.
- **`unlinkMachine(machine)`.** It sends `push.unregister` if connected, calls `DELETE /v1/secrets`, and deletes `seal:<keyId>`. It is called from `removeMachine`.
- **Presence.** The phone sends `phone.presence {chatId, foreground}` on chat open or switch, on app state change, and on `auth_ok`.
- **Tap routing.** `pushNotificationActionPerformed` reads `{m: keyId, c: chatId, p: projectPath}` from the notification's `userInfo`, which the NSE wrote. It selects machine `keyId`, then that workspace and chat. If the machine is unknown, it opens the machine list.
- **No push UI** beyond the permission prompt. There is a "Notifications" row in the Machines screen that shows the permission state and opens iOS Settings when it's denied.

- [ ] Tests:
  - `pairing links push: mints secret, stores seal key, sends push.register`
  - `reconnect resends push.register with the same secret and key`
  - `removeMachine revokes secret and deletes seal key`
  - `token rotation re-registers with ownerToken`
  - `tap routes to machine/workspace/chat`
  - `presence frame on chat switch and background`
- [ ] Implement. Commit `feat(mobile): push registration, presence and tap routing`.

### Task 5: Native iOS — push capability and the Notification Service Extension

**Files:**
- Create:
  - `mobile/ios/App/NotificationService/NotificationService.swift`
  - `mobile/ios/App/NotificationService/Info.plist`
  - `mobile/ios/App/NotificationService/NotificationService.entitlements`
  - `mobile/ios/App/App/App.entitlements`
- Modify:
  - `mobile/ios/App/App.xcodeproj/project.pbxproj`: a new `com.apple.product-type.app-extension` target `NotificationService` with bundle id `com.project96.sai.NotificationService`, an "Embed Foundation Extensions" build phase on App, and `CODE_SIGN_ENTITLEMENTS` for both targets
  - `mobile/ios/App/App/KeychainPlugin.swift`: access-group support and `buildEnv`
  - `mobile/ios/App/App/AppDelegate.swift`: the Capacitor push-notifications delegate forwarding from the plugin's docs
  - `.github/workflows/ios.yml`: the export must sign both targets; with automatic signing and `-allowProvisioningUpdates`, the extension gets its own profile
- Test: CI simulator build (compile only). A Swift-free unit test checks that `seal-vectors.json` round-trips through the TS `open`, and the Swift code mirrors it. Add `tests/unit/push/nse-contract.test.ts`, asserting that the Swift source reads the userInfo keys `s`, `k` and the Keychain item name format `seal:<keyId>`. The test greps the Swift file.

**Interfaces:**
- **Entitlements.**
  - App: `aps-environment` = `development`; the export rewrites it for production.
  - App and NSE: `keychain-access-groups` = `$(AppIdentifierPrefix)com.project96.sai.shared`.
- **NSE.**
  1. Read `userInfo["s"]` (the sealed blob).
  2. Try every Keychain item whose account matches `seal:*` in the shared group, using `AES.GCM.SealedBox(combined:)` and `AES.GCM.open`. Stop at the first key that authenticates. The relay doesn't know `keyId`, so it isn't in the payload.
  3. On success, set `title` and `body`, and set `userInfo["m"]` to the matching keyId, `userInfo["c"]` to chatId and `userInfo["p"]` to projectPath. Set `threadIdentifier` to chatId.
  4. On any failure, deliver the fallback content unchanged.
  5. `serviceExtensionTimeWillExpire` delivers the best attempt.
- **KeychainPlugin.** `set`, `get` and `remove` accept an optional `{group: true}` that adds `kSecAttrAccessGroup` with the prefix read at runtime from the bundle's `AppIdentifierPrefix` Info.plist key; add that key as `$(AppIdentifierPrefix)`. Seal keys use `kSecAttrAccessibleAfterFirstUnlock`, so the NSE can read them while the phone is locked.

- [ ] Write the Swift, plists, entitlements and pbxproj target. Mirror the target, phase and file-reference structure of an Xcode-generated app extension target exactly.
- [ ] Push, then fix CI compile errors in this task.
- [ ] Commit `feat(ios): notification service extension and push capability`.

### Task 6: Deploy the relay and wire the URL (controller-run)

- [ ] Bundle `relay/` with esbuild (or `wrangler deploy --dry-run --outdir`).
- [ ] Create the D1 database `sai-push` through the Cloudflare API, apply `schema.sql`, and upload the Worker `sai-push-relay` with the D1 binding and rate-limit binding.
- [ ] Enable the workers.dev route. Record the URL in `src/lib/push/config.ts`.
- [ ] Smoke test against the live relay:
  - `/healthz` returns 200.
  - `register` with a fake token, then `secrets`, then `push`, which returns 503 `apns_not_configured` until the APNs secrets are set.
- [ ] When the `.p8` becomes available: set `APNS_KEY_P8`, `APNS_KEY_ID` and `APNS_TEAM_ID` as Worker secrets. A push with a fake token must then return the APNs 400 `BadDeviceToken` path, proving the JWT is accepted.
- [ ] Commit `chore(push): point the app and desktop at the deployed relay`.

---

## After this plan

1. Merge to `main`, then ship a desktop `/release minor`, because the push frames and sender live on the desktop.
2. When the App Store Connect secrets and the APNs key exist:
   - Enable the Push Notifications capability on the App ID (through automatic signing or in the developer portal).
   - Tag `mobile-v0.2.0`.
   - Test on a device: a turn finishes on the desktop while the phone is locked, the decrypted text appears, and a tap opens the chat.
3. Part 4 (App Store submission: demo machine, privacy policy hosted on the relay at `/privacy`, listing, live updates) and Part 5 (terminal, files, git, PWA and Expo deletion).
