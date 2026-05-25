# Mobile Remote — Phase 1: Chat + Approvals Design

Status: design spec. Implementation plan follows.

Parent roadmap: `2026-05-25-mobile-remote-roadmap.md`.
Phase 0 foundation: `2026-05-25-mobile-remote-p0-foundation-design.md` (shipped, merged to main).
Reference port: Otto's chat surface in `../../../otto/src/renderer-remote/`.

## Scope

Phase 1 builds the chat surface on top of the Phase 0 bridge:

- Phone connects to a Claude chat session in any workspace open on the desktop
- Streams assistant messages, tool calls, and approval prompts in real time
- Phone can send prompts, approve/deny tool calls, and interrupt the active turn
- Phone can browse and switch chat sessions independently, or follow whatever the desktop has active
- Autonomy clamping (`origin: 'remote'`) is threaded end-to-end from day one — no deferred work

Phase 1 is **Claude only**. Codex and Gemini reuse the same wrap pattern in a later phase if needed.

## Goals

1. A user holding their phone sees the same chat output the desktop sees, with <500ms perceived latency between desktop renderer and phone for streaming text.
2. A prompt sent from the phone produces an assistant turn on both surfaces; user messages dedupe correctly so neither surface shows duplicate bubbles.
3. A tool approval prompt appears on both surfaces; whichever surface resolves first wins, the other dismisses cleanly.
4. Switching workspace+session on the desktop pushes a new attachment to the phone (when in "follow" mode); the phone can also detach and pick any session independently.
5. Remote-originated prompts can be clamped to a stricter approval mode than the desktop's default.

## Non-goals

- Codex / Gemini providers (separate later phase)
- File browser, terminal, git surfaces (Phases 3-5 per roadmap)
- Queued-prompts UI mirroring (optimistic echo only)
- Cross-device session sync (phone reads via renderer-proxy IPC; the desktop's IndexedDB remains the source of truth)
- Push notifications (iOS PWA limitation; phone only updates while WS is open)

## Architecture

```
phone (PWA chat)
   ⇄ WS frames
electron/services/remote/bridge-server.ts
   ├─ subscribes SessionBus → forwards events to attached devices
   ├─ inbound: prompt / approval / interrupt / session.attach / session.list / session.follow / session.new
   ├─ RendererProxy: IPC bridge to renderer for IndexedDB-backed history & session list
   └─ injected callbacks: sendPrompt, resolveApproval, interruptTurn

electron/services/claude.ts
   └─ one-line addition: bus.publish('chat:<projectPath>:<scope>', msg) after existing safeSend
   └─ NEW: emit 'user_message' event on every accepted prompt
   └─ exports sendImpl/approveImpl/interruptImpl pulled out of IPC handlers
       (IPC handlers remain; bridge calls the impls directly)

electron/main.ts
   └─ injects `bus` into claude.ts at startup
   └─ constructs RendererProxy bound to mainWindow
   └─ extends existing BridgeServer construction with the new opts

src/App.tsx (renderer)
   └─ on setActiveSession: window.sai.remoteSetActiveSession({...}) → broadcasts session.active
   └─ on mount: subscribes to remote:proxy:request, services from chatDb

src/renderer-remote/ (PWA)
   ├─ Chat.tsx, Transcript.tsx, Composer.tsx, Approval.tsx, ToolCard.tsx, SessionDrawer.tsx
   ├─ wire.ts extended with attach/listSessions/sendPrompt/approve/interrupt helpers
   └─ App.tsx routes to <Chat /> after auth_ok (Status becomes a "disconnected" fallback)
```

## Wire protocol

All frames JSON. Server frames carry `v: 1`. Server fan-out frames carry `topic`. Server pushes/replies carry the `type` they describe.

### Client → Server

```jsonc
// Attach to a chat topic. Phone may have at most one active subscription at a time.
{ "type": "session.attach", "projectPath": "/path/to/repo", "scope": "chat", "sessionId": "uuid" }

// Follow-mode toggle. When enabled, server pushes session.active frames.
{ "type": "session.follow", "enabled": true }

// List sessions for a workspace (proxied to renderer's chatDb).
{ "type": "sessions.list", "projectPath": "...", "reqId": "<client-uuid>" }

// Create a new session and attach to it.
{ "type": "session.new", "projectPath": "...", "scope": "chat" }

// Send a user prompt; bridge calls sendImpl with origin='remote'.
{ "type": "prompt", "text": "...", "projectPath": "...", "scope": "chat",
  "model": "...?", "effort": "...?", "permMode": "...?" }

// Approve/deny a tool call.
{ "type": "approval", "toolUseId": "...", "decision": "approve" | "deny",
  "modifiedCommand": "...?", "projectPath": "...", "scope": "chat" }

// Stop the in-flight turn for the attached session.
{ "type": "interrupt", "projectPath": "...", "scope": "chat" }

// (from P0) heartbeat
{ "type": "ping" }
```

### Server → Client

```jsonc
// Fan-out from SessionBus — claude.ts payload passes through verbatim with topic prepended.
{ "v": 1, "topic": "chat:<projectPath>:<scope>", "type": "assistant", /* ...payload... */ }
{ "v": 1, "topic": "...", "type": "result", /* ... */ }
{ "v": 1, "topic": "...", "type": "approval_needed", "toolUseId": "...", /* ... */ }
{ "v": 1, "topic": "...", "type": "question_needed", /* ... */ }
{ "v": 1, "topic": "...", "type": "streaming_start", "turnSeq": 17 }
{ "v": 1, "topic": "...", "type": "session_id", "sessionId": "..." }
{ "v": 1, "topic": "...", "type": "done" }
{ "v": 1, "topic": "...", "type": "error", "message": "..." }

// NEW: emitted by claude.ts on every accepted prompt. Both desktop and phone consume it
// (with origin-based dedup against optimistic input echoes).
{ "v": 1, "topic": "...", "type": "user_message", "text": "...", "origin": "remote" | "desktop", "turnSeq": 18 }

// Follow-mode push. Server tells the phone the desktop's active session changed.
{ "v": 1, "type": "session.active", "projectPath": "...", "scope": "chat", "sessionId": "..." }

// Reply to sessions.list.
{ "v": 1, "type": "sessions.list.result", "reqId": "...",
  "sessions": [{ "id": "...", "projectPath": "...", "title": "...", "updatedAt": 0, "kind": "chat" }, ...] }

// One-time history dump on session.attach.
{ "v": 1, "type": "session.history", "projectPath": "...", "scope": "chat", "sessionId": "...",
  "messages": [ /* ChatMessage[] from chatDb */ ] }

// Generic error reply (correlated when reqId is known).
{ "v": 1, "type": "error", "reqId": "...?", "code": "...", "message": "..." }
```

**Invariant**: server-side fan-out frames pass through `claude.ts`'s existing payload verbatim. The phone receives byte-identical events to the desktop renderer (with `topic` and `v` added). No translation layer to keep in sync.

## Main-process changes

### `electron/services/claude.ts`

Three additions:

1. **Inject a bus reference**. New module-level `let remoteBus: SessionBus | null = null` plus exported `setRemoteBus(bus)`. Called once from `main.ts` at startup.
2. **Publish after every safeSend**. Immediately after the existing `safeSend(win, 'claude:message', msg)` (around line 371):
   ```ts
   remoteBus?.publish(`chat:${projectPath}:${msg.scope ?? 'chat'}`, msg);
   ```
   Reads the same `msg` that goes to the renderer. No translation.
3. **Emit `user_message` events**. Inside `sendImpl` (see #4 below), right after writing the prompt to stdin, emit:
   ```ts
   const userMsg = { type: 'user_message', projectPath, scope, text: message, origin, turnSeq };
   safeSend(win, 'claude:message', userMsg);
   remoteBus?.publish(topic, userMsg);
   ```
   The desktop renderer must dedup this against its existing optimistic user-bubble add (match on `text + turnSeq` or similar).

### `electron/services/claude.ts` — exported impls

Extract from the existing IPC handlers (not delete them):

```ts
export function sendImpl(projectPath, message, imagePaths?, permMode?, effort?, model?, scope?,
                         origin: 'desktop' | 'remote' = 'desktop'): void { /* current body */ }
export async function approveImpl(projectPath, toolUseId, approved, modifiedCommand?, scope?): Promise<void> { /* current body */ }
export function interruptImpl(projectPath, scope?): void { /* current body */ }

// existing IPC handlers stay; their bodies become one-liners:
ipcMain.on('claude:send', (_e, ...args) => sendImpl(...args /* origin defaults to desktop */));
ipcMain.handle('claude:approve', (_e, ...args) => approveImpl(...args));
ipcMain.send('claude:stop', (_e, ...args) => interruptImpl(...args));
```

`sendImpl` applies autonomy clamping when `origin === 'remote'` (see [Autonomy clamping](#autonomy-clamping)).

`approveImpl` MUST be idempotent on already-resolved `toolUseId` (returns silently). Verify the existing implementation; add a guard if missing.

### `electron/services/remote/renderer-proxy.ts` (new, ~80 LOC)

Bridges main → renderer IPC for IndexedDB-backed data:

```ts
export interface RendererProxyOpts {
  getWindow: () => BrowserWindow | null;
  timeoutMs?: number; // default 5000
}

export class RendererProxy {
  constructor(opts: RendererProxyOpts) { ... }
  listSessions(projectPath: string): Promise<SessionMeta[]>;
  loadHistory(sessionId: string): Promise<ChatMessage[]>;
  // accepts ipcMain replies via attachReplyHandler() called once at startup
  attachReplyHandler(ipcMain: IpcMain): void;
}
```

Wire: each request is sent via `mainWindow.webContents.send('remote:proxy:request', { reqId, kind, args })`. The renderer responds via `ipcRenderer.invoke('remote:proxy:reply', { reqId, result, error })`. The proxy holds a `Map<reqId, { resolve, reject, timer }>`; replies resolve their corresponding promise; timeout rejects. If the renderer is destroyed mid-request, rejects with a clear error.

### `electron/services/remote/bridge-server.ts` — Phase 1 routing

Extend `BridgeServerOpts` with optional callbacks:

```ts
interface BridgeServerOpts {
  /* P0 fields unchanged */
  sendPrompt?: (args: PromptArgs) => void;
  resolveApproval?: (args: ApprovalArgs) => Promise<void>;
  interruptTurn?: (projectPath: string, scope: string) => void;
  listSessions?: (projectPath: string) => Promise<SessionMeta[]>;
  loadHistory?: (sessionId: string) => Promise<ChatMessage[]>;
  // Broadcast on session.active. Returns a function the renderer can call.
  registerActiveSessionBroadcast?: (broadcast: (payload: SessionActivePayload) => void) => void;
}
```

In `handleWs`, after `auth_ok`, track per-socket state:

```ts
interface DeviceState {
  attachedTopic: string | null;     // 'chat:<path>:<scope>' or null
  followEnabled: boolean;
  // ...
}
```

`subscribeAll` callback gates events:
```ts
unsub = this.opts.bus.subscribeAll((topic, e) => {
  if (state.attachedTopic !== topic) return;
  try { ws.send(JSON.stringify({ v: 1, topic, ...e })); } catch { /* ws may be closed */ }
});
```

Each new client→server message has a one-method handler that calls into the injected callback and sends a reply where appropriate.

### `electron/main.ts`

After `getOrInitRemote` initializes `bus`, `pairing`, etc., add:

```ts
import { setRemoteBus, sendImpl, approveImpl, interruptImpl } from './services/claude';
import { RendererProxy } from './services/remote/renderer-proxy';

setRemoteBus(bus!);

const rendererProxy = new RendererProxy({ getWindow: () => mainWindow });
rendererProxy.attachReplyHandler(ipcMain);

// Bridge gets the new callbacks
makeBridge: (tailnetIp) => new BridgeServer({
  // ...P0 fields...
  sendPrompt: (args) => sendImpl(
    args.projectPath, args.text, undefined,
    args.permMode, args.effort, args.model,
    args.scope, /* origin */ 'remote'
  ),
  resolveApproval: (args) => approveImpl(
    args.projectPath, args.toolUseId, args.decision === 'approve',
    args.modifiedCommand, args.scope
  ),
  interruptTurn: (path, scope) => interruptImpl(path, scope),
  listSessions: (path) => rendererProxy.listSessions(path),
  loadHistory: (sid) => rendererProxy.loadHistory(sid),
  registerActiveSessionBroadcast: (broadcast) => {
    ipcMain.handle('remote:setActiveSession', (_e, payload) => broadcast(payload));
  },
})
```

## Renderer-process changes

### `src/App.tsx`

1. **Emit active-session changes**. Wherever the renderer currently calls into state to set the active session (per the explore findings — a single function in App.tsx or a related state slice), add:
   ```ts
   window.sai.remoteSetActiveSession?.({
     projectPath: session.projectPath,
     scope: session.scope ?? 'chat',
     sessionId: session.id,
   });
   ```
   This is fire-and-forget; the IPC always succeeds even if the bridge is off (the main handler is a no-op when no follower is registered).

2. **Subscribe to renderer-proxy requests** (once, on mount):
   ```ts
   useEffect(() => {
     const off = window.sai.remoteOnProxyRequest?.(async ({ reqId, kind, args }) => {
       let result, error;
       try {
         if (kind === 'listSessions') result = await chatDb.listSessions(args.projectPath);
         else if (kind === 'loadHistory') result = await chatDb.loadMessages(args.sessionId);
         else throw new Error(`unknown kind: ${kind}`);
       } catch (e) { error = (e as Error).message; }
       window.sai.remoteSendProxyReply?.({ reqId, result, error });
     });
     return () => off?.();
   }, []);
   ```

### `electron/preload.ts` — new exposures

```ts
remote: {
  // ...P0 fields...
  setActiveSession: (payload) => ipcRenderer.invoke('remote:setActiveSession', payload),
  onProxyRequest: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('remote:proxy:request', listener);
    return () => ipcRenderer.removeListener('remote:proxy:request', listener);
  },
  sendProxyReply: (payload) => ipcRenderer.invoke('remote:proxy:reply', payload),
}
```

### `src/components/Chat` — dedup against `user_message`

When the desktop's optimistic user bubble is added (existing behavior), tag it with `pendingUserMessage: true`. When the matching `user_message` event arrives (same `text + turnSeq + projectPath`), replace the optimistic bubble in place. Don't delete and re-add — preserves scroll position and any animations in flight.

## PWA changes

New files under `src/renderer-remote/chat/`:

- `Chat.tsx` — transcript + composer + approval banner shell. Subscribes to the WireClient, dispatches frames to children.
- `Transcript.tsx` — renders user/assistant/tool-card messages. Uses a small `MD_COMPONENTS` map for markdown (no `@tailwindcss/typography` dep). Auto-scrolls to bottom unless user has scrolled away (sticky bottom).
- `Composer.tsx` — textarea + send + interrupt button. Plain Enter sends; Shift+Enter inserts newline.
- `Approval.tsx` — banner with allow/deny/edit-command options. One-tap commit.
- `ToolCard.tsx` — collapsed by default (just name + status). Tap to expand input/result JSON.
- `SessionDrawer.tsx` — hamburger drawer top-left. Workspaces collapsible list → sessions per workspace. "Follow desktop" toggle at the top. Tap a session to attach.

`App.tsx` after `auth_ok` mounts `<Chat />` (currently `<Status />`). `Status` becomes a fallback for disconnected/error states.

`wire.ts` extended with typed helpers:
```ts
client.attach({ projectPath, scope, sessionId });
client.listSessions(projectPath); // returns Promise via reqId correlation
client.sendPrompt({ text, projectPath, scope, ... });
client.approve({ toolUseId, decision, ... });
client.interrupt({ projectPath, scope });
client.setFollow(enabled);
```

State management: local React state in `<Chat />`. No Redux/Zustand — Phase 1's complexity is well-bounded.

## Autonomy clamping

Add a single setting `remoteCeiling: 'auto' | 'auto-read' | 'always-ask' | null` to the existing settings store (default `'always-ask'` for safety; null = no clamp).

Order from most permissive to least: `'auto' > 'auto-read' > 'always-ask'`.

In `sendImpl`:
```ts
let effectivePermMode = permMode;
if (origin === 'remote' && remoteCeiling != null) {
  effectivePermMode = clamp(permMode, remoteCeiling); // returns the stricter of the two
}
```

UI: added to `RemoteSettings.tsx` as a select. When `null` shows "No clamp (use desktop setting)".

`clamp(a, b)` is a tiny pure function in `electron/services/remote/clamp.ts` with full unit-test coverage of the truth table.

## Approval flow detail

First-resolver-wins:

1. CLI denies a tool → `approval_needed` event flows from `claude.ts` to both desktop renderer (via `claude:message`) and phone (via SessionBus → bridge → WS).
2. Both surfaces show the approval banner.
3. Whichever surface resolves first calls `approveImpl(projectPath, toolUseId, ...)`. The other tap calls the same function with the same `toolUseId`; the existing implementation must be idempotent (or get a guard). Verify in implementation.
4. Once `approveImpl` runs, claude.ts proceeds and emits subsequent events. Both surfaces dismiss their banners on the next event for that `toolUseId`.

Edge case: race where both surfaces tap nearly simultaneously with different decisions (one approve, one deny). The first decision wins; the second is dropped silently. This is acceptable single-user behavior. If we ever need conflict UX, it goes in a later phase.

## Testing strategy

### Unit (`tests/unit/remote/`)

- `clamp.test.ts` — truth table for `clamp(desktop, ceiling)` across all four states each (16 cases).
- `renderer-proxy.test.ts` — request/reply correlation, timeout, multiple in-flight requests, abort on window close. Uses a stubbed IpcMain + window.
- `bridge-server-chat.test.ts` — each new client→server message type. Verifies the right injected callback is called with the right args. Stubbed callbacks.
- `bridge-server-attach.test.ts` — `session.attach` gates subsequent fan-out; events for other topics are dropped; `session.follow` enables `session.active` push when active changes.

### Integration (`tests/integration/remote/chat-end-to-end.test.ts`)

Real `ws` + `fetch`. Stub the Claude CLI with a small Node process that emits scripted `claude:message` events on cue. Exercises:

1. Pair (from P0)
2. Attach to a session topic
3. Bus publish a streamed assistant event → phone receives
4. Phone sends a prompt → stubbed CLI receives stdin → emits `result` → both surfaces' bus subscribers see it
5. Stubbed CLI emits `approval_needed` → phone approves → stubbed CLI sees the resume signal
6. Phone interrupt → CLI sees the signal

### Manual smoke checklist

Append to `docs/superpowers/notes/2026-05-25-mobile-remote-p0-smoke.md` (or new P1 file):

- Pair phone, attach to an active workspace session.
- Send a prompt from desktop; phone shows streaming response.
- Send a prompt from phone; desktop shows it in transcript, response streams to both.
- Trigger a tool that requires approval; approve from phone; desktop banner dismisses.
- Same but deny from desktop; phone banner dismisses.
- Switch desktop's active session; phone in follow-mode reattaches.
- Detach follow; phone independently picks a different session.
- Interrupt mid-stream from phone; desktop sees the turn cut off.
- With `remoteCeiling: 'always-ask'`, send a prompt from phone that would auto-approve on desktop; verify it asks.

## Failure modes

| Condition | Behavior |
|---|---|
| Bridge running, renderer-proxy times out (window minimized to tray) | Phone gets `error` frame with code `proxy_timeout`; session attach falls back to bus-buffered events only (no historical replay) |
| Phone sends `approval` for a `toolUseId` already consumed | `approveImpl` is idempotent; second call returns silently; phone's banner dismisses on next event for that id |
| Phone sends a `prompt` for a session that doesn't exist on disk | `sendImpl` either creates the session (current behavior) or errors via claude.ts; bus publishes the error which phone displays |
| Network drop mid-stream | Phone reconnects (P0 wire), re-attaches to same topic, requests history; sees up-to-current state via the bus ring buffer + history replay |
| Two devices attach to the same topic | Both receive the same events; both can send prompts/approvals; first-resolver-wins is the policy. Probably fine for a single-user app; we won't gate it. |

## Migration notes

This phase touches `claude.ts` (a working, important file). Mitigations:

- Keep all IPC handler signatures unchanged.
- Extract impl functions one at a time with paired tests.
- The single fan-out `bus.publish` line is opt-in (null bus = no-op), so the change is dormant if anything goes wrong.

## Exit criteria

1. All vitest unit + integration tests pass (Phase 0 tests still green; Phase 1 tests new and passing).
2. `tsc --noEmit` clean.
3. Manual smoke checklist walked on real hardware: pair → attach → bidirectional prompt+stream → approval-from-phone → interrupt-from-phone → follow-mode switch → detached session pick.
4. Phone-originated prompts visibly clamped to `remoteCeiling` (a prompt that would auto-approve on desktop instead asks on phone).
5. Reconnect mid-stream replays missed events from the bus ring buffer (Phase 0 already gives us this; we verify it stays working).

## Open questions resolved during implementation

- Exact line for the `bus.publish` insertion in `claude.ts` (after `safeSend(win, 'claude:message', msg)` at the message-loop bottom).
- Whether `approveImpl` is already idempotent on consumed `toolUseId` — if not, add a guard.
- Exact dedup key for optimistic-vs-real `user_message` bubbles (likely `projectPath + scope + turnSeq`, but verify against existing optimistic-add logic).
- Whether `session.new` should fire an `attach` automatically or require the phone to call `session.attach` after. (Plan: auto-attach.)

These are wrap-point checks for the implementation plan, not blockers on design.

## Phase 2+ preview

Phase 2 builds the workspace switcher + provider/model/approval-mode pickers on top of this. Phase 1's `session.follow` and `sessions.list` lay the groundwork for the workspace picker. No design churn expected.
