# SAI for iOS (Part 2): Capacitor App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Capacitor iOS app (`com.project96.sai`) that pairs with one or more SAI desktops over Tailscale and renders SAI's real `ChatPanel` against protocol v2. It is built, tested and uploaded to TestFlight by GitHub Actions.

**Architecture:**
- The phone is a Vite web app under `mobile/` with a Capacitor iOS shell in `mobile/ios/`.
- It mounts the desktop's `ChatPanel` unchanged in logic, behind a phone `window.sai` shim. The shim maps `chatlog.*` onto v2 frames (`chat.subscribe` / `chat.command`), maps clipboard, links and haptics onto Capacitor plugins, and stubs desktop-only calls.
- The desktop grows a few v2 frames, so the phone gets everything from the main process and never from the renderer proxy:
  - workspaces and the chat list, with pushes;
  - app settings and theme;
  - model lists and slash commands;
  - tool images and 3D model files;
  - background tasks;
  - `clear`, `compact` and client-note commands.
- The shared reducer grows `waiting`, `followUp` and `awaitingQuestion`, so a client that only reads the log can show those states.

**Tech Stack:** TypeScript, React 19, Vite 6, Capacitor 8 (SPM, no CocoaPods), `ws`, vitest (`--maxWorkers=2`), Playwright (Chromium, on Linux), GitHub Actions `macos-26`.

**Spec:** `docs/superpowers/specs/2026-11-19-sai-ios-app-design.md`. Part 2 is binding, and Parts 1 and Build and release are context. Part 1 shipped in v1.38.0. Read `electron/services/remote/README.md` (v2 section) before touching the protocol.

## Global Constraints

- **Bundle and tags.** Bundle id `com.project96.sai`, app name `SAI`. Mobile tags are `mobile-v<x.y.z>`; desktop tags stay `v*`, and neither workflow may trigger the other.
- **Shared components are adapted, never forked.** No copy of ChatPanel, ChatInput, ChatMessage or the tool cards may appear under `mobile/`. Phone differences come from an `isPhone()` check (`src/lib/platform.ts`) and CSS scoped by `html[data-sai-phone]`.
- **One history source.** The phone gets chat history only from v2 (`chat.subscribe` / `chat.page`). It never reads IndexedDB, `session.history`, or v1 `session.attach`.
- **Every phone command carries a client id and goes through `chat.command`.** Resends after reconnect must not double-send.
- **The desktop never trusts the phone.**
  - New v2 frames validate inputs at the boundary.
  - File reads are confined by realpath to the tool-result image dir and the model cache.
  - Settings writes stay capped by the remote ceiling.
  - Chat ids pass `chatIdOf` (`chat-v2.ts`).
- **No Mac locally.** Everything except the Xcode build must run on Linux: vitest, Playwright against the mobile Vite build, `npx cap sync ios`. iOS compile happens only in CI.
- **Paths may differ by symlink** (`/home` vs `/var/home`). Never compare paths by string equality.
- **vitest** always runs with `--maxWorkers=2` or `--project unit|integration`.
- **Never run `npm run dev`.** The user's live SAI is running.
- **Desktop UX must not regress.** Phone-only behavior must be gated by `isPhone()`, except the scroll-follow fix in Task 4, which is a real desktop bug on touchscreens too.
- **Commits.** Commit after each task. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on the branch `ios-app` off `main`.

## Review Focus

1. **The phone sleeps mid-reply, then foregrounds.** It resumes from its last seq with a quiet "catching up" state, never a blank or stale chat, and the reply ends identical to the desktop's. Tested in Task 7 (`resume after socket drop catches up exactly`) and Task 9 (`foreground resubscribes from lastSeq`).
2. **The user scrolls up to read while a reply streams on touch.** The view stays where they are. Tested in Task 4 (`touch scroll up releases follow`).
3. **A chat longer than the 200-message snapshot window.** Earlier messages are reachable ("Load earlier") and never silently missing. Tested in Task 4 (`prependOlder stitches pages in order`) and Task 7 (`open pages older messages on demand`).
4. **A desktop that's asleep, offline or unpaired.** The machine list shows it as unreachable, the chat shows "can't reach <machine>", and nothing spins forever. A revoked token sends the user to re-pair. Tested in Task 7 (`4001 auth_failed surfaces as unpaired`) and Task 8 (`unreachable machine shows offline`).
5. **A phone-created chat or phone-sent message shows up on the desktop**, in the sidebar and the open panel, without a restart. Tested in Task 2 (`chats.changed pushes a phone-created chat`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/chat/reducer.ts`, `types.ts` (modify) | `ChatState.waiting`, `followUp`, `awaitingQuestion` |
| `electron/services/remote/chat-v2.ts` (modify) | New frames: `workspaces.*`, `chats.subscribe` / `chats.changed`, `app.settings`, `models.list`, `slash.list`, `file.read`, `chat.background` |
| `electron/services/remote/workspaceRegistry.ts` (create) | Main-side cache of desktop workspaces and status, pushed by the renderer |
| `electron/services/chatlog/commands.ts` (modify) | Command kinds `clear`, `compact`, `clientEvent`, `stopTask` |
| `electron/services/remote/bridge-server.ts` (modify) | CORS and `OPTIONS` for `/pair` and `/healthz` |
| `src/lib/platform.ts` (create) | `isPhone()` |
| `src/hooks/useChatLog.ts` (modify) | `olderCount`, `loadOlder()` |
| `src/components/Chat/*` (modify) | Touch scroll-follow fix, `isPhone()` variants, phone CSS |
| `src/styles/phone.css` (create) | `html[data-sai-phone]` overrides |
| `capacitor.config.ts` (create, repo root) | appId, `webDir: 'dist/mobile'`, `ios.path: 'mobile/ios'` |
| `mobile/index.html`, `mobile/vite.config.ts`, `mobile/tsconfig.json` (create) | Phone web build |
| `mobile/src/main.tsx` (create) | Installs the shim, then lazy-imports the app |
| `mobile/src/v2/client.ts` (create) | `V2Client`: socket, auth, heartbeat, reconnect, reqId RPC, subscription replay |
| `mobile/src/v2/saiShim.ts` (create) | `createSaiShim(client, opts)` returns a `window.sai` |
| `mobile/src/machines/*` (create) | Machine store, pairing, reachability |
| `mobile/src/shell/*` (create) | App shell, drawer, header, `ChatHost`, catching-up, toasts, lifecycle |
| `mobile/ios/**` (create, committed) | Capacitor iOS project (SPM), Info.plist, `KeychainPlugin.swift` |
| `.github/workflows/ios.yml` (create) | Simulator build on PRs; TestFlight on `mobile-v*` when secrets exist |
| `tests/unit/mobile/**`, `tests/integration/mobile/**`, `tests/e2e-mobile/**` (create) | Tests |

---

### Task 1: Waiting, follow-up and question state in the shared reducer

**Files:**
- Modify: `src/lib/chat/types.ts`, `src/lib/chat/reducer.ts`
- Test: `tests/unit/chat/reducer.test.ts`, `tests/unit/chat/reducer.golden.test.ts` (update snapshots on purpose)

**Interfaces:**
- Produces, on `ChatState`:
  - `waiting: { kind: 'background' | 'scheduled'; resumeInSeconds?: number; taskCount?: number; since: number } | null`
  - `followUp: { state: 'following' | 'resuming' | 'stalled'; waitingFor?: string } | null`
  - `awaitingQuestion: boolean`
- `emptyChatState` sets them to `null`, `null` and `false`. Snapshots carry them, so they survive compaction.
- Rules, mirroring `App.tsx:2039-2196` and `:2087-2113`:
  - `done` with `wait.kind !== 'none'` (and not stale under the existing turnSeq rules) sets `waiting`, with `since = entry.ts`.
  - `done` without a wait, `result`, `streaming_start`, `user_message` and `cleared` clear `waiting`.
  - `followup` with state `none` clears `followUp`. Any other state sets it. `streaming_start` clears it.
  - `question_needed` and `plan_review_needed` set `awaitingQuestion`. `question_answered`, `plan_review_answered`, `streaming_start` and `cleared` clear it.
  - The reducer stays pure. Scheduled-wait expiry is a client concern; clients compare `since + resumeInSeconds` with the clock.

- [ ] **Step 1: Write the failing tests.**
  - `done with background wait sets waiting and ends streaming`
  - `stale done with wait is ignored`
  - `streaming_start clears waiting and followUp`
  - `followup none clears followUp`
  - `question_needed then question_answered toggles awaitingQuestion`
  - `waiting survives compaction` (via `ChatLogStore` with `compactAfter: 1`)
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/chat`. Expect FAIL.
- [ ] **Step 3: Implement**, then regenerate the golden snapshots. In `claude-background-wait` the final state must still show the resumed turn closed. The golden test's "waiting has streaming false" assertion is updated to also assert that `waiting` is set mid-file. Check by reasoning, and note it in the report.
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/chat tests/unit/chatlog`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(chat): waiting, follow-up and question state in the shared reducer`

---

### Task 2: v2 workspaces, chat-list push and app settings

**Files:**
- Create: `electron/services/remote/workspaceRegistry.ts`
- Modify: `chat-v2.ts`, `bridge-server.ts`, `electron/main.ts`, `electron/preload.ts`, `src/App.tsx` (push workspaces), `electron/services/remote/README.md`
- Test: `tests/unit/remote/chat-v2-workspaces.test.ts`, `tests/unit/remote/bridge-cors.test.ts`

**Interfaces:**
- **Renderer to main:** a new preload call, `remoteReportWorkspaces(list: RemoteWorkspace[])`.
  - App calls it whenever the workspace list or a status changes, debounced to 250ms. It uses the same `RemoteWorkspace` shape and status fields as `renderer-proxy.ts:3-20` and `App.tsx:633-661`.
  - `WorkspaceRegistry` holds the latest list and emits `changed`.
- **New v2 frames.** Client to desktop, with desktop replies carrying `v:2`:
  - `workspaces.subscribe{reqId}` replies with `workspaces.list.result{reqId, workspaces}`, then pushes `workspaces.changed{workspaces}` on every registry change. If the renderer hasn't reported yet, it falls back once to the existing proxied `workspaces.list`.
  - `chats.subscribe{reqId, projectPath}` replies with `chats.list.result{reqId, chats}`. It then pushes `chats.changed{projectPath, chats}` when any chat under that realpath'd project changes `title`, `updatedAt`, `openTurn`, `queued` or `headSeq`. Throttle per project to at most 1 per 500ms, trailing edge.
    - Add `onMetaChange(cb)` to `ChatLogStore`, or emit from the service.
    - Rebuild meta from the store: no per-delta pushes. Changes only to `headSeq` from pure deltas are throttled.
  - `chats.unsubscribe{projectPath}`.
  - `app.settings{reqId}` replies with `app.settings.result{reqId, settings}`, and pushes `app.settings.changed{settings}` when any listed key changes.
    - The keys are exactly: `theme`, `accent`, `highlightTheme`, `messageStampMode`, `toolCallsExpanded`, `tagMessagesWithTask`, `saiAnimationEnabled`, `autoCompactThreshold`.
    - Each value is read from the same settings store as `settings:get` (`main.ts:1085`). The reply also includes `remoteCeiling`, the current remote permission ceiling.
- **`bridge-server.ts`:** `POST /pair` and `GET /healthz` send `Access-Control-Allow-Origin: *`, plus `Allow-Methods: GET, POST, OPTIONS` and `Allow-Headers: content-type`. `OPTIONS` on those two paths answers 204. Every other path is unchanged.

- [ ] **Step 1: Write the failing tests.** Use the real `ChatLogStore`, `ChatLogService` and `BridgeServer` where the existing chat-v2 tests do.
  - `workspaces.subscribe returns the reported list and pushes changes`
  - `chats.changed pushes a phone-created chat` (a `send` command for a new chat id under the project leads to one push containing it)
  - `chats.changed is throttled during streaming deltas`
  - `chats.subscribe matches the project through a symlink`
  - `app.settings returns the listed keys and the remote ceiling only`
  - `OPTIONS /pair answers 204 with CORS headers`
  - `other paths have no CORS headers`
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/remote`. Expect FAIL.
- [ ] **Step 3: Implement.** Document every new frame in the README v2 section.
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/remote tests/unit/chatlog`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(remote): v2 workspaces, chat-list push and app settings`

---

### Task 3: v2 models, slash commands, files, background tasks and new commands

**Files:**
- Modify: `chat-v2.ts`, `electron/services/chatlog/commands.ts`, `providerDispatch.ts`, `electron/main.ts`, README
- Test: `tests/unit/remote/chat-v2-extras.test.ts`, `tests/unit/chatlog/commands.test.ts`

**Interfaces:**
- **`models.list{reqId, provider}`** replies with `models.list.result{reqId, provider, models}`.
  - It calls the same main handlers as `claude:models`, `codex:models`, `gemini:models` and `kimi:models`.
  - Extract each handler body into a function that both the IPC and v2 call.
  - The model shape is whatever that handler returns today.
- **`slash.list{reqId, projectPath, chatId}`** replies with `slash.list.result{reqId, commands}`. It uses the `claudeRefreshSlashCommands` main path; for any other provider it returns an empty list.
- **`file.read{reqId, kind: 'toolImage' | 'model', ref}`** replies with `file.read.result{reqId, dataUrl}` or `{reqId, error}`.
  - For `toolImage`, `ref` is the path stored in the chat. It must realpath inside `userData/tool-result-images`.
  - For `model`, `ref` is the `versionKey` read through the model cache (the `modelReadCached` path).
  - Cap: 25 MB, otherwise `error: 'too_large'`.
- **`chat.background`.** While a chat is subscribed, push `chat.background{chatId, tasks}` from the same source as the `claude:backgroundTasks` IPC, and send the latest tasks right after subscribe.
- **New `ChatCommand` kinds.** All are idempotent by `clientId`, and v2 accepts all of them.
  - `{kind:'clear', chatId}` appends `cleared`.
  - `{kind:'compact', chatId}` dispatches the same call as `claude:compact`, using the chat's settings. It returns an error for providers that don't support compaction.
  - `{kind:'clientEvent', chatId, ev}`: `ev.type` must be one of `local_note`, `watcher_snapshot`, or `user_message` with `local: true`, which is what `/help` writes. Anything else is rejected.
  - `{kind:'stopTask', chatId, taskId}` maps to `claudeStopTask`.
- **Rulings.**
  - `claudeAlwaysAllow` from the phone is NOT added. The phone sends a plain approve. Persistent permission grants stay desktop-only.
  - Sudo password replies are NOT added; passwords never cross the bridge.
  - Codex App Server prompts stay desktop-only, per R12.
  - File-mode `sai-render://` renders show an "open on desktop" note.
  - `sai_render_form`, `sai_confirm` and `sai_choose` answers stay desktop-only.

- [ ] **Step 1: Write the failing tests.**
  - `models.list returns each provider's list from the shared function`
  - `file.read refuses a path outside the tool image dir, including via a symlink`
  - `file.read returns a data URL for a stored tool image`
  - `clear command appends cleared once per clientId`
  - `clientEvent rejects backend event types`
  - `compact command dispatches for claude and errors for gemini`
  - `chat.background sends the latest tasks on subscribe and pushes changes`
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.** Document the frames and the rulings in the README.
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/remote tests/unit/chatlog`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(remote): v2 models, slash commands, files, background tasks and chat commands`

---

### Task 4: Touch scroll-follow and "load earlier" in the shared chat

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` (around `:1298-1311` and `:1476-1484`), `src/hooks/useChatLog.ts`, `src/lib/chat/types.ts` (`SaiChatLogApi.page?`)
- Test: `tests/unit/components/ChatPanel.scroll.test.tsx`, `tests/unit/hooks/useChatLog.paging.test.ts`

**Interfaces:**
- **Scroll-follow.** Today only a wheel-up event releases bottom-follow. Change it so `handleScroll` releases follow whenever `scrollTop` decreases by more than 4px from the last observed value while the user is interacting. That covers touch drag, trackpad momentum and keyboard. The programmatic tween and the ResizeObserver must not count as user scroll; use a `programmaticScroll` ref flag. Re-pin when the view returns to within the existing bottom threshold. Wheel behavior stays as it is.
- **Paging.**
  - The `SaiChatLogApi` result of `open` may carry `olderCount?: number`. Desktop main returns full state, so it's `0` or undefined there.
  - Optional `chatlog.page?(chatId, beforeIndex, limit) => Promise<{ messages: ChatMessage[]; olderCount: number }>`.
  - `useChatLog` exposes `olderCount` and `loadOlder(): Promise<void>`. That prepends the page to `state.messages`, shifts `turn.startIndex` by the number prepended, and is a no-op while a load is in flight. The cut and seq bookkeeping are unchanged.
  - ChatPanel shows a quiet "Load N earlier messages" row at the top when `olderCount > 0`, and keeps the scroll position stable when prepending.

- [ ] **Step 1: Write the failing tests.**
  - `touch scroll up releases follow` (simulate `scroll` events with a decreasing `scrollTop` during streaming; the next content growth must not move `scrollTop`)
  - `programmatic scroll does not release follow`
  - `wheel up still releases follow`
  - `prependOlder stitches pages in order and shifts turn.startIndex`
  - `loadOlder is a no-op while in flight`
  - `load earlier row is hidden when olderCount is 0`
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/components tests/unit/hooks`. Expect PASS.
- [ ] **Step 5: Commit.** `fix(chat): touch scrolling releases follow; load earlier messages`

---

### Task 5: Phone variants of the shared chat components

**Files:**
- Create: `src/lib/platform.ts`, `src/styles/phone.css`
- Modify: `ChatInput.tsx`, `MessageQueue.tsx`, `ChatPanel.tsx`, `ChatMessage.tsx`, `TodoProgress.tsx`, `LinkPreviewChip.tsx`, `RenderToolCard.css`
- Test: `tests/unit/components/phoneVariants.test.tsx`

**Interfaces:**
- `isPhone(): boolean` returns `document.documentElement.dataset.saiPhone === '1'`. It is read at render time, never cached at module scope.
- When `isPhone()` is true:
  - **Composer keys.** Enter inserts a newline, and only the send button sends (`ChatInput.tsx:844`). The Ctrl+Enter queue hint is hidden. The global keydown focus-steal (`:399-426`) is off.
  - **Empty state.** The empty-state keyboard hints (`ChatPanel.tsx:439-477`) are hidden.
  - **Queue actions.** Send-now, promote and remove are always visible, not hover-revealed (`MessageQueue.tsx:258-261`).
  - **Long-press.** Long-pressing a link opens the existing `LinkContextMenu`, using a 500ms timer cancelled by move or end, instead of the iOS callout.
  - **Image modal.** It closes on tap and allows native pinch zoom (`touch-action: pinch-zoom`).
  - **Attach button.** The composer's attach button opens `<input type="file" accept="image/*">`, which on iOS offers camera and library, instead of `selectFile()`. Each picked image is resized in a canvas to at most 2048px on its longest side and re-encoded as JPEG at quality 0.85. It then joins the composer's existing pending-images list, the same list a pasted image goes into.
- `phone.css` is imported by the mobile entry only, and every rule is scoped by `html[data-sai-phone]`. It covers:
  - side gutters at `12px`, not 15%;
  - dropdowns and popovers at `min-width: 0; max-width: calc(100vw - 24px)`;
  - `:hover` styles disabled with `@media (hover: none)`;
  - the composer padded by `env(safe-area-inset-bottom)`;
  - the transcript with `overscroll-behavior: contain`;
  - the body with `overscroll-behavior: none`;
  - 44px minimum hit targets on toolbar buttons;
  - no tap highlight.

- [ ] **Step 1: Write the failing tests.** Render with `data-sai-phone="1"` set, and without it as a control.
  - `phone: Enter inserts newline and send button sends`
  - `desktop: Enter still sends`
  - `phone: queue actions visible without hover`
  - `phone: keyboard hints hidden`
  - `phone: long-press link opens context menu`
  - `phone: attach picks an image and resizes it to 2048px max`
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/components`. Expect PASS, with no desktop regressions.
- [ ] **Step 5: Commit.** `feat(chat): phone variants for the shared chat components`

---

### Task 6: Mobile web build and Capacitor iOS shell

**Files:**
- Create:
  - `capacitor.config.ts`
  - `mobile/index.html`, `mobile/vite.config.ts`, `mobile/tsconfig.json`
  - `mobile/src/main.tsx` (placeholder app)
  - `mobile/ios/**`
  - `mobile/README.md`
- Modify: `package.json` (dependencies and scripts), `.gitignore`

**Interfaces:**
- **Dependencies** (pin the same 8.x line as `../duel-binder`):
  - `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` (dev)
  - `@capacitor/app`, `@capacitor/keyboard`, `@capacitor/status-bar`, `@capacitor/haptics`, `@capacitor/clipboard`, `@capacitor/browser`, `@capacitor/splash-screen`
  - `jsqr`
  - No `@capgo/capacitor-updater` in Part 2 (ruling below).
- **`capacitor.config.ts`:**
  - `appId: 'com.project96.sai'`, `appName: 'SAI'`, `webDir: 'dist/mobile'`
  - `ios: { path: 'mobile/ios', contentInset: 'never', scheme: 'capacitor' }`
  - `backgroundColor` matches the default theme's `--surface-0`
  - `plugins.Keyboard: { resize: 'native', resizeOnFullScreen: true }`
- **`mobile/vite.config.ts`:**
  - `root: 'mobile'`, `base: './'`, `outDir: '../dist/mobile'`, `publicDir: false`
  - React plus Tailwind exactly as `vite.config.ts` does for the renderer
  - `define: { __MOBILE__: true }`
  - A plugin that fails the build if `electron`, or `node:` built-ins other than types, are imported
- **`mobile/index.html`:**
  - Viewport `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`
  - `html data-sai-phone="1"`
- **Scripts:**
  - `"build:mobile": "vite build --config mobile/vite.config.ts"`
  - `"build:ios": "npm run build:mobile && cap sync ios"`
- **`mobile/ios`.** Generated with `npx cap add ios` (SPM) on Linux and committed. Copy the shape of `../duel-binder/ios/.gitignore`. In `Info.plist`, set:
  - `CFBundleShortVersionString=$(MARKETING_VERSION)`, `CFBundleVersion=$(CURRENT_PROJECT_VERSION)`
  - `ITSAppUsesNonExemptEncryption=false`
  - `NSCameraUsageDescription` ("SAI uses the camera to scan the pairing QR code shown on your desktop.")
  - `NSAppTransportSecurity`: `NSAllowsLocalNetworking` true, plus exception domain `ts.net` with `NSIncludesSubdomains` and `NSExceptionAllowsInsecureHTTPLoads`. Also `NSAllowsArbitraryLoads` true, because paired desktops can be reached by raw tailnet IP; the listing explains this.
  - `UIViewControllerBasedStatusBarAppearance=false`
  - Portrait plus landscape
- **`mobile/ios/App/App/KeychainPlugin.swift`.** A local Capacitor plugin `Keychain`, registered in the bridge the way duel-binder registers `StreamPlugin`. Methods: `get({key}) → {value|null}`, `set({key, value})`, `remove({key})`. It uses `kSecClassGenericPassword` with service `com.project96.sai.machines` and `kSecAttrAccessibleAfterFirstUnlock`.
- **Ruling:** live web-bundle updates (`@capgo/capacitor-updater`) move to Part 4 (App Store submission), where the shell is finalized for review. Part 2 ships through TestFlight builds only.

- [ ] **Step 1:** Add the deps and config. Write a `mobile/src/main.tsx` that renders "SAI".
- [ ] **Step 2: Run** `npm run build:mobile`. Expect `dist/mobile/index.html` with no electron imports. Then run `npx cap add ios` (first time), and after that `npx cap sync ios`. Expect `mobile/ios/App` with `CapApp-SPM/Package.swift` listing the plugins. Confirm the commands succeed on Linux; `xcodebuild` is skipped with a warning.
- [ ] **Step 3:** Edit the Info.plist and add the Keychain plugin. Commit `mobile/ios` without the generated `public/` or `capacitor.config.json`.
- [ ] **Step 4: Run** `npx tsc --noEmit -p mobile/tsconfig.json` and `npx vitest run --project unit` (sanity). Expect PASS.
- [ ] **Step 5: Commit.** `feat(mobile): Capacitor iOS shell and phone web build`

---

### Task 7: V2 client and the phone `window.sai` shim

**Files:**
- Create: `mobile/src/v2/client.ts`, `mobile/src/v2/saiShim.ts`, `mobile/src/v2/types.ts`
- Test:
  - `tests/unit/mobile/v2client.test.ts` (fake WebSocket)
  - `tests/unit/mobile/saiShim.test.ts`
  - `tests/integration/mobile/shim-bridge.test.ts` (real `BridgeServer`, `ChatLogService` and `ChatCommands` with the `ws` WebSocket, like `tests/integration/remote/chat-v2-end-to-end.test.ts`)

**Interfaces:**

```ts
export type ConnState = 'connecting' | 'open' | 'catching_up' | 'offline' | 'unpaired';
export class V2Client {
  constructor(opts: { url: string; token: string; WebSocketImpl?: typeof WebSocket; now?: () => number });
  connect(): void; close(): void;
  state: ConnState; onState(cb: (s: ConnState) => void): () => void;
  request<T>(frame: Record<string, unknown>, timeoutMs?: number): Promise<T>; // reqId-matched, rejects on timeout/close
  send(frame: Record<string, unknown>): void;                                    // queued while not open
  on(type: string, cb: (frame: any) => void): () => void;
  resume(): void; // foreground: probe with ping (5s), reconnect if dead
}
export function createSaiShim(client: V2Client, opts: { native: NativeApi; settings: () => Record<string, unknown> }): SaiBridge;
```

- **V2Client behavior,** taken from the PWA's `wire.ts` (heartbeat, backoff and probe values):
  - Sends `auth` first.
  - `auth_ok` sets state `open` and re-sends every active `chat.subscribe` (with each chat's current `after`), `chats.subscribe` and `workspaces.subscribe`.
  - A 4001 or 1008 close sets state `unpaired` and stops reconnecting.
  - Pings every 25s with a 10s dead timeout.
  - Reconnects with backoff from 1s to 30s, with ±20% jitter.
- **`chatlog` in the shim.**
  - `open(chatId, after)` sends `chat.subscribe`. It resolves with `{snapshot, entries, headSeq, meta: null, olderCount}` when `chat.entries` arrives. When a `chat.snapshot` precedes it, the snapshot's `olderCount` is passed through.
  - `onEvent` fans out `chat.entry` frames.
  - `command` sends `chat.command` and resolves on the matching `chat.ack`. Resends of an un-acked command after reconnect reuse the same clientId.
  - `page` sends `chat.page`.
  - `appendClient`: `cleared` becomes `command clear`, and `local_note`, `watcher_snapshot` and local `user_message` become `command clientEvent`. Anything else rejects.
  - `importMessages` resolves `'marked'`. `list` maps to `chats.subscribe` once, then the cache. `bindLegacyScope` and `delete` are no-ops.
  - State is `catching_up` from subscribe until the first `chat.entries` for the active chat.
- **Event re-emit.** `claudeOnMessage(cb)` re-emits each live `chat.entry`'s `ev` for its side-effect consumers (ready, session ids, slash commands, usage). The shim never fabricates events.
- **Other mappings.**
  - `settingsGet(key, def)` reads `opts.settings()`, which is fed by `app.settings`.
  - Model lists map to `models.list`, slash refresh to `slash.list`, `fsReadFileBase64` and `modelReadCached` to `file.read`, and `claudeStopTask` to `command stopTask`.
  - `claudeCompact` maps to `command compact`, and `claudeOnBackgroundTasks` to `chat.background`.
  - `openExternal` maps to the Browser plugin, `clipboardWrite` to the Clipboard plugin, and `clipboardReadImage` to `null`.
  - `claude|codex|gemini|kimiStart` resolve `{slashCommands: []}` immediately.
  - `saveImage` resolves `''`; the images ride on the command as data URLs.
- **Stubs.** Every other method `ChatPanel`'s subtree calls (the full list is in the Part 2 recon, Section 1) becomes a no-op stub returning the documented empty value. Examples: `devlog`, `loadGuard*` with `{enabled: false}`, `mcpRuntimeStatus`, `usage*`, `codexUsageFetch` with `null`, `jira/linearConfigured` with `false`, `githubApiGet` with `{ok: false, status: 0}`, `claudeSudoReply` (which also shows a toast, "Answer sudo prompts on the desktop"), and `setTitleBarOverlay`. A `Proxy` fallback logs and returns `undefined` for unknown names, so a new desktop call degrades rather than crashes.

- [ ] **Step 1: Write the failing tests.**
  - `auth then resubscribe all on reconnect with current after`
  - `4001 auth_failed surfaces as unpaired and stops reconnecting`
  - `heartbeat kills a silent socket and reconnects with backoff`
  - `request rejects on timeout`
  - `resend after reconnect reuses clientId` (the integration test asserts one user message)
  - `resume after socket drop catches up exactly` (integration: drop mid-stream, reconnect, and the reduced state deep-equals `store.state`)
  - `open pages older messages on demand` (integration: a 450-message chat; `open` returns `olderCount` 250; `page` returns them in order)
  - `appendClient cleared maps to clear command`
  - `unknown sai method returns undefined without throwing`
  - `claudeOnMessage re-emits live entry events`
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/mobile` and `npx vitest run --project integration tests/integration/mobile`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(mobile): v2 client and phone window.sai shim`

---

### Task 8: Machines and pairing

**Files:**
- Create: `mobile/src/machines/store.ts`, `pairing.ts`, `reachability.ts`, `PairScreen.tsx`, `MachineList.tsx`, `mobile/src/native.ts` (the `NativeApi` with web fallbacks)
- Test: `tests/unit/mobile/machines.test.ts`, `tests/unit/mobile/pairing.test.ts`

**Interfaces:**
- `Machine = { id: string; label: string; baseUrl: string; deviceId: string; addedAt: number }`.
  - The list lives in `localStorage['sai.machines.v1']`.
  - Tokens live only in the Keychain plugin under key `token:<machine.id>`. The web fallback, used in tests and the browser, is in-memory.
- `parsePairUrl(text): { baseUrl: string; code: string } | null` accepts `http(s)://host:port/?code=...` exactly as `RemoteSettings.tsx` mints it.
- `pair(url, deviceLabel): Promise<Machine>`:
  - posts `{code, deviceLabel, clientId}` to `${baseUrl}/pair`, where `clientId` is a stable per-install UUID;
  - stores the token;
  - dedupes by `baseUrl` (re-pairing replaces the token).
- `checkReachable(machine): Promise<boolean>` is `GET /healthz` with a 3s timeout.
- **PairScreen.** Camera QR scanning uses `getUserMedia` and `jsqr` on a canvas at 10fps, stopping on the first valid pair URL. There is also a paste field and a device label, defaulting to "iPhone". Errors are shown inline: "code expired", "can't reach desktop — is Tailscale on?".
- **MachineList.** Shows the label, host and a reachability dot. Tapping a machine selects it. Swipe or a long-press menu offers Rename and Remove; Remove deletes the token.

- [ ] **Step 1: Write the failing tests.**
  - `parsePairUrl accepts the desktop QR url and rejects others`
  - `pair stores the token in the keychain, not localStorage`
  - `re-pair of the same baseUrl replaces the token`
  - `unreachable machine shows offline` (healthz times out)
  - `remove deletes the token`
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/mobile`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(mobile): machines and QR pairing`

---

### Task 9: Phone shell around the real ChatPanel

**Files:**
- Create: `mobile/src/shell/App.tsx`, `Drawer.tsx`, `Header.tsx`, `ChatHost.tsx`, `lifecycle.ts`, `Toasts.tsx`
- Modify: `mobile/src/main.tsx`
- Test: `tests/unit/mobile/ChatHost.test.tsx`, `tests/e2e-mobile/chat.spec.ts`, plus a Playwright project for `tests/e2e-mobile` (a Vite preview of `dist/mobile` on port 5174, with a node fake-desktop server that wraps the real `BridgeServer`, `ChatLogService` and `ChatCommands` with scripted provider dispatch)

**Interfaces:**
- **`main.tsx`** runs these in order:
  - set `data-sai-phone`;
  - install the shim on `window.sai`;
  - import `globals.css`, the fonts and `phone.css`;
  - call `bootstrapAppearance()`;
  - then `import('./shell/App')`.
- **Shell layout** (spec sketch):
  - **Header:** a ☰ button, `<workspace> · <chat title>`, a status dot (streaming / waiting / approval / done, from the chat list plus `ChatState`) and a ⋯ menu (New chat, Machines).
  - **Drawer:** machines, then workspaces (`workspaces.subscribe`), then chats (`chats.subscribe`, newest first, with status), then "+ New chat".
  - **New chat** generates the chat id the way the desktop does (`crypto.randomUUID()`) and opens an empty `ChatHost`. The first `send` creates the log with that `projectPath`.
- **ChatHost** mounts the real `ChatPanel`.
  - Pass `key={chatId}`, `projectPath`, `claudeScope={chatId}` and `sessionId={chatId}`.
  - Provider, model, effort and permission come from the chat's `state.settings`, falling back to desktop defaults from `app.settings`. Models come from `models.list`.
  - Pass `isStreaming={state.turn.streaming}` and derive `waiting`, `followUp` and `awaitingQuestion` from the Task 1 state.
  - Pass `liveBackgroundTaskCount` and `backgroundTasks` from `chat.background`.
  - Pass `renderToolCall` exactly as `App.tsx:3237-3255` does. Extract that lambda into a shared `src/components/Chat/renderToolCallFor.tsx` used by both App and ChatHost.
  - All other props are no-op handlers or defaults.
- **Lifecycle.** `@capacitor/app` `appStateChange` with `isActive: true` calls `client.resume()`. While the connection state is `catching_up`, a quiet "Catching up…" pill shows under the header. Never show a blank chat: keep rendering the last state until the new one arrives.
- **Theme.** `app.settings` and `app.settings.changed` drive `applyTheme`, the accent and the highlight theme through the shim's `settingsGet` cache. The status bar style follows the theme.
- **Toasts.** Listen for the `sai-chat-error` window event and show the message. "Can't reach <machine>" shows when the state is `offline` for more than 5s. `unpaired` shows "Re-pair <machine>" with a button that opens PairScreen.

- [ ] **Step 1: Write the failing tests.**
  - `ChatHost renders log messages through the real ChatPanel`
  - `waiting state shows the waiting row`
  - `send from the composer issues one chat.command`
  - `foreground resubscribes from lastSeq` (simulate `appStateChange`)
  - Playwright `tests/e2e-mobile/chat.spec.ts` at an iPhone 15 viewport:
    - `pair, open workspace, send, stream, stop`
    - `phone-created chat appears in the list`
    - `composer stays above the keyboard` (set `visualViewport` height)
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/mobile` and `npm run build:mobile && npx playwright test --config playwright.mobile.config.ts`. Expect PASS. Attach screenshots of the chat and the drawer to the report.
- [ ] **Step 5: Commit.** `feat(mobile): phone shell around the shared chat`

---

### Task 10: iOS CI to TestFlight

**Files:**
- Create: `.github/workflows/ios.yml`
- Modify: `.github/workflows/test.yml` (add `npm run build:mobile` and the mobile tests), `mobile/README.md`, `package.json` (`"mobileVersion": "0.1.0"`)

**Interfaces:**
- **`ios.yml`.** Start from `../duel-binder/.github/workflows/ios.yml`, with otto's tag and version handling (`../otto/.github/workflows/ios.yml`). Settings:
  - Triggers: `push.tags: ['mobile-v*']`; `pull_request.paths` covering `mobile/**`, `capacitor.config.ts`, `src/components/Chat/**`, `src/lib/chat/**`, `src/styles/**` and `.github/workflows/ios.yml`; `workflow_dispatch` with input `upload` (default true).
  - Runner and limits: `runs-on: macos-26`, `timeout-minutes: 60`. Concurrency group `ios-${{ github.ref }}`, with cancel-in-progress for PRs.
  - Setup: Node 22 with npm cache, `npm ci --ignore-scripts`, `npm run build:ios`.
  - Version: from `${GITHUB_REF_NAME#mobile-v}`, falling back to `package.json` `mobileVersion`, and it must match `^[0-9]+\.[0-9]+\.[0-9]+$`. The build number is `$(( $(date +%s) / 60 ))`.
  - Signing check, exactly as duel-binder does: if `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY` and `APPLE_TEAM_ID` are all set and this isn't a PR, archive unsigned and then export with `method: app-store-connect`, `destination: upload` and `signingStyle: automatic`, using `-allowProvisioningUpdates` and the API-key flags. Write the key with `umask 077`, and remove it afterwards. Otherwise build for the simulator with `CODE_SIGNING_ALLOWED=NO`, warning when secrets are missing on a tag.
  - Project: `-project mobile/ios/App/App.xcodeproj -scheme App`.
  - Summary line in `$GITHUB_STEP_SUMMARY`.
- **`mobile/README.md`** covers:
  - build and test on Linux;
  - the release, which is to tag `mobile-v<x.y.z>`;
  - the required secrets;
  - the one-time App Store Connect setup (app record for `com.project96.sai`, TestFlight internal group).

- [ ] **Step 1:** Write the workflow. Check it locally with `npx --yes action-validator .github/workflows/ios.yml`, or with `actionlint` if available.
- [ ] **Step 2:** Push the branch and open a PR. That triggers the simulator build. Expect the `ios` job to compile on `macos-26`. Fix the compile errors this surfaces, such as Swift plugin registration or SPM resolution, in this task.
- [ ] **Step 3: Commit.** `ci(mobile): iOS simulator build on PRs and TestFlight on mobile tags`

---

## After this plan

1. Merge to `main` once the branch suite, the mobile e2e tests and the PR simulator build are green.
2. Desktop release `/release minor`, because the v2 frames need the new desktop.
3. With the App Store Connect secrets set on `darkharasho/sai` and the app record created, tag `mobile-v0.1.0` and watch `ios.yml` upload to TestFlight.
4. Part 3 (push relay), Part 4 (App Store submission: demo machine, privacy, live updates) and Part 5 (terminal, files and git, then delete the PWA and Expo app) each get their own plan.
