# SAI Chat Sync (Part 1): Durable Chat Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every chat event is written to a durable per-chat log in the main process with a per-chat `seq`, and both the desktop and the phone build the chat from that one log through one shared pure reducer, so nothing is dropped and the two never disagree.

**Architecture:** `emitChatMessage` appends each event to a `ChatLogStore` (JSONL per chat plus a folded snapshot) keyed by SAI's chat id, then fans the stamped entry out over IPC (`chatlog:event`) and the session bus (`chatlog:<chatId>`). A pure `reduceChat(state, entry)` in `src/lib/chat/` replaces ChatPanel's inline `onMessage` mutations and App's background-chat buffers. Main also runs compaction with it. User-side actions (send, approve, answer, interrupt, settings, queue) become idempotent commands into main, keyed by a client id. Protocol v2 on the bridge serves snapshot + tail + live events with gap detection.

**Tech Stack:** TypeScript, Electron 36 main process (Node fs, no new native deps), React 18 renderer, vitest (`--maxWorkers=2` is already set in `vitest.config.ts`), `ws`.

**Spec:** `docs/superpowers/specs/2026-11-19-sai-ios-app-design.md` (Part 1, "Reliable sync"). Read the spec's "Why it drops messages today" and Part 1 before starting any task.

## Global Constraints

- The log key is SAI's chat id (the IndexedDB session id, which is what Claude and Codex already use as `scope`). Gemini and Kimi must emit the real chat id too (Task 4).
- One reducer for desktop, phone and compaction: `src/lib/chat/reducer.ts`. It must be pure. No `Date.now()`, `Math.random()`, `crypto.randomUUID()`, DOM, React or Electron imports. Times come from `entry.ts`, and ids from `entry.seq` or a client id.
- The SDK turnSeq invariants must be kept exactly: stale `result`/`done` (turnSeq ≠ current) is ignored, `done` with `turnSeq: null` is never stale, superseded turns don't end the new turn, and `subagentsAborted`/`subagentsSettled` clear subagents.
- Paths can differ by symlink (`/home` vs `/var/home`). Never compare `projectPath` by string equality; compare `fs.realpathSync.native` results (with a fallback to `path.resolve` when the path is gone).
- No new native dependencies. The log is plain files under `app.getPath('userData')/chatlog/`, overridable with `SAI_CHATLOG_DIR` for tests and dogfooding.
- The v1 PWA protocol keeps working unchanged until Part 4 deletes it: the old `claude:message` IPC and the `chat:<projectPath>:<scope>` bus topic still fire.
- vitest: `npx vitest run --project unit <file>` or `--project integration <file>`. The config already caps workers at 2.
- Commit after each task. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on a branch `chat-sync-log` off `main`.
- Desktop UX must not regress: stream-word fade, the reasoning card, tool cards, the Stop button, waiting dots, follow-up rows and the "has finished" toast all behave as today.

## Review Focus

1. **A phone or panel coming back after compaction** (`after` < snapshotSeq) must get a snapshot plus the tail, never a silent gap. Tested in Task 2 (`read returns snapshot when after predates compaction`) and Task 10 (`subscribe after compaction sends snapshot`).
2. **The app quits or crashes mid-turn.** On relaunch the partial reply is there and the chat is not stuck "working". Tested in Task 2 (`buffered deltas survive flush on close`) and Task 3 (`startup repair closes open turns`).
3. **The same client id sent twice** (a phone retrying after reconnect) gives one user message and one turn. Tested in Task 5 (`duplicate clientId is acked, not re-sent`).
4. **Two chats in one project stream at once while one is not mounted.** No cross-talk, and the unmounted reply is complete when opened (the truncated-reply bug class). Tested in Task 3 (`concurrent chats get independent seqs`) and Task 7 (`live events before open are not lost`).
5. **Very long chats** (10k+ events, large tool output) open quickly and their files stay bounded. Tested in Task 2 (`compaction folds and truncates`) and Task 10 (`snapshot frame sends at most 200 messages`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/chat/types.ts` (create) | `ChatLogEntry`, `ChatEvent`, `ChatState`, `ChatMeta`, `ChatSettings`, `QueuedItem`, `ChatSnapshot`, the pending-card types moved from ChatPanel |
| `src/lib/chat/reducer.ts` (create) | `emptyChatState`, `stateFromMessages`, `reduceChat`, `reduceMany` (pure) |
| `src/lib/chat/reduceAssistant.ts` (create) | assistant/user/tool/reasoning/result branches (keeps reducer.ts readable) |
| `electron/services/chatlog/store.ts` (create) | `ChatLogStore`: append, read, meta, list, import, compact, delete, referenced paths |
| `electron/services/chatlog/service.ts` (create) | `ChatLogService`: chat-id resolution, fan-out (IPC + bus), startup repair, IPC handlers |
| `electron/services/chatlog/commands.ts` (create) | `ChatCommands`: idempotent send/approve/answer/interrupt/settings/queue, provider dispatch, queue drain |
| `electron/services/claude.ts` (modify :118) | `emitChatMessage` records through the service |
| `electron/services/gemini.ts`, `electron/services/kimi.ts` (modify) | emit the real chat id as `scope` |
| `electron/preload.ts` (modify) | `window.sai.chatlog.*` |
| `src/hooks/useChatLog.ts` (create) | snapshot + tail + live, dedupe by seq, gap → reopen, rAF batching |
| `src/lib/chat/migrateToLog.ts` (create) | one-time IndexedDB → log import |
| `src/components/Chat/ChatPanel.tsx` (modify) | render from `useChatLog`; `onMessage` keeps side effects only |
| `src/App.tsx` (modify) | remove background buffers + IDB message flush; queue/settings from log |
| `src/lib/chatFrameGate.ts`, `src/lib/backgroundMessageBuffer.ts`, `src/lib/loadGuardBuffer.ts` | deleted in Task 8 (`loadGuardCard` moves into the reducer) |
| `electron/services/remote/chat-v2.ts` (create) | protocol v2 frame handling, mounted by `bridge-server.ts` |
| `tests/fixtures/chatlog/*.jsonl` (create) | recorded real sessions for reducer golden tests |

---

### Task 1: Shared chat types and the pure reducer

The reducer is a behavior-preserving extraction of `ChatPanel.tsx` `onMessage` (lines 962–1748), plus `flushStreamingText` / `flushReasoning` / `finalizeReasoning` (585–660) and the turn-end duration stamping (2575–2600). Read those first. Wherever ChatPanel used `Date.now()`, use `entry.ts`. Where it used refs (`turnSeqRef`, `forceNewBubbleRef`, `nextSegmentStartRef`, `turnStartedAtRef`, `reasoningActiveRef`, `loadGuardKillRef`, `activeSubagentTurnsRef`), use fields on `ChatState.turn`.

**Out of the reducer** (they stay as ChatPanel side effects in Task 8): `session_id` callbacks, `ready`, `process_exit`'s `onTurnComplete`, slash commands (`init`, `commands_changed`), `rate_limit_event`, `context_usage`, result usage/cost (they need the Codex catalog), `auth_status`, and the Codex rate-limit fetch.

**Files:**
- Create: `src/lib/chat/types.ts`, `src/lib/chat/reducer.ts`, `src/lib/chat/reduceAssistant.ts`
- Test: `tests/unit/chat/reducer.test.ts`, `tests/unit/chat/reducer.turns.test.ts`, `tests/unit/chat/reducer.controls.test.ts`

**Interfaces:**
- Produces (`src/lib/chat/types.ts`):
```ts
export type ChatEvent = { type: string; [k: string]: unknown };
export interface ChatLogEntry { chatId: string; seq: number; ts: number; ev: ChatEvent }
export interface ChatSettings {
  provider: 'claude' | 'codex' | 'gemini' | 'kimi';
  model?: string; permMode?: string; effort?: string;
  approvalMode?: string; conversationMode?: string;
}
export interface QueuedItem { clientId: string; text: string; images?: string[]; queuedAt: number }
export interface TurnState {
  streaming: boolean; turnSeq: number | null; startedAt: number | null;
  startIndex: number | null; forceNewBubble: boolean; nextSegmentStart: number | null;
  reasoningActive: boolean; loadGuardQuietUntil: number | null; loadGuardEnded: boolean;
}
export interface ChatState {
  messages: ChatMessage[];
  turn: TurnState;
  pendingApproval: PendingApproval | null;           // moved from ChatPanel
  pendingSudo: PendingSudoPrompt | null;
  pendingCodexUserInput: PendingCodexUserInput | null;
  pendingCodexMcpElicitation: PendingCodexMcpElicitation | null;
  activeSubagents: Record<string, { summary: string; turnSeq: number | null }>;
  streamHint: string | null;
  promptSuggestion: string | null;
  settings: ChatSettings;
  queue: QueuedItem[];
  lastSeq: number;
}
export interface ChatSnapshot { chatId: string; seq: number; state: ChatState }
export interface ChatMeta {
  chatId: string; projectPath: string; title?: string;
  createdAt: number; updatedAt: number; headSeq: number; snapshotSeq: number;
  provider: ChatSettings['provider'];
}
```
`ChatState` must be JSON-serializable (no Map or Set) because it goes into snapshots and over the wire.
- Produces (`src/lib/chat/reducer.ts`):
```ts
export function emptyChatState(settings: ChatSettings): ChatState
export function stateFromMessages(messages: ChatMessage[], settings: ChatSettings): ChatState
export function reduceChat(state: ChatState, entry: ChatLogEntry): ChatState   // ignores entry.seq <= state.lastSeq
export function reduceMany(state: ChatState, entries: ChatLogEntry[]): ChatState
export function persistableState(state: ChatState): ChatState  // strips reasoningLive/liveOutput, clears pending*, turn.streaming=false
```
- The **client-side event types** handled by the reducer (later tasks write them):
  - `user_message {clientId, text, images?, origin, taskId?}`: user bubble with `id = clientId`, `timestamp = ts`.
  - `local_note {noteId, content, error?}`: system row with `id = noteId` (used by `/help` and the dev fake-error).
  - `cleared {}`: messages become `[]` (`/clear`).
  - `watcher_snapshot {messageId, snapshot}`: upserts by url into `message.githubWatchers`, like ChatPanel:2180.
  - `settings_changed {settings: Partial<ChatSettings>}`: merged into `state.settings`.
  - `queue_added {item: QueuedItem}`, `queue_removed {clientId}` and `queue_cleared {}` update `state.queue`.
- Generated message ids are `m${seq}`, or `m${seq}-${n}` when one entry creates several. Load-guard cards keep the emitted `id`. Error rows are `e${seq}` and compaction notes `c${seq}`.

- [ ] **Step 1: Write the failing message-shape tests** in `tests/unit/chat/reducer.test.ts`. Use a helper `e(seq, ev, ts = 1000 + seq)` that builds a `ChatLogEntry` for chatId `'c1'`.

```ts
it('appends text deltas into one assistant bubble', () => {
  const s = reduceMany(emptyChatState({ provider: 'claude' }), [
    e(1, { type: 'streaming_start', turnSeq: 1 }),
    e(2, { type: 'assistant', turnSeq: 1, message: { content: [{ type: 'text', text: 'Hel', delta: true }] } }),
    e(3, { type: 'assistant', turnSeq: 1, message: { content: [{ type: 'text', text: 'lo', delta: true }] } }),
  ]);
  expect(s.messages).toEqual([expect.objectContaining({ id: 'm2', role: 'assistant', content: 'Hello', timestamp: 1002, startedAt: 1001 })]);
});
it('final-tagged frame replaces accumulated delta text (claude)', ...)        // content becomes the final text, still one bubble
it('claude full non-final frame after text starts a new bubble', ...)
it('gemini non-delta full text replaces the last text bubble', ...)            // settings.provider 'gemini'
it('streaming_start forces a new bubble even when last is mergeable text', ...)
it('tool_use creates a tool card; later same id+turnSeq updates input in place', ...)
it('codex item_0 in a later turn creates a new card, not an update', ...)       // turnSeq 1 then 2, both id 'item_0'
it('tool_result fills output, liveOutput false, durationMs = ts - startedAt', ...)
it('partial tool_result accumulates cumulative and chunked output without duplication', ...)
it('partial tool_result never reopens a settled card', ...)
it('tool_result with a different turnSeq does not touch the card', ...)
it('reasoning_delta builds a reasoningLive row; text output finalizes it with reasoningDurationMs', ...)
it('thinking_tokens sets reasoningTokens on live row, else streamHint "thinking · 1.2k tokens"', ...)
it('API-error-looking text replaces a trailing pure-text bubble with an error row', ...)
it('result.result replaces last assistant content, or appends m<seq> when none', ...)
it('done stamps durationMs/completedAt on unstamped text bubbles since turn start', ...)
it('user_message uses clientId as id; replaying the same entry seq is a no-op', ...)
it('cleared empties messages; local_note appends a system row', ...)
it('is deterministic: same entries twice give deep-equal states', ...)
```

- [ ] **Step 2: Write the failing turn/control tests** in `tests/unit/chat/reducer.turns.test.ts` and `reducer.controls.test.ts`:

```ts
it('stale done (turnSeq 1 while current is 2) does not end the turn', ...)   // turn.streaming stays true
it('done with turnSeq null always ends the turn', ...)
it('done clears pendingApproval and Codex pending cards, sets turnSeq -1', ...)
it('subagent_activity tracks running agents; terminal status removes; stale turn ignored unless tracked terminal', ...)
it('done with subagentsAborted clears activeSubagents; plain done keeps them', ...)
it('load_guard killed agent opens a 15s quiet window (LOAD_GUARD_ERROR_QUIET_MS = 15_000, move the constant into the reducer); error inside it ends turn once as done(null)', ...)
it('error outside the quiet window appends an e<seq> error row and keeps streaming', ...)
it('approval_needed sets pendingApproval (provider-gated for codex); approval_resolved clears it', ...)
it('tool_result clears pendingApproval', ...)
it('sudo-prompt / sudo-resolved set and clear pendingSudo', ...)
it('question_answered merges answers into the tool input JSON', ...)
it('plan_review_answered stamps "Plan approved"/"Plan rejected" output', ...)
it('user_input_needed / resolved only for codex with a matching requestHandle', ...)
it('api_retry, task_progress, status compacting set streamHint; real text clears it', ...)
it('prompt_suggestion sets promptSuggestion; streaming_start clears it', ...)
it('context_compacted appends "Context auto-compacted." note', ...)
it('settings_changed merges; queue_added/removed/cleared maintain order', ...)
it('watcher_snapshot upserts by url on the owning message', ...)
it('persistableState strips reasoningLive and liveOutput and ends the turn', ...)
it('stateFromMessages keeps message ids and sets lastSeq 0', ...)
```

- [ ] **Step 3: Run the tests to verify they fail.**
Run: `npx vitest run --project unit tests/unit/chat/`
Expected: FAIL, "Cannot find module '…/src/lib/chat/reducer'".

- [ ] **Step 4: Implement `src/lib/chat/types.ts`, `reducer.ts` and `reduceAssistant.ts`.**
  - Move `PendingApproval`, `PendingSudoPrompt`, `PendingCodexUserInput` and `PendingCodexMcpElicitation` from ChatPanel into `types.ts`, and re-export them from their old location so ChatPanel still compiles.
  - Reuse the existing pure helpers: `classifyToolType`, `parseToolResultBlocks`, `looksLikeApiError`, `parseAiError` and `loadGuardCard`. Move `loadGuardCard` into `reducer.ts`, since `loadGuardBuffer.ts` is deleted in Task 8. If a helper drags in React or DOM, move its pure part into `src/lib/chat/`.
  - `load_guard` entries are already routed to the right chat by main (Task 3), so the reducer drops the `'*'` matching. It keeps the provider check against `settings.provider`.

- [ ] **Step 5: Run the tests to verify they pass.**
Run: `npx vitest run --project unit tests/unit/chat/`
Expected: all PASS.

- [ ] **Step 6: Verify purity.**
Run: `grep -nE "Date\.now|Math\.random|randomUUID|from 'react'|window\.|electron" src/lib/chat/*.ts`
Expected: no output.

- [ ] **Step 7: Commit.** `feat(chat): pure shared chat reducer extracted from ChatPanel`

---

### Task 2: ChatLogStore

**Files:**
- Create: `electron/services/chatlog/store.ts`
- Test: `tests/unit/chatlog/store.test.ts` (node environment: add `// @vitest-environment node` at the top)

**Interfaces:**
- Consumes: `reduceMany`, `stateFromMessages`, `emptyChatState` and the types from Task 1.
- Produces:
```ts
export interface ReadResult { snapshot: ChatSnapshot | null; entries: ChatLogEntry[]; headSeq: number; meta: ChatMeta | null }
export class ChatLogStore {
  constructor(opts: { dir: string; now?: () => number; flushMs?: number /* default 100 */; compactAfter?: number /* default 500 */ });
  append(chatId: string, ev: ChatEvent, init?: { projectPath: string; provider: ChatSettings['provider'] }): ChatLogEntry;
  read(chatId: string, after: number): ReadResult;
  state(chatId: string): ChatState | null;          // snapshot + tail reduced, cached in memory per chat
  meta(chatId: string): ChatMeta | null;
  list(projectPath: string): ChatMeta[];            // realpath-normalized match, newest updatedAt first
  patchMeta(chatId: string, patch: Partial<Pick<ChatMeta, 'title' | 'provider'>>): void;
  importMessages(chatId: string, init: { projectPath: string; provider: ChatSettings['provider']; title?: string; createdAt: number; updatedAt: number }, messages: ChatMessage[]): boolean; // false if log exists
  compact(chatId: string): void;
  delete(chatId: string): void;
  referencedStrings(re: RegExp): Set<string>;       // regex matches over all snapshots + logs (image GC, model keys)
  openTurnChatIds(): string[];                      // chats whose current state.turn.streaming is true
  flush(): void; close(): void;
}
```
- On-disk layout under `dir`: `<chatId>.jsonl` (one `ChatLogEntry` per line), `<chatId>.snap.json` (`ChatSnapshot` holding the full, exact state at `snapshotSeq`), and `index.json` (`Record<chatId, ChatMeta>`, written atomically via temp file + rename). A chat id that doesn't match `/^[A-Za-z0-9_-]{1,128}$/` is stored as `x-<sha256 hex>` with the real id kept in the meta.

- [ ] **Step 1: Write the failing tests.** Each test uses a fresh `fs.mkdtempSync(os.tmpdir() + '/chatlog-')`.

```ts
it('assigns seq 1..n per chat, independently per chat', ...)                  // c1: 1,2  c2: 1
it('read(after) returns entries with seq > after and headSeq', ...)
it('appends survive a new store instance after flush()', ...)                  // reopen dir, read(c1,0).entries.length === n
it('buffered deltas survive flush on close', ...)                               // 50 delta appends, close(), new store reads all 50
it('non-delta events are written synchronously', ...)                           // append 'done', read raw file without flush → line present
it('compaction folds and truncates', ...)
  // 600 entries then a 'done' → compactAfter 500 triggers compact: .jsonl is empty, snapshotSeq === headSeq,
  // state(c1) deep-equals reduceMany(empty, all entries)
it('read returns snapshot when after predates compaction', ...)                 // after=10 < snapshotSeq → snapshot non-null, entries only > snapshotSeq
it('read(0) on an uncompacted chat returns no snapshot and all entries', ...)
it('importMessages writes a seq-0 snapshot and refuses a second import', ...)
it('list matches projectPath through a symlink', ...)                           // symlink tmp/link → tmp/real; meta under real, list(link) finds it
it('unsafe chat ids are hashed on disk but round-trip in meta', ...)            // chatId '../evil'
it('delete removes files and meta', ...)
it('openTurnChatIds lists chats with an unfinished turn', ...)
it('referencedStrings finds image paths in both snapshots and logs', ...)
it('a torn last line (crash mid-write) is skipped on load, later appends continue the seq', ...)
```

- [ ] **Step 2: Run the tests to verify they fail.**
Run: `npx vitest run --project unit tests/unit/chatlog/store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `ChatLogStore`.**
  - A pure text or reasoning delta (same predicate as ChatPanel's `isPureTextDelta`, plus `reasoning_delta`) goes into an in-memory write buffer, flushed every `flushMs` and before any other event's synchronous `appendFileSync`.
  - Compaction runs after a `done` event when `headSeq - snapshotSeq >= compactAfter`. It writes the snapshot (temp file + rename) and then truncates the `.jsonl`.
  - `headSeq` is recovered on load as the max of `snapshotSeq` and the last good line's seq.

- [ ] **Step 4: Run the tests to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(chatlog): durable per-chat append-only log with snapshots`

---

### Task 3: ChatLogService, routing every emitted event through the log

**Files:**
- Create: `electron/services/chatlog/service.ts`
- Modify: `electron/services/claude.ts:118-123` (`emitChatMessage`), `electron/main.ts` (construct the service before `registerClaudeHandlers`, pass `liveChats`, call `startupRepair()` after the backends init, `store.close()` in `before-quit`), `electron/preload.ts`, `src/types` (`window.sai.chatlog` typing), and the `pruneToolResultImages` / `pruneModelCache` handlers in `electron/services/toolResultImageStore.ts` and `modelCache.ts`
- Test: `tests/unit/chatlog/service.test.ts`

**Interfaces:**
- Consumes: `ChatLogStore` (Task 2).
- Produces:
```ts
export interface ChatLogServiceOpts {
  store: ChatLogStore;
  sendToRenderer: (channel: 'chatlog:event', entry: ChatLogEntry) => void;
  bus: () => SessionBus | null;
  /** chat ids with a live backend scope for this provider (and project unless '*') */
  liveChats: (provider: string, projectPath: string | '*') => string[];
  providerOf: (projectPath: string, scope: string) => ChatSettings['provider'];
  devlog: (event: string, data: Record<string, unknown>) => void;
}
export class ChatLogService {
  constructor(opts: ChatLogServiceOpts);
  record(msg: Record<string, unknown>): ChatLogEntry[];   // resolve chat ids, append, fan out; [] if unroutable
  appendClient(chatId: string, ev: ChatEvent): ChatLogEntry; // for client event types only (Task 1 list); throws on others
  bindLegacyScope(projectPath: string, chatId: string): void;
  startupRepair(): void;  // for openTurnChatIds() with no live backend: append {type:'done', turnSeq:null, reason:'app_restart'}
  registerIpc(ipcMain: Electron.IpcMain): void;
}
```
- IPC (`registerIpc`) and preload `window.sai.chatlog`:
  - `open(chatId, after) → ReadResult` (invoke `chatlog:open`)
  - `onEvent(cb) → unsubscribe` (`chatlog:event`)
  - `appendClient(chatId, ev) → ChatLogEntry`
  - `importMessages(chatId, init, messages) → boolean`
  - `list(projectPath) → ChatMeta[]`
  - `delete(chatIds: string[])`
  - `bindLegacyScope(projectPath, chatId)`
  - `patchMeta(chatId, patch)`
- Bus topic per chat: `chatlog:${chatId}`, carrying the `ChatLogEntry`.
- **Chat-id resolution** (`record`), from `msg.scope`:
  - Not `'chat'` and not `'*'` → that scope is the chat id.
  - `'*'` → `liveChats(msg.provider, msg.projectPath)`, deduped by `msg.id`.
  - `'chat'` → the chat id bound by `bindLegacyScope` for that realpath'd project. If nothing is bound, devlog `chatlog.unroutable` and return `[]`.
- A chat's first append initializes its meta with `projectPath` and `providerOf(...)`.

- [ ] **Step 1: Write the failing tests** (node environment; a fake `sendToRenderer` and a real `SessionBus`):

```ts
it('records a scoped event, assigns seq, sends chatlog:event and publishes chatlog:<id>', ...)
it('concurrent chats get independent seqs', ...)     // interleave c1/c2 events in one project
it("'*' load_guard fans out to liveChats with one entry each, same card id", ...)
it("'chat' scope routes to the bound chat id, matched through a symlinked projectPath", ...)
it("unbound 'chat' scope is dropped with a chatlog.unroutable devlog", ...)
it('appendClient rejects backend event types (e.g. assistant)', ...)
it('startup repair closes open turns with no live backend', ...)   // state(c1).turn.streaming === false after
it('startup repair leaves chats with a live backend alone', ...)
```
Then in `tests/unit/services/` (or next to the existing claude.ts tests) add: `emitChatMessage still sends claude:message and publishes chat:<path>:<scope>` (v1 untouched).

- [ ] **Step 2: Run the tests to verify they fail.**
Run: `npx vitest run --project unit tests/unit/chatlog/service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `ChatLogService` and wire it in.**
  - `emitChatMessage` keeps `externalizeToolResultImages` first, then calls `chatLog?.record(msg)`, then does the existing IPC send and v1 bus publish.
  - `liveChats` comes from the backends' workspace maps (claude.ts `workspaces`, the codex, gemini and kimi equivalents): the scopes with a live process for that provider.
  - The tool-image and model-cache prune handlers union the renderer-supplied references with `store.referencedStrings(...)`, using the same path/key regexes the renderer's `dbCollectReferenced*` use. A GC can then never delete something only the log references.

- [ ] **Step 4: Run the tests and the existing remote/claude suites.**
Run: `npx vitest run --project unit tests/unit/chatlog tests/unit/remote tests/unit/services`
Expected: PASS, with no regressions in existing suites.

- [ ] **Step 5: Smoke the dev build.**
Run `SAI_CHATLOG_DIR=/tmp/sai-chatlog npm run dev` and send one Claude message with a tool call. Then run `ls /tmp/sai-chatlog && tail -3 /tmp/sai-chatlog/*.jsonl`.
Expected: a `.jsonl` named after the chat id with `streaming_start` … `done` entries and increasing seqs.

- [ ] **Step 6: Commit.** `feat(chatlog): record every chat event in the durable log`

---

### Task 4: Gemini and Kimi emit the real chat id

**Files:**
- Modify: `electron/services/gemini.ts` (`gemini:send`/`stop`/`setSessionId` and emits), `electron/services/kimi.ts`, `electron/services/acpProvider.ts` if the emits live there, `src/components/Chat/ChatPanel.tsx:2457-2460` (pass `claudeScope`, not `'chat'`), and `ChatPanel.tsx:963` (`expectedScope` becomes `claudeScope` for every provider)
- Test: `tests/unit/providers/` (the existing gemini/kimi/acp test files)

**Interfaces:**
- Produces: every Gemini and Kimi emit carries `scope = <chat id of the send that started the turn>`. If a backend keys its process per project (Kimi: `kimi:start` takes no scope), it records the scope of the last `send` and stamps that on all emits until the next send.

- [ ] **Step 1: Write the failing tests:**
  - `gemini emits use the scope passed to gemini:send`
  - `kimi emits use the last send's scope`
  - `gemini:stop with a chat id stops that chat`

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --project unit tests/unit/providers`
Expected: the new tests FAIL; the old ones pass.

- [ ] **Step 3: Implement.** Keep `'chat'` as the default only for callers that pass no scope.

- [ ] **Step 4: Run the provider suites to verify they pass.**

- [ ] **Step 5: Commit.** `fix(providers): gemini and kimi emit the chat id as scope`

---

### Task 5: Idempotent chat commands in main

This replaces the bridge's Claude-only `sendPrompt` and the renderer's direct `claude:send`/`codex:send`/`gemini:send`/`kimi:send` dispatch with one command path that **logs the user message first**.

**Files:**
- Create: `electron/services/chatlog/commands.ts`
- Modify: `electron/main.ts` (construct and pass to the bridge in Task 10), `electron/preload.ts` (`window.sai.chatlog.command`)
- Test: `tests/unit/chatlog/commands.test.ts`

**Interfaces:**
- Consumes: `ChatLogService.appendClient`, `ChatLogStore.state/meta`.
- Produces:
```ts
export type ChatCommand =
  | { kind: 'send'; chatId: string; clientId: string; text: string; images?: string[]; imagePaths?: string[]; origin: 'desktop' | 'remote'; projectPath: string; now?: boolean; taskId?: string; promptOverride?: string }
  | { kind: 'approve'; chatId: string; clientId: string; toolUseId: string; approved: boolean; modifiedCommand?: string }
  | { kind: 'answer'; chatId: string; clientId: string; toolUseId: string; answers: Record<string, string | string[]> }
  | { kind: 'planReview'; chatId: string; clientId: string; toolUseId: string; approved: boolean }
  | { kind: 'interrupt'; chatId: string; clientId: string }
  | { kind: 'settings'; chatId: string; clientId: string; settings: Partial<ChatSettings> }
  | { kind: 'queueRemove'; chatId: string; clientId: string; target: string }
  | { kind: 'queueClear'; chatId: string; clientId: string };
export interface CommandResult { clientId: string; ok: boolean; duplicate: boolean; seq?: number; error?: string }
export interface ProviderDispatch {
  send(p: ChatSettings['provider'], a: { projectPath: string; scope: string; prompt: string; imagePaths?: string[]; settings: ChatSettings; origin: 'desktop' | 'remote' }): void;
  stop(p: ChatSettings['provider'], projectPath: string, scope: string): void;
  approve(p, a: { projectPath; scope; toolUseId; approved; modifiedCommand? }): Promise<void>;
  answer(a: { projectPath; scope; toolUseId; answers }): Promise<void>;
  planReview(a: { projectPath; scope; toolUseId; approved }): Promise<void>;
  isBusy(projectPath: string, scope: string): boolean;
  isLoadPaused(): boolean;
}
export class ChatCommands {
  constructor(opts: { log: ChatLogService; store: ChatLogStore; dispatch: ProviderDispatch; ledgerSize?: number /* 2000 */ });
  run(cmd: ChatCommand): Promise<CommandResult>;
  onTurnEnded(chatId: string): void;   // called by service.record on an accepted terminal done; drains one queued item
}
```
- **Send semantics:**
  1. Append `user_message {clientId, text, images, origin, taskId}`.
  2. If `isBusy` or `isLoadPaused()`, and `now` is not set → append `queue_added` and don't dispatch.
  3. If `now` is set and busy → `stop` first, then dispatch. This is the desktop's "Enter bypasses the queue".
  4. Otherwise dispatch with `promptOverride ?? text`, which carries the desktop's `[File: …]` prefix and task-card wrapping. The prompt the model sees may differ from the bubble text, as today.
- When the queue drains, it appends `queue_removed` followed by a fresh dispatch of the queued text. The `user_message` was already logged at queue time, so drains don't log it again.
- The ledger is an LRU of `clientId` → `CommandResult`. A repeat returns the stored result with `duplicate: true` and has no side effects.
- `settings` appends `settings_changed`. Per-chat settings are capped by `getRemoteCeiling()` when `origin` is remote.

- [ ] **Step 1: Write the failing tests** (fake `ProviderDispatch`, real store and service on a tmp dir):

```ts
it('send logs user_message before dispatching, with the chat settings', ...)
it('duplicate clientId is acked, not re-sent', ...)            // dispatch.send called once, second result duplicate:true
it('send while busy queues (queue_added) and does not dispatch', ...)
it('turn end drains exactly one queued item in order', ...)
it('send with now:true while busy stops then dispatches, queue untouched', ...)
it('send while load-paused queues', ...)
it('remote settings are capped by the remote ceiling', ...)
it('approve/answer/planReview/interrupt dispatch once per clientId', ...)
it('routes to the provider in chat settings (codex chat → dispatch.send("codex"))', ...)
it('queueRemove and queueClear log events', ...)
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --project unit tests/unit/chatlog/commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `ChatCommands`. Build the real `ProviderDispatch` in `main.ts`.**
  - It calls the existing `sendImpl`/`getClaudeBackend().send`, the codex/gemini/kimi send functions, `approveImpl`, `answerQuestionImpl`, `answerPlanReviewImpl` and `interruptImpl`, mapping settings the way ChatPanel:2457–2473 does today. That covers permMode/effort/model for Claude and Codex (`normalizeCodexEffort`), and approvalMode/conversationMode for Gemini and Kimi.
  - `isBusy` reads the backend's active-turn state for the scope. `isLoadPaused` reads the load guard.
  - Hook `onTurnEnded` from `service.record` when a `done` entry ends the turn in the reduced state (`state.turn.streaming` goes true→false).

- [ ] **Step 4: Run the tests to verify they pass.**

- [ ] **Step 5: Commit.** `feat(chatlog): idempotent chat commands with shared per-chat queue and settings`

---

### Task 6: Import existing IndexedDB chats into the log

**Files:**
- Create: `src/lib/chat/migrateToLog.ts`
- Modify: `src/App.tsx` (start the migration after `migrateFromLocalStorage` and the purge on startup; it doesn't block the UI), `src/lib/remoteProxyClient.ts` (`loadHistory` goes through the log, importing lazily)
- Test: `tests/unit/chat/migrateToLog.test.ts` (fake-indexeddb is already used by `tests/unit/chatDb.test.ts`, so copy its setup)

**Interfaces:**
- Consumes: `dbGetAllSessions`, `dbGetMessages`, and `window.sai.chatlog.importMessages/list`.
- Produces:
```ts
export async function migrateChatsToLog(opts?: { batch?: number /* 20 */ }): Promise<{ imported: number; skipped: number }>
export async function ensureChatInLog(chatId: string): Promise<void>  // imports one chat if its log is missing
```
- A localStorage flag `sai.chatlog.migrated.v1` is set only after a full pass succeeds. Each chat's import is idempotent (`importMessages` returns false if the chat already exists).
- Provider comes from `session.aiProvider ?? 'claude'`, and title and timestamps from the session row.

- [ ] **Step 1: Write the failing tests:**
  - `imports every chat once, preserving message ids`
  - `re-running skips already-imported chats`
  - `a failure mid-pass leaves the flag unset`
  - `ensureChatInLog imports a missing chat and is a no-op for an existing one`

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --project unit tests/unit/chat/migrateToLog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Batches yield with `await new Promise(r => setTimeout(r, 0))` between them so the UI never stalls.

- [ ] **Step 4: Run the tests to verify they pass.**

- [ ] **Step 5: Commit.** `feat(chatlog): import existing IndexedDB chats into the log`

---

### Task 7: `useChatLog` hook

**Files:**
- Create: `src/hooks/useChatLog.ts`
- Test: `tests/unit/hooks/useChatLog.test.tsx`

**Interfaces:**
- Consumes: `window.sai.chatlog.open/onEvent`, `reduceMany`, `stateFromMessages`, `emptyChatState`, `ensureChatInLog`.
- Produces:
```ts
export interface UseChatLog {
  state: ChatState | null;   // null until the first open resolves
  meta: ChatMeta | null;
  /** fires for every applied entry, after the state update is scheduled (ChatPanel's side-effect hook) */
  lastApplied: React.MutableRefObject<ChatLogEntry[]>;
}
export function useChatLog(chatId: string | null, fallbackSettings: ChatSettings): UseChatLog
```
- **Algorithm** (the ordering is the fix for the old mount-gap bugs, so it is specified exactly):
  1. Subscribe to `onEvent` **first**, buffering the entries for this chat id.
  2. `await ensureChatInLog(chatId)`, then `open(chatId, 0)`.
  3. The state is `snapshot.state` (or `emptyChatState`), reduced with the entries, then with buffered entries where `seq > state.lastSeq`.
  4. For live entries: `seq <= lastSeq` → drop. `seq === lastSeq + 1` → queue for the next rAF batch. `seq > lastSeq + 1` (a gap) → `open(chatId, lastSeq)` and apply the result.
  5. Batch reduction per `requestAnimationFrame` (this replaces ChatPanel's `streamRafRef`/`reasoningRafRef`).
  6. A `chatId` change resets everything. A stale open resolving after a switch is ignored (generation counter).

- [ ] **Step 1: Write the failing tests** (mock `window.sai.chatlog`, fake rAF via `vi.useFakeTimers` + a rAF shim):

```ts
it('applies snapshot then entries', ...)
it('live events before open are not lost', ...)     // event seq 3 arrives while open() pending with entries 1..2 → state.lastSeq 3
it('duplicate seq is ignored', ...)
it('a gap triggers open(chatId, lastSeq) and fills in', ...)
it('batches many deltas into one render per frame', ...)  // count renders
it('switching chatId ignores the stale open result', ...)
it('events for other chats are ignored', ...)
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --project unit tests/unit/hooks/useChatLog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests to verify they pass.**

- [ ] **Step 5: Commit.** `feat(chat): useChatLog hook with seq dedupe and gap recovery`

---

### Task 8: The desktop renders from the log

This is the riskiest task (the spec says so). ChatPanel stops owning `messages` and stops writing chat content to IndexedDB. IndexedDB stays as the session-row store and a write-behind mirror of message content: chat search, export and title generation still read it until they are moved, and the mirror is written from log state, never the other way round.

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
  - `messages`, `pendingApproval`, `pendingSudoPrompt`, `pendingCodex*`, `activeSubagents`, `streamHint`, `promptSuggestion` and `turnStartIndex` come from `useChatLog(claudeScope, …).state`.
  - `onMessage` keeps only the side effects listed in Task 1, plus the stream-idle timers (`streamSettled`, `postSettleHold`), `onTurnComplete`, and `flushMessagesToParent` (now: hand `persistableState(state).messages` to the parent for the mirror).
  - Local mutations become log events: `/clear` → `appendClient cleared`; `/help` → `local_note` with id `help-<clientId>`; dev fake-error → `local_note`; the watcher snapshot handler (2180) → `appendClient watcher_snapshot`; the brainstorm seed (925) → `command send` with `origin:'desktop'`.
  - `handleSend` → `window.sai.chatlog.command({kind:'send', clientId: crypto.randomUUID(), …, promptOverride})`. The FLIP rect is keyed by that clientId, which is now the bubble id.
  - Approve, answer, plan review, stop and retry go through `command`.
  - Call `bindLegacyScope(projectPath, sessionId)` on mount when `claudeScope === 'chat'`.
- Modify: `src/App.tsx`. Delete the background-assistant buffering (≈2027–2050), the load-guard buffering call, the background done-flush to IDB (≈2280–2330), the select-time `mergePersistedWithBuffer` merge and the `dbGetMessagesTail` load (≈2976–3010), since the panel loads from the log. Session deletes and the retention purge also call `window.sai.chatlog.delete(ids)`.
- Delete: `src/lib/chatFrameGate.ts`, `src/lib/backgroundMessageBuffer.ts`, `src/lib/loadGuardBuffer.ts` and their tests (`grep -rl` them under `tests/`), after `grep -rn` shows no remaining imports.
- Modify: `src/components/Chat/ChatHistorySidebar.tsx:135,245`: reads that need content use `ensureChatInLog` + `chatlog.open`, not `dbGetMessages`.
- Test: `tests/unit/components/Chat/ChatPanel.log.test.tsx` (new), plus update the existing ChatPanel and App tests that fed `claudeOnMessage` so they feed `chatlog:event` entries instead.

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 6 and 7.
- Produces: no new exports. The renderer's chat UI depends only on `window.sai.chatlog.*` for content, and on `claudeOnMessage` for side effects.

- [ ] **Step 1: Write the failing tests** in `ChatPanel.log.test.tsx` (mock `window.sai.chatlog` with an in-memory store driving `onEvent`):

```ts
it('renders messages from the log snapshot and live entries', ...)
it('send issues one command with a clientId and shows the bubble from the user_message entry', ...)
it('a reply that streamed while the panel was unmounted is complete on mount', ...)  // entries 1..40 exist before mount
it('Stop button clears on the done entry; a stale done does not clear it', ...)
it('/clear and /help go through appendClient', ...)
it('approval card comes from state.pendingApproval and approve sends one command', ...)
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --project unit tests/unit/components/Chat/ChatPanel.log.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the ChatPanel changes.**

- [ ] **Step 4: Implement the App.tsx and sidebar changes and delete the three buffer modules.**

- [ ] **Step 5: Run the full unit and integration suites.**
Run: `npx vitest run`
Expected: PASS. Fix any test still relying on the removed buffers by moving it onto log entries, not by restoring the buffers.

- [ ] **Step 6: Typecheck.**
Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

- [ ] **Step 7: Dogfood with the dev build** (`SAI_CHATLOG_DIR=/tmp/sai-chatlog npm run dev`). Each of these must behave exactly as today:
  - A Claude turn with tools and reasoning
  - A Codex turn
  - Switching away mid-reply and back: the reply is complete
  - Two chats streaming at once
  - Stop mid-turn
  - An approval
  - AskUserQuestion
  - `/clear`
  - Quit mid-turn, relaunch: the partial reply is shown and the chat is not "working"

Write the results in the task report.

- [ ] **Step 8: Commit.** `feat(chat): desktop chat renders from the durable log`

---

### Task 9: Composer settings and queue live in main

**Files:**
- Modify:
  - `src/components/Chat/ChatPanel.tsx`: the model, permission, effort and approval/conversation-mode pickers read `state.settings` and write `command settings`. The queue strip reads `state.queue` and removes items via `command queueRemove`.
  - `src/App.tsx`: delete `messageQueues` state, `handleQueueAdd/Remove/Clear` and the drain effect (≈1268–1300 and its effect). `MessageQueue` props come from the panel's log state.
- Modify: wherever the per-workspace defaults live today (App/`claudeWorkspaceConfig.ts`). A **new** chat's first `settings_changed` is seeded from the current workspace defaults, so existing preference behavior holds.
- Test: `tests/unit/components/Chat/ChatPanel.settings.test.tsx`

**Interfaces:**
- Consumes: `ChatCommands` (`settings`, `queueRemove`, `queueClear`, `send` with `now`).

- [ ] **Step 1: Write the failing tests:**
  - `picker change sends one settings command and reflects state.settings`
  - `a settings_changed entry from the phone updates the picker`
  - `send while streaming shows the item in the queue strip from state.queue`
  - `Enter with a non-empty queue while streaming sends now:true`
  - `removing a queued item sends queueRemove`
  - `new chat seeds settings from workspace defaults`

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run `npx vitest run` and both `tsc` checks.** Expected: PASS.

- [ ] **Step 5: Dogfood:**
  - Queue three messages mid-turn: they run in order.
  - Change the model mid-chat: the next turn uses it.
  - Quit with items queued and relaunch: the queue is still shown, and it drains on the next turn end. If nothing is running on relaunch, it drains immediately: `startupRepair` must call `onTurnEnded` for chats it closes.

- [ ] **Step 6: Commit.** `feat(chat): per-chat settings and queue owned by main`

---

### Task 10: Protocol v2 on the bridge

**Files:**
- Create: `electron/services/remote/chat-v2.ts`
- Modify: `electron/services/remote/bridge-server.ts` (after auth, frames whose `type` starts with `chat.` or is `chats.list` go to `ChatV2.handle(ws, msg)`; on close → `ChatV2.detach(ws)`), `electron/main.ts` (pass `store`, `service`, `commands`), `electron/services/remote/README.md` (document v2)
- Test: `tests/unit/remote/chat-v2.test.ts`, `tests/integration/remote/chat-v2-end-to-end.test.ts`

**Interfaces:**
- Consumes: `ChatLogStore.read/list/meta`, the bus topic `chatlog:<chatId>`, and `ChatCommands.run`.
- Produces: the wire frames (all carry `v: 2`):
  - **Client → desktop:**
    - `chat.subscribe {chatId, after}`
    - `chat.unsubscribe {chatId}`
    - `chats.list {reqId, projectPath}`
    - `chat.page {reqId, chatId, beforeIndex, limit<=200}`
    - `chat.command {command: ChatCommand}`. For `send`, `origin` is forced to `'remote'` and `imagePaths` is ignored: images arrive as data URLs and go through the existing temp-file writer.
  - **Desktop → client:**
    - `chat.snapshot {chatId, seq, state, olderCount}`: `state.messages` is the last 200, and `olderCount` is how many were cut.
    - `chat.entries {chatId, entries}`: a catch-up batch, contiguous from `after + 1`.
    - `chat.entry {chatId, entry}`: live.
    - `chats.list.result {reqId, chats: ChatMeta[]}`
    - `chat.page.result {reqId, chatId, messages, olderCount}`
    - `chat.ack {result: CommandResult}`
    - `chat.error {chatId?, code, message}`
- **Subscribe order:** attach the bus listener first and buffer, then `read(chatId, after)`. Send a snapshot if `read` returned one, or if `after === 0` and the chat has a snapshot. Then send the entries, then the buffered live entries with `seq > last sent`, then go live. The client applies the same dedupe and gap rules as `useChatLog`. A gap on the client → re-`subscribe` with its `lastSeq`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('subscribe after=0 on a fresh chat sends entries 1..n then live entries', ...)
it('subscribe after compaction sends snapshot', ...)
it('snapshot frame sends at most 200 messages with olderCount', ...)
it('an entry published between read and attach is delivered exactly once', ...)
it('chat.command send acks; a duplicate clientId acks duplicate:true and does not dispatch', ...)
it('remote send origin is forced to remote and capped by the remote ceiling', ...)
it('chats.list matches a symlinked projectPath', ...)
it('unauthenticated chat.* frames close the socket 4001', ...)
it('v1 frames still work alongside v2 on the same socket', ...)
```
Integration test: start a real `BridgeServer` on an ephemeral port, pair a device, subscribe, append 300 entries via the service, drop the socket at entry 150, reconnect with `after: <last seen>`, and assert that the client-side `reduceMany` result deep-equals `store.state(chatId)`.

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --project unit tests/unit/remote/chat-v2.test.ts && npx vitest run --project integration tests/integration/remote/chat-v2-end-to-end.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `chat-v2.ts` and the bridge hook.**

- [ ] **Step 4: Run all the remote suites.**
Run: `npx vitest run tests/unit/remote tests/integration/remote`
Expected: PASS (v1 suites included).

- [ ] **Step 5: Commit.** `feat(remote): chat protocol v2 with seq catch-up and idempotent commands`

---

### Task 11: Golden tests from recorded real sessions

**Files:**
- Create: `tests/fixtures/chatlog/claude-tools-reasoning.jsonl`, `codex-two-turns.jsonl`, `claude-interrupt-superseded.jsonl`, `claude-background-wait.jsonl`, and `tests/unit/chat/reducer.golden.test.ts`

- [ ] **Step 1: Record the sessions.**
  - Run the dev build with `SAI_CHATLOG_DIR=/tmp/sai-chatlog-rec`.
  - Run one session for each fixture:
    - a Claude turn using Bash + Read with "Show reasoning" on
    - two Codex turns where the second reuses tool item ids
    - a Claude turn that you send a second message into mid-stream (superseded turn)
    - a Claude turn that launches a background Agent and waits
  - Copy each chat's `.jsonl` into `tests/fixtures/chatlog/`. Replace any home-path or secret strings with `/home/user/...`, and keep the event structure intact.

- [ ] **Step 2: Write the golden tests.**
  - For each fixture, `reduceMany(emptyChatState(...), entries)` must match a committed `toMatchSnapshot()`. Review the snapshot by hand against what the desktop showed during recording: bubble count and order, tool outputs, reasoning rows, no stuck `streaming`.
  - Also assert that reducing in two halves (`reduceMany(reduceMany(s, a), b)`) equals reducing all at once, and that compaction via `ChatLogStore` gives the same state.

- [ ] **Step 3: Run the golden tests.**
Run: `npx vitest run --project unit tests/unit/chat/reducer.golden.test.ts`
Expected: PASS, with snapshots written on the first run and reviewed.

- [ ] **Step 4: Commit.** `test(chat): golden reducer tests from recorded real sessions`

---

## After this plan

Ship as a normal desktop release (`/release minor`) once Task 8's and 9's dogfood checklists pass, and watch CI with `sai_watch_github_run`. The next plan is Part 2 (the Capacitor app), which consumes protocol v2 and `src/lib/chat/reducer.ts` as built here.
