# Mobile Remote — Roadmap

Status: roadmap (not a per-feature spec). Each phase below gets its own design spec + implementation plan before code lands.

## Goal

Port Otto's iPhone/mobile-remote pattern to SAI, scaled up to a near-full editor mirror (chat, files, terminal, git, settings, workspace switcher, code editing). Tailscale-private PWA → Electron host. No public exposure. QR pairing.

Reference learnings: `../../../otto/docs/superpowers/notes/2026-05-25-mobile-remote-learnings.md`.

Swarm is explicitly out of scope for v1.

## Architecture (one-line)

```
phone PWA (Tailscale)  ⇄  WS+HTTP  ⇄  Electron main (BridgeServer + SessionBus + RemoteModule)  →  existing SAI surfaces (unchanged emitters, fan-out wrapper added)
```

The PWA is a second Vite entry (`src/renderer-remote/`) bundled with the Electron app and served by the bridge from `out/renderer-remote/` with SPA fallback.

## Decisions locked in from Otto's learnings

1. **Tailscale-only bind.** Bridge refuses to start without a tailnet IP. No LAN/public fallback.
2. **Stable port `17829`** at the production call site; class default is ephemeral (avoids vitest worker contention).
3. **QR uses `http://` URLs, not custom schemes.** iOS Camera + Safari + auto-pair from `?code=`.
4. **Argon2id-hashed bearer tokens** in SQLite. Single-use pairing code, 120s TTL.
5. **`SessionBus.subscribeAll` from day one.** Never subscribe to `activeSessionId()` at WS-auth time.
6. **Input is direct callbacks, not bus-routed.** Bus is output-only.
7. **Emit `user-message` events from the agent layer from day one.** Both surfaces dedupe optimistic UI.
8. **Auto-attach to unknown sessionIds** when events arrive on the desktop renderer.
9. **`origin: 'remote'` threaded end-to-end** for autonomy clamping (Otto deferred this; we won't).
10. **Signed single-use URLs with a nonce** for any binary payload. Never inline bytes in WS frames.
11. **Hybrid renderer pattern** via standalone `vite.config.pwa.ts` invoked from the main build script.
12. **`RemoteModule` supervisor** polls tailnet IP every 60s, one-shot retry on crash, exposes `running/url/reason` to the settings UI.

## Must-have surfaces (locked)

- Chat (sessions, streaming, approvals, tool cards, queued prompts)
- Files: read + write (Monaco on touch — deferred to last phase)
- Terminal
- Git (per-repo + meta-workspace fan-out)
- Workspace switcher (incl. meta workspaces)
- Settings (provider/model/effort/approval mode, pairing management)

## Explicit non-goals (v1)

- Swarm dashboard, "land all green" from phone
- Push notifications (iOS PWA limitation; acceptable since desktop is source of truth)
- Public-internet exposure (Cloudflare/ngrok tunnels)
- Multi-tenant auth (single user / small team only)
- Android-specific tuning beyond what falls out of the PWA

## Phases

Each phase below is a **placeholder for a future design spec**. Naming convention: `docs/superpowers/specs/YYYY-MM-DD-mobile-remote-p<N>-<topic>-design.md`.

### Phase 0 — Foundation (the Otto port, minus chat)

Bridge, auth, supervisor, PWA shell. PWA shows only a "paired ✓" status screen. No app surfaces yet.

Scope:
- `BridgeServer` (HTTP + WS, tailnet-only bind, stable port 17829)
- `PairingStore` (argon2id, SQLite, single-use pair code, revocable bearer)
- `screenshot-urls` HMAC signer with nonce (built now, used later)
- Generic `SessionBus` with `subscribeAll` + per-topic subscribe
- `RemoteModule` supervisor (tailnet IP poll, one-shot retry, status surface)
- `src/renderer-remote/` Vite entry, Tailwind config extension, tsconfig include
- `vite.config.pwa.ts` standalone PWA build
- Desktop Settings → "Mobile Remote" section: enable toggle, pairings list, QR generator, revoke, status (`running/url/reason`)
- Node-level end-to-end test: pair → auth → live no-op event → reconnect
- Manual smoke checklist file in `docs/superpowers/notes/`

Exit criteria: phone scans QR, pairs, connects over Tailscale, stays paired across desktop restart (stable port verified), revoke from desktop kicks the device.

### Phase 1 — Chat + approvals

The value driver. Mirrors Otto's chat surface but with SAI's per-workspace session model.

Scope:
- WS protocol: `subscribe { topic }` (explicit, not implicit "active session")
- Event types: `session.list`, `session.history`, `text.delta`, `tool.call.start`, `tool.call.result`, `approval.request`, `approval.resolve`, `user.message`, `done`, `error`
- Desktop wrapper around SAI's existing chat event emit; emits `user-message` events from the SAI agent layer
- `attachSession` on desktop renderer auto-attaches to unknown sessionIds (with buffer-until-attached)
- Inbound from phone: `sendPrompt(text, origin: 'remote', workspaceId, sessionId?)`, `interruptTurn`, `resolveApproval`
- Autonomy clamping: `clamp(desktopMode, remoteCeiling)` evaluated in the broker when `origin === 'remote'`; threaded through `SessionManager.send` → sdk-client → broker
- PWA chat surface: session drawer, transcript, streaming text, tool cards (collapsible, default collapsed), markdown rendering with `MD_COMPONENTS` map, 30s prompt watchdog
- Queued prompts UI (SAI-specific — Otto didn't have a queue)
- Approval banner mirrored from desktop

Exit criteria: phone-initiated prompt completes a full turn including a tool approval, with autonomy clamp visible in the audit; both surfaces stay in sync; reconnect mid-stream replays missed frames from the ring buffer.

### Phase 2 — Workspace switcher + Settings

Builds on Phase 1's session attach. Lets the phone change which workspace/meta-workspace it's attached to and adjust provider/model/effort/approval.

Scope:
- WS event: `workspace.list`, `workspace.set`
- Workspace switcher UI on phone (incl. meta workspaces with member-repo chips)
- Settings UI on phone: provider, model, effort, approval mode (subject to remote ceiling)
- Pairing management from phone (revoke other devices)

Exit criteria: switching workspaces on phone updates desktop activeWorkspace; settings changes on phone apply (after autonomy ceiling enforcement).

### Phase 3 — Files (read-only)

Browse + view + diff. No editing yet — that's Phase 6.

Scope:
- WS protocol: `files.list { path }`, `files.read { path }`, `files.diff { path }`
- Per-repo chips for meta workspaces
- Lazy tree fetch
- Syntax-highlighted read-only viewer (lightweight — not Monaco)
- Diff viewer (reuse same component pattern as desktop diff)
- Signed single-use URLs for any blob payloads larger than ~64KB

Exit criteria: full repo browse + diff view from phone; meta-workspace per-repo chips correct.

### Phase 4 — Git panel

Per-repo stage/unstage/commit/push/pull, meta-workspace fan-out.

Scope:
- WS protocol: `git.status`, `git.stage`, `git.unstage`, `git.commit`, `git.push`, `git.pull`, `git.log`
- Per-repo controls; meta-workspace fan-out actions
- Reuses Phase 3 diff viewer for staged/unstaged diffs
- Autonomy clamping still applies (e.g., `push` may be gated)

Exit criteria: full commit-and-push round trip from phone on both single-repo and meta workspaces.

### Phase 5 — Terminal

xterm.js inside the PWA, WS transport for stdin/stdout.

Scope:
- WS protocol: `terminal.open`, `terminal.input`, `terminal.output`, `terminal.resize`, `terminal.close`
- Reuse SAI's existing PTY service on the main side
- Mobile-friendly toolbar (Tab, Esc, Ctrl, Alt, arrows, common commands)
- Soft-keyboard autocorrect/caps off
- Resize on viewport/keyboard show/hide

Exit criteria: typical commands runnable from phone (git, npm, tail logs); ANSI rendering correct; large output doesn't lock the PWA.

### Phase 6 — Code editing (Monaco on touch)

The hardest UX piece. Last on purpose so we learn from earlier phases first.

Scope:
- Touch-optimized Monaco chrome (font size, gutter, breadcrumbs, soft-tab UX)
- Save flow + dirty state + conflict resolution (desktop may also be editing)
- Find/replace, go-to-line, simple multi-cursor via long-press
- Reuse Phase 3's file fetch + new `files.write` WS event
- Autonomy clamping for writes still applies

Exit criteria: edit + save a file from phone, desktop sees the change live, conflict resolution works when both sides edit.

## Dependencies

```
P0 → P1 → P2
       ↘    ↘
        P3 → P4
        P3 → P6
P0 → P5 (independent of P3-6)
```

P0 blocks everything. P1 blocks P2 (autonomy clamping needs a chat to validate end-to-end). P3 blocks P4 (diff viewer reuse) and P6 (file fetch reuse). P5 is independent and could be slotted any time after P0.

## Testing strategy (per Otto)

- Unit/integration coverage at vitest level for every server-side module
- One Node-level end-to-end per phase exercising the wire protocol with real `ws` + `fetch`
- Skip browser E2E unless catching CSS/SW/install regressions
- Manual smoke checklist per phase, walked on real hardware before release

## Open questions to resolve in each phase's design spec

- **P0**: which SQLite database holds pairings (existing chatDb/swarmDb vs. new), exact settings UI placement, exact format for QR encoding (URL params vs. fragment)
- **P1**: SAI's event emit shape inside `chatDb.ts` / `sessions.ts` — confirm a clean wrap point exists before designing the fan-out
- **P1**: how queued prompts interact with `origin: 'remote'` (does a remote prompt jump the queue or wait?)
- **P2**: whether meta-workspace switching is atomic or per-repo
- **P3**: handling of binary files (images, etc.) in the read viewer
- **P4**: how git operations interact with autonomy clamping (e.g., remote ceiling = strict means no push?)
- **P5**: PTY discovery — one terminal per session? per workspace? phone picks?
- **P6**: conflict resolution UX when both desktop and phone edit the same file

## The single most important lesson (from Otto)

> The wire is easier than the integration. Every bug Otto shipped came from the boundary between the new remote module and the existing app. Plan for that boundary first; the wire follows.

For SAI specifically, the boundary surface is **bigger** (more existing systems to wrap) so the per-phase spec must explicitly map the wrap point in the existing SAI code before any wire protocol is written.
