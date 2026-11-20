# SAI for iOS — Capacitor app, reliable chat sync, native push

**Status:** approved 2026-11-19
**Date:** 2026-11-19
**Replaces:** `sai-mobile/` (Expo app, never finished), `src/renderer-remote/` (PWA), and the
2026-05-30 iOS design (`2026-05-30-sai-mobile-ios-app-design.md`).

## Intent

A pocket SAI for chats. The user reaches for the phone to see what their agents are doing,
answer when they ask, approve tools, steer, and start new chats while away from the desk.
Chat is the product; everything else supports it.

Two earlier attempts (the PWA, then an Expo app) never synced reliably: chats often didn't
work, messages got dropped, and phone and desktop disagreed. The user wants a real App Store
app (native notifications, TestFlight / App Store, home-screen app) that **feels like SAI**,
not a separate mobile UI.

## Goals

1. **Nothing dropped, ever.** Phone and desktop always show the same chat. A phone that sleeps,
   loses signal, or is killed mid-reply catches up exactly on return.
2. **Feels like SAI.** The chat stream uses SAI's own components: stream-word fade, reasoning
   card, tool cards and per-tool presenters, approvals, AskUserQuestion, task feeds,
   background-work cards, follow-up rows, render cards (HTML, mermaid, chart, diff, 3D model),
   shimmer, waiting dots, themes. A new desktop chat feature reaches the phone from the same
   code, not a port.
3. **Native push notifications** (APNs) for: turn finished, tool needs approval, agent asked a
   question, turn errored. Tapping one opens that chat.
4. **Shipped through GitHub Actions** (macOS runner) to TestFlight / App Store; over-the-air
   web-bundle updates for fixes that don't need review.
5. **All providers** the desktop chat supports (Claude, Codex, Gemini, Kimi).
6. **Multiple machines**: machine list, pair each over Tailscale by QR.
7. **Public App Store app.** Any SAI user can install it and pair it with their own desktops.
   Nothing may assume the author's machines, account, or network.

## Non-goals

- Android (Capacitor allows it later; not built or tested now).
- Desktop-only surfaces: editor beyond the PWA's level, MCP panel, settings panels, browser
  bridge, sysmon, brainstorm takeover.
- A relay/cloud server for chat traffic. The phone talks to the desktop over Tailscale only.
  The one server is the push relay (Part 3), and it never sees chat content.
- Running agents on the phone. The desktop does all work.

## Anti-goals (failure even if it "works")

- A second, hand-maintained copy of the chat UI that drifts from desktop (what
  `renderer-remote/` became).
- Any path where phone history and the live stream come from different sources and can
  disagree.
- Feeling like a web page: rubber-band scrolling the whole shell, the keyboard covering the
  composer, the transcript jumping when the keyboard opens, tap delays, desktop hover-only
  affordances.

## Why it drops messages today (root cause, confirmed in code)

- **Live updates**: `emitChatMessage` (`electron/services/claude.ts:118`) publishes every backend
  event to `SessionBus` topic `chat:<projectPath>:<scope>`. Each topic is a ring of
  **256 events** (`session-bus.ts`, `RING_CAP`). Streaming deltas exhaust that in seconds, so a
  reconnect after a short sleep asks for `since=N` and silently gets a truncated tail.
- **History** comes from a separate source: the desktop renderer's IndexedDB
  (`remoteProxyClient.ts` → `dbGetMessages`), reached by proxying through the renderer window.
  It holds *reduced* chat messages saved on settle, while the live stream carries *raw* backend
  events. An in-progress turn is in neither place completely, and the two shapes have to be
  merged by the client. It also fails if the renderer is busy, reloading, or the panel unmounted.
- Topics are keyed by workspace scope, not by chat session, so switching chats on desktop
  changes what a phone attached to that scope receives.

## Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **Capacitor** (React web app in a native iOS shell, like duel-binder) | Reuses SAI's React chat components directly; UI runs in a browser here so vitest/Playwright work on Linux; duel-binder already has the CI, signing and live-update pipeline. Cost: WKWebView needs care to feel native (keyboard, scrolling, long transcripts). | **Chosen** |
| Flutter (like famchat) | Smoothest native feel, runnable on Linux. But every chat component and render card is rebuilt in Dart and every new desktop feature ported twice; render cards end up in web views anyway. Parity would always lag. | Rejected |
| SwiftUI | Best platform feel and background behavior. Can't build or run on this Linux box (every check is a CI round-trip), shares nothing with SAI's code. | Rejected |
| Keep/fix Expo app | User wants off Expo and EAS. | Rejected |

Native notifications, App Store distribution, Face ID, haptics and share sheet are equal in
Capacitor and Flutter; the deciding factor is parity cost with a desktop that ships weekly.

## Design

### Part 1 — Reliable sync (desktop, ships first)

**One source of truth per chat session, in the main process.**

- Main keeps a **durable, append-only event log per chat session** (keyed by
  `projectPath + sessionId`, not scope), on disk in userData. Every event that today goes
  through `emitChatMessage` (Claude SDK, Codex, sudo, load guard, and any other emitter) is
  appended with a monotonically increasing **per-session `seq`** before it is sent anywhere.
  The desktop renderer and phones are both just readers of this log.
- **Phone protocol (v2)**: the phone subscribes to a session with `after: <lastSeq>`. The
  desktop replies with every event after that seq, then streams live events, each carrying its
  seq. The phone persists `lastSeq` per session and ignores duplicates (`seq <= lastSeq`). A gap
  (`seq > lastSeq + 1`) triggers a re-subscribe from `lastSeq`. There is no other history path.
- **Cold start / long chats**: a phone with no `lastSeq` must not replay megabytes of deltas.
  The log supports a compact **snapshot** (the reduced message list as of seq N) plus the tail
  after N. How snapshots are produced (periodic compaction in main, or on turn end) is the
  builder's call; the requirement is that snapshot + tail is exactly equivalent to full replay.
- **One reducer.** The logic that turns raw backend events into displayed chat messages
  currently lives in the desktop renderer (App/ChatPanel). It is extracted into a pure, shared
  module used by desktop renderer, phone, and snapshot compaction, so all three produce
  identical results. Tests replay recorded event logs through it.
- **Existing chats** (history only in IndexedDB) are imported into the log once, as a snapshot
  at seq 0, on first access.
- **The desktop reads the log too** *(builder-check call)*. Today IndexedDB is written only by the
  reducer inside the one mounted `ChatPanel` per workspace (`App.tsx`, keyed by the active
  session), so a turn the phone runs in a chat the desktop isn't showing — or a chat the phone
  creates — would never reach desktop history. "Same chat on both" therefore requires the log to
  be the source of truth for desktop display as well; IndexedDB becomes a cache of it (or is
  retired). This is the riskiest part of the project (turnSeq / streaming-state handling) and is
  sequenced and tested accordingly.
- **Log key = SAI's chat id** *(builder-check call)*, which Claude and Codex already use as their
  scope. Gemini and Kimi currently emit on a fixed `'chat'` scope (`ChatPanel.tsx`); their
  backends are changed to emit the real chat id. Wildcard events (load guard, `'*'`) are fanned
  out to the affected chats' logs or kept on a separate machine-level stream (builder's call).
  Backend session ids (`claudeSessionId` etc.) stay metadata, not keys.
- **Per-chat state lives in main and is shared** *(builder-check call)*: model, provider,
  permission mode, effort, the message queue, and waiting/follow-up state for a chat are the
  same on both devices. Changing the model on the phone changes it for that chat on desktop.
  The remote permission ceiling (`setRemoteCeiling`) still caps what the phone may set.
- **Sending mid-turn behaves as on desktop** *(builder-check call)*: it queues. The queue is
  shared state in main, so both devices see the same pending messages.
- **Commands from the phone** (send, stop, approve, answer question, compact, new chat, switch
  model/provider) carry a client-generated id and are idempotent, so a resend after reconnect
  can't double-send a prompt. The result of each command is acknowledged on the socket.
- **Workspace and session lists** (and live status: streaming / waiting / approval / done) come
  from main-process state, not a renderer proxy round-trip, wherever main already has it.
  Anything that only the renderer knows is pushed to main on change rather than pulled on
  request.
- The old bus/ring and `renderer-proxy.ts` history path are removed when the PWA is deleted.
- Pairing (argon2id bearer tokens, `pairing-store.ts`), the Tailscale-only bind, and the
  host allowlist stay as they are.

### Part 2 — The app (Capacitor)

**Where it lives:** a new `mobile/` directory in this repo (Capacitor iOS project under
`mobile/ios/`), its own Vite config, built from shared source under `src/`. `sai-mobile/` and
`src/renderer-remote/` are deleted at the end (Part 4).

**Sharing SAI's components:** desktop chat components reach the desktop only through
`window.sai.*` (send, stop, approve, answer, compact, settings, clipboard, openExternal,
…). The phone provides its own `window.sai` implementation that maps those calls onto the v2
protocol (or to native plugins: clipboard, open URL, share). Components render unchanged. Where
a component is desktop-shaped (hover-only controls, widths, mouse-only gestures), it is adapted
with responsive/touch variants in the shared component, not forked. Calls that make no sense on
a phone (load-guard internals, Linear/Jira lookups if not proxied, etc.) degrade gracefully;
which ones to proxy versus stub is the builder's call, guided by "the chat should behave like
desktop."

**Phone shell (layout around the chat):**

```
┌─────────────────────────┐
│ ☰  sai · main      ● ⋯ │  workspace + live status dot
├─────────────────────────┤
│  (desktop chat stream,  │
│   same components)      │
├─────────────────────────┤
│ [ composer, SAI style ] │  provider/model, attach image
└─────────────────────────┘
  drawer: machines → workspaces → chats (+ new chat)
```

- **Machines**: list of paired desktops with reachability; pair by scanning the QR from desktop
  settings (camera via native plugin) or pasting the pair URL. Tokens in the iOS Keychain.
- **Composer**: SAI's composer adapted for touch; image attach from camera/library (resized),
  provider/model picker, stop. Keyboard must never cover it.
- **Themes**: SAI's themes, following the desktop setting.
- **Lifecycle**: on foreground, reconnect and resume from `lastSeq` immediately; show a quiet
  "catching up" state, never a blank or stale chat. iOS will suspend the socket in background,
  which is fine because push covers that window and resume is exact.
- The PWA (`src/renderer-remote/`) is the reference for **scope and flows**, not for code.

### Part 3 — Push notifications

- APNs via a Capacitor push plugin. Events: turn finished, approval needed, question asked,
  turn errored. A tap deep-links to that machine + workspace + chat.
- **Push goes through a small relay** (decided: the app is public, so the APNs `.p8` key can't
  ship to every desktop). A Cloudflare Worker holds the key as a secret and is the only thing
  that talks to APNs.
  - The phone registers its APNs token with the relay and gets back an opaque push id plus a
    per-device send secret. It hands those to each desktop at pairing, over the authenticated
    socket. The desktop never sees the raw APNs token.
  - The desktop POSTs `{pushId, secret, sealed payload}` to the relay; the relay looks up the
    token and forwards. Rate-limited per push id. Unpairing or reinstalling revokes the secret.
  - **The relay never sees chat content** *(my call)*: the payload is sealed with a key shared
    between phone and desktop at pairing and opened on the phone by a Notification Service
    Extension. The relay sees only a push id, a sealed blob, and a timestamp. Logs keep no
    payloads.
  - Sandbox vs production APNs is chosen per registration (debug/TestFlight builds vs App Store).
- Don't push for a chat the phone is currently showing in the foreground.
- Push only works while the desktop SAI is running; that is acceptable.
- Don't push for a chat the phone is currently showing in the foreground.
- Push only works while the desktop SAI is running; that is acceptable.

### Part 4 — Remaining PWA-level scope, then removal

After chat is solid: terminal (xterm in the web view), file browse/view, git changes and diff,
at the level the PWA has today. Then delete `src/renderer-remote/`, `vite.config.pwa.ts`, the
`build:pwa-mobile` scripts, the PWA asset sync, and `sai-mobile/` plus
`sai-mobile-manual-verifications.md`. Desktop's mobile-remote settings stop offering the PWA
URL.

### Build and release

- `.github/workflows/ios.yml`, modeled on duel-binder's (`../duel-binder/.github/workflows/ios.yml`)
  and otto's: `macos-26` runner, archive unsigned, sign at export with cloud-managed
  distribution signing via an App Store Connect API key, upload to TestFlight. PRs touching the
  app only compile for the simulator.
- Tag scheme separate from desktop releases (`mobile-v<version>`, as otto does) so the two never
  trigger each other. *Superseded: desktop and iOS now share `v*` tags and one version (README,
  "Releasing").*
- Live web-bundle updates via `@capgo/capacitor-updater` in manual mode, as duel-binder does.
  Where the bundles are hosted is the builder's call (GitHub Releases is fine).
- Bundle id: reuse `com.project96.sai` from the Expo app.
- **App Review** *(my calls, because the app is public)*:
  - A built-in **demo machine**: reviewers can't pair a desktop, so the machine list offers a
    demo that replays recorded sessions through the real reducer and components. It also
    serves as a test fixture.
  - A privacy policy page (hosted next to the relay) and App Store privacy labels: no tracking;
    chat data stays on the user's own devices; the push relay stores device tokens only.
  - Over-the-air bundles change only web code within the reviewed feature set (guideline
    3.3.1(B)/4.7). Anything needing a new native plugin goes through review.
  - Pairing assumes the user runs Tailscale (or any network where the phone can reach the
    desktop). The listing and onboarding say so.
- Credentials: App Store Connect API key, APNs key, and the rest are in 1Password; the builder
  has a browser signed in to App Store Connect for setting up the app record, push capability,
  and TestFlight.
- Repo secrets needed: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
  `APP_STORE_CONNECT_KEY`. `APPLE_TEAM_ID` already exists.

## Constraints

- No Mac locally: iOS builds and simulator checks happen only in GitHub Actions; everything else
  (reducer, protocol, UI in a browser) must be testable on Linux with vitest / Playwright.
- vitest runs with `--maxWorkers=2` (machine memory).
- Paths may differ by symlink (`/home` vs `/var/home`); never match paths by string equality.
- The SDK backend's turnSeq invariants (streaming_start/done pairing, superseded turns,
  background-wait states) are hard-won; the shared reducer must preserve them exactly and is
  tested against recorded real sessions.

## Order of work

1. Sync: session log, seq protocol v2, shared reducer, idempotent commands.
2. App: Capacitor shell, pairing, machines, chat on shared components, TestFlight via CI.
3. Push notifications: relay Worker, Notification Service Extension, desktop sender.
4. App Store submission: demo machine, privacy policy, listing.
5. Terminal / files / git at PWA level; delete PWA and Expo app.

Each is its own plan and ships on its own.

## Left to the builder

- Log storage format and compaction strategy (sqlite is already a dependency via the pairing
  store).
- Exact v2 wire frames.
- Which `window.sai` calls are proxied versus stubbed on the phone.
- Capacitor plugin choices beyond the updater.
- How shared components get touch variants (props, container queries, a `isPhone` context).

## Open items

None. APNs key distribution was settled by the app being public: push relay (Part 3).
