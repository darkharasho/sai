# SAI Mobile — Native iOS Companion App

**Status**: Design approved, ready for plan
**Author**: brainstormed 2026-05-30
**Related**: `electron/services/remote/`, `src/renderer-remote/`, `../../otto/otto-mobile/` (reference)

## Summary

Build a native iOS companion app for SAI using Expo, replacing/augmenting the existing PWA at `src/renderer-remote/`. The native app pairs with multiple desktop SAI instances over Tailscale, providing chat (with image attachments), terminal (via WebView-hosted xterm.js), and read-only files. Modeled on otto-mobile's stack and lessons learned, with multi-machine support as the primary net-new feature.

## Goals

- Full feature parity with the PWA where it makes sense on mobile (chat, terminal, read-only files).
- First-class multi-machine pairing — the home screen is a list of paired machines.
- Reuse the existing remote bridge (`electron/services/remote/bridge-server.ts`) without protocol changes.
- Ship to TestFlight via EAS Build from day 1.

## Non-goals (v1)

- Android (Expo supports it; we won't test or ship).
- File editing on iOS (deferred to v1.1).
- Light theme / runtime theme switching on mobile (port all 3 themes statically; switcher in v1.1).
- Push notifications.
- E2E tests (Detox/Maestro).
- Multiple simultaneous machine connections (one active at a time).
- Shared wire package across desktop PWA and mobile (deferred — see Open Items).

## Architecture

### Repo layout

In-repo sibling: `sai/sai-mobile/`, mirroring `otto/otto-mobile/`. Independent `package.json`, no workspace plumbing for v1.

### Stack

- **Framework**: Expo SDK 54+, expo-router (file-based routing), new arch enabled.
- **Styling**: NativeWind 4 (Tailwind for RN).
- **State**: Zustand.
- **Secrets**: `expo-secure-store` (Keychain) for per-machine bearer tokens.
- **Camera**: `expo-camera` for QR scanning.
- **Image picker**: `expo-image-picker` + `expo-image-manipulator` (resize before upload).
- **WebView**: `react-native-webview` for terminal (xterm.js) and file syntax (Shiki).
- **Markdown**: `react-native-markdown-display` for chat.
- **Build**: EAS Build → TestFlight.

### Module boundaries (`sai-mobile/lib/`)

| Module | Responsibility |
|--------|----------------|
| `wire.ts` | Protocol + WebSocket client (transport only). Ported from `src/renderer-remote/wire.ts`. |
| `connection.ts` | Per-machine connection lifecycle (open, reconnect, close, foreground-resume). |
| `machines.ts` | Persisted machine list + active selector. Zustand + AsyncStorage (metadata) + SecureStore (tokens). |
| `store.ts` | Runtime UI state — transcript cache, terminal buffer per machine. |
| `theme.ts` | Port of `src/themes.ts` to NativeWind tokens (default/midnight/steel). |
| `tool-presenters.ts` | Maps SAI tool-use messages to chat cards (pattern from otto-mobile). |
| `images.ts` | Image picker + resize-to-1568px + base64 encode helpers. |

### Top-level screens (expo-router)

- `app/onboarding.tsx` — Tailscale prereq screen (first launch only).
- `app/index.tsx` — Machine list (home).
- `app/scan.tsx` — QR scanner + manual paste fallback.
- `app/m/[machineId]/_layout.tsx` — Per-machine bottom tabs + WS lifecycle owner.
- `app/m/[machineId]/chat.tsx`
- `app/m/[machineId]/terminal.tsx`
- `app/m/[machineId]/files/index.tsx` — Browse.
- `app/m/[machineId]/files/changes.tsx` — Git status.
- `app/m/[machineId]/files/view.tsx` — Read-only viewer (Shiki in WebView).

## Data flow & state

### Machine identity

```ts
type Machine = {
  machineId: string;       // uuid generated locally at pair time
  label: string;           // user-editable
  hostUrl: string;         // e.g. https://my-mac.tail-xxxx.ts.net
  deviceId: string;        // returned by bridge /pair
  pairedAt: number;
  lastSeenAt: number | null;
};
```

- Bearer tokens stored in SecureStore, keyed by `machineId`. Never in AsyncStorage, never logged.
- Machine metadata persisted to AsyncStorage via Zustand `persist`.

### Connection lifecycle

- Owned by `app/m/[machineId]/_layout.tsx`. Mount opens WS; unmount closes.
- One active `WireClient` at a time. Switching machines = navigate away = close.
- Reconnect: exponential backoff 1s → 2s → 5s → 10s → 30s (capped).
- iOS foreground resume: subscribe to `AppState` change → force-reconnect if WS closed.

### Reachability

Machine list pings each machine's `/health` every 30s while the list screen is visible. Online dot = green, offline = gray. Offline machines are still tappable; the route layout retries.

### Transcripts

Scoped by `(machineId, projectPath, sessionId)`. Cached in memory via Zustand. **Not persisted** to disk in v1 — the desktop bridge is source of truth, mobile refetches on attach. Matches PWA behavior.

### Terminal

WebView holds the xterm.js buffer per `(machineId, terminalId)`. Switching terminals = swap mounted WebView; keep last N mounted (LRU eviction) to preserve scrollback. Output frames arrive over WS as `term:data` messages, forwarded into WebView via `postMessage`.

## UX flows

### First launch

1. `app/onboarding.tsx` — Tailscale prereq screen explaining: (a) install Tailscale on phone, (b) desktop SAI running with mobile remote enabled. Single CTA → `app/scan.tsx`.
2. Onboarding shown once (flag in AsyncStorage). Re-accessible from settings.

### Pairing

1. `app/scan.tsx`: full-screen camera with QR reticle; bottom sheet has "Enter pair URL manually."
2. On QR / paste: parse pair URL → extract `hostUrl` + `code`.
3. Validate `hostUrl`: must be HTTP(S), host must be private/CGNAT range OR end in `.ts.net`. Reject otherwise.
4. `POST {hostUrl}/pair` with `{ code, deviceLabel: "iPhone — <device name>", clientId: <uuid> }` → `{ token, deviceId }`.
5. Store `Machine` in machines store; `token` in SecureStore. Navigate to `app/m/[machineId]/chat`.
6. Errors render inline with class-specific copy (see Error handling).

### Machine list (`app/index.tsx`)

- Row: label, host URL, online dot, last-seen.
- Tap → enter machine.
- Swipe-left → rename / unpair. Unpair calls `DELETE {hostUrl}/pair/{deviceId}`, then removes locally.
- Header "+" → `app/scan.tsx`.

### Per-machine

- Top bar: machine label + connection state pill. Tap label → back to list.
- Bottom tabs: Chat, Terminal, Files.
- Workspace picker lives in chat header (port of PWA's `WorkspacePicker.tsx`).

### Chat

- Transcript above, composer below.
- Composer: text input, model/effort/permMode pickers (port `Composer.tsx`), attach-image button (camera + library), paste image from clipboard.
- Approvals render in-line (port `Approval.tsx`).
- Tool cards via `tool-presenters.ts`.

### Terminal

- WebView fills screen. iOS keyboard handling via `KeyboardAvoidingView` (or `react-native-keyboard-controller` if that proves insufficient).
- Top bar terminal picker for multiple terminals per workspace.
- Resize: WebView reports its size to RN; RN sends `term:resize` to bridge.

### Files

- Read-only in v1. Tabs: Browse, Changes (git status), Repo picker.
- Tap file → Shiki-highlighted view inside a small WebView. Diff viewer for changed files.
- Settings shows: "Editing on iOS coming in v1.1."

## Error handling

| Condition | Behavior |
|-----------|----------|
| WS disconnect | State pill shows "reconnecting…". Transcript/terminal stay rendered. Composer disables Send. Up to 1 pending message queued; flushes on reconnect; drops on navigate-away. |
| Pair: network | "Can't reach <host>. Is Tailscale on?" |
| Pair: code expired | "Pair code expired. Generate a new one on desktop." |
| Pair: code invalid | "Invalid pair code." |
| Pair: unknown | Raw error message. |
| Token revoked (401) | Drop token from SecureStore; mark machine "unpaired — re-pair"; route to scan with `hostUrl` prefilled. |
| Image too large | Auto-resize via `expo-image-manipulator` to max edge 1568px before base64. |

## Security & network

- Bearer tokens in SecureStore only.
- `Info.plist`: `NSAllowsArbitraryLoads: true`, exceptions for `ts.net` (subdomains) and CGNAT (`100.64.0.0/10`). Matches otto-mobile's pattern.
- Trust model: the tailnet is the boundary. SAI mobile assumes hosts reachable on the tailnet are user-owned. Pair URL validation enforces this client-side as defense-in-depth.
- App Store review note (pre-drafted): "Local-network developer tool. Connects only to user-owned devices over Tailscale VPN. NSAllowsArbitraryLoads required because Tailscale hosts use private IPs / `.ts.net` hostnames without public CA certs."
- No analytics or third-party crash reporting in v1.

## Testing

- **Unit** (Jest via Expo preset): wire serialization, pair URL parsing/validation, machine store, terminal ringbuffer.
- **Component** (React Native Testing Library): composer, machine list, approval card, scan state machine.
- **Integration**: `mockWire` driving the store with canned message sequences. Mirrors `tests/integration/remote/` on desktop.
- **Wire compatibility fixture**: shared JSON file (`tests/fixtures/wire-messages.json` — duplicated into `sai-mobile/tests/` for v1) covering every message type. Both clients parse it in tests. First file extracted when wire moves to a shared package.
- **No E2E in v1.** Manual TestFlight covers end-to-end.

## Build & distribution

- EAS Build, `eas.json` configured for `development` and `preview` (TestFlight) profiles.
- Apple Developer account ($99/yr) — assume already in place from otto.
- Bundle identifier: `com.sai.mobile` (confirm with user before first build).
- TestFlight from day 1, App Store submission deferred.

## Theme system

Port `src/themes.ts` (3 themes: default, midnight, steel) to NativeWind. Each theme exposes the same token names as CSS vars on desktop (`--bg-primary`, `--accent`, etc.) mapped to Tailwind theme tokens. Default theme only at runtime in v1; theme switcher in v1.1.

## Open items / deferred

1. **Extract wire to shared package** (`packages/wire/`). Tracked. Trigger: both clients stable, mobile on TestFlight.
2. **File editing on iOS** — v1.1. Will need stale-write checks via existing wire (`expectMtime`/`expectSha`).
3. **Runtime theme switcher on mobile** — v1.1.
4. **Detox or Maestro E2E** — when manual testing becomes the bottleneck.
5. **Push notifications** for approvals / new messages — needs APNS setup and a server-side push from the bridge.
6. **Bundle identifier confirmation** before first EAS Build.

## Reference

- otto-mobile: `../../otto/otto-mobile/` — pairing UI patterns, NativeWind setup, `allow-http` plugin, EAS config.
- SAI bridge: `electron/services/remote/bridge-server.ts`, `pairing-store.ts`.
- SAI PWA (port source): `src/renderer-remote/`.
