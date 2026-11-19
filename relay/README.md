# SAI push relay

A Cloudflare Worker that sends SAI's iPhone push notifications. It is the only
component that holds the APNs key and talks to APNs.

The relay maps an opaque `pushId` to the phone's APNs device token, and
forwards sealed blobs (AES-256-GCM, keyed on the phone and the desktop) that it
cannot read. It never sees chat content.

## Endpoints

All bodies are JSON, at most 8 KB. Ids are 16 random bytes and bearer tokens 32
random bytes, both unpadded base64url. Errors are `{error, ...}`; malformed input
is `400 {error:'invalid', field}`.

| Method and path | Body | Response |
| --- | --- | --- |
| `POST /v1/register` | `{apnsToken, env:'sandbox'\|'production', pushId?, ownerToken?}` | `200 {pushId, ownerToken}`. With a matching `pushId` and `ownerToken` it updates the token and env in place (same `pushId`, existing send secrets keep working). Otherwise it creates a new registration. Limited to 10/min per client IP (`429`). |
| `DELETE /v1/register` | `{pushId, ownerToken}` | `200 {ok:true}`; deletes the registration and all its send secrets. `401` bad owner token, `404` unknown `pushId`. |
| `POST /v1/secrets` | `{pushId, ownerToken, label}` | `200 {secretId, sendSecret}`, one per paired desktop. `label` is at most 64 chars. At most 32 secrets per `pushId` (`409`). |
| `DELETE /v1/secrets` | `{pushId, ownerToken, secretId}` | `200 {ok:true}`; revokes that secret (idempotent). |
| `POST /v1/push` | `{pushId, sendSecret, sealed, kind}` | `202` accepted by APNs. `400` bad input, `401` bad secret, `404` unknown `pushId`, `413` `sealed` over 3500 chars, `429` over 30/min for this `pushId`, `503 {error:'apns_not_configured'}` (or `apns_key_invalid`), `410 {error:'unregistered', reason}` when APNs says the token is gone (the registration is deleted, so later pushes get `404`), `502 {error:'apns_error', reason}` for any other APNs error, `502 {error:'apns_unreachable'}`. |
| `GET /healthz` | | `200 {ok:true}` |

`kind` is one of `done | approval | question | error`. `sealed` is standard
base64 of `nonce(12) ‖ ciphertext ‖ tag(16)`.

What APNs receives (`apns-push-type: alert`, `apns-topic: com.project96.sai`,
`apns-priority: 10`, to `api.sandbox.push.apple.com` or `api.push.apple.com` by
the registration's env):

```json
{"aps":{"alert":{"title":"SAI","body":"New activity in a chat"},"mutable-content":1,"sound":"default","thread-id":"<first 16 hex of SHA-256(pushId)>"},"s":"<sealed>","k":"<kind>"}
```

The phone's Notification Service Extension decrypts `s`. If it can't, the fixed
fallback text is shown.

The relay deletes a registration when APNs answers `410`, or `400` with
`BadDeviceToken` or `DeviceTokenNotForTopic`.

CORS allows only `capacitor://localhost` and `http://localhost`.

## Secrets

Set these as Worker secrets. They are never logged.

```sh
npx wrangler secret put APNS_KEY_P8    # paste the whole AuthKey_XXXXXXXXXX.p8 file, PEM lines included
npx wrangler secret put APNS_KEY_ID    # the 10-character key id
npx wrangler secret put APNS_TEAM_ID   # the Apple developer team id
```

Until all three are set, `/v1/push` answers `503 apns_not_configured`. The
provider JWT (ES256) is signed in the Worker and cached for 50 minutes.

## Deploy

```sh
cd relay
npm install
npx wrangler d1 create sai-push              # copy the database_id into wrangler.toml
npx wrangler d1 execute sai-push --remote --file schema.sql
npx wrangler deploy
# then set the three secrets above
```

`wrangler.toml` also declares two rate-limit bindings (`PUSH_LIMITER`, 30/60s,
namespace `9601`; `REGISTER_LIMITER`, 10/60s, namespace `9602`). The namespace
ids only need to be unique within the Cloudflare account.

`npm run build` writes the bundled Worker to `dist/` without deploying.

## Tests

```sh
npm test          # vitest in the Workers runtime (@cloudflare/vitest-plugin), D1 in Miniflare
npm run typecheck
```

## Privacy

What is stored, in D1:

- `registrations`: `pushId`, the SHA-256 of the phone's `ownerToken`, the APNs
  device token, `sandbox`/`production`, created and updated timestamps.
- `send_secrets`: `secretId`, `pushId`, the SHA-256 of the desktop's
  `sendSecret`, the machine label the phone chose, and a created timestamp.

How long: a registration and its secrets live until the phone unregisters
(`DELETE /v1/register`), the phone revokes a desktop (`DELETE /v1/secrets`), or
APNs reports the token is no longer valid. There is no other expiry.

What is never stored: push payloads. The sealed blob is forwarded to APNs in
memory and dropped. The relay has no key to open it.

What is logged: one line per request, `{route, status, ms}`. No bodies, tokens,
secrets, ids, IP addresses or paths outside the fixed routes. Workers Logs
(`[observability]`) is deliberately not enabled, so even that line is only
visible live in `wrangler tail`. Rate limiting uses the client IP as an
in-memory counter key in Cloudflare's rate-limit service; the relay does not
store it.
