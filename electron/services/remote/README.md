# Mobile Remote

Bridge between the desktop SAI Electron app and a Tailscale-private PWA running on the user's phone. See `docs/superpowers/specs/2026-05-25-mobile-remote-roadmap.md`.

Modules:
- `tailnet.ts` — resolves the Tailscale IP/hostname for this host
- `pairing-store.ts` — argon2id-hashed bearer tokens, single-table sqlite
- `screenshot-urls.ts` — signed single-use URLs for binary payloads
- `session-bus.ts` — output fan-out: subscribeAll + per-topic subscribe + history
- `bridge-server.ts` — HTTP + WS, binds tailnet IP only
- `chat-v2.ts` — chat protocol v2 (below) over the durable chat log (`../chatlog/`)
- `workspaceRegistry.ts` — the renderer-pushed workspace list (v2 `workspaces.subscribe`)
- `appSettings.ts` — the phone-visible app settings snapshot + change feed (v2 `app.settings`)
- `fileRead.ts` — v2 `file.read`: tool-result images and cached 3D models as data URLs, confined to their userData dirs
- `index.ts` — RemoteModule supervisor

Tests live under `tests/unit/remote/` and `tests/integration/remote/` per SAI's vitest project layout.

## Chat protocol v2

Runs on the same `/ws` socket as v1, after the same `auth` frame (any frame
before `auth_ok`, v2 included, closes the socket with 4001). Frames whose
`type` starts with `chat.` or `chats.`, or is `workspaces.subscribe`,
`app.settings`, `models.list`, `slash.list` or `file.read`, are v2; everything else is v1 and unchanged (v1
`workspaces.list` included). Every v2 frame the desktop sends carries `v: 2`. The chat log, its
seq numbers and the reducer (`src/lib/chat/reducer.ts`) are shared with the
desktop: a client that applies the same entries ends with the same state.

Client → desktop:

| Frame | Fields |
|---|---|
| `chat.subscribe` | `chatId`, `after` (last seq the client applied; 0 = none) |
| `chat.unsubscribe` | `chatId` |
| `chats.list` | `reqId`, `projectPath` (matched by realpath, so `/home/...` and `/var/home/...` both work) |
| `chats.subscribe` | `reqId`, `projectPath` (realpath-matched): replies `chats.list.result`, then pushes `chats.changed` |
| `chats.unsubscribe` | `projectPath` |
| `workspaces.subscribe` | `reqId`: replies `workspaces.list.result`, then pushes `workspaces.changed` |
| `app.settings` | `reqId`: replies `app.settings.result`, then pushes `app.settings.changed` |
| `models.list` | `reqId`, `provider` (`claude`, `codex`, `gemini`, `kimi`) |
| `slash.list` | `reqId`, `projectPath`, `chatId` |
| `file.read` | `reqId`, `kind` (`toolImage` or `model`), `ref` |
| `chat.page` | `reqId`, `chatId`, `beforeIndex`, `limit` (≤ 200) |
| `chat.command` | `command`: a `ChatCommand` (`electron/services/chatlog/commands.ts`) |

Desktop → client:

| Frame | Fields |
|---|---|
| `chat.snapshot` | `chatId`, `seq`, `state` (a `ChatState`, last 200 messages), `olderCount` (messages cut) |
| `chat.entries` | `chatId`, `entries`: catch-up batch, contiguous from the snapshot seq (or `after`) + 1; may be empty |
| `chat.entry` | `chatId`, `entry`: one live entry |
| `chats.list.result` | `reqId`, `chats: ChatMeta[]` (newest first) |
| `chats.changed` | `projectPath` (as the client sent it), `chats: ChatMeta[]`: the project's full list |
| `workspaces.list.result` | `reqId`, `workspaces: RemoteWorkspace[]` (`renderer-proxy.ts`) |
| `workspaces.changed` | `workspaces: RemoteWorkspace[]`: the full list |
| `app.settings.result` | `reqId`, `settings` (below) |
| `app.settings.changed` | `settings` (below) |
| `models.list.result` | `reqId`, `provider`, `models`: exactly what the desktop's `<provider>:models` IPC returns |
| `slash.list.result` | `reqId`, `commands`: the `claude:refreshSlashCommands` list (`[]` for other providers) |
| `file.read.result` | `reqId`, and `dataUrl` or `error` (`bad_request`, `forbidden`, `not_found`, `too_large`, `read_failed`, `unavailable`) |
| `chat.background` | `chatId`, `tasks`: the chat's background tasks (the `claude:backgroundTasks` payload's `tasks`) |
| `chat.page.result` | `reqId`, `chatId`, `messages` (indices `[olderCount, beforeIndex)`), `olderCount` |
| `chat.ack` | `result: CommandResult` (`clientId`, `ok`, `duplicate`, `seq?`, `error?`) |
| `chat.error` | `reqId?` (the failed frame's `reqId`, when it had one), `chatId?`, `clientId?` (a command refused as `unavailable`), `code` (`bad_request`, `unknown_chat`, `unavailable`, `read_failed`, `unknown_type`, `internal`), `message` |

**Subscribe.** The desktop attaches its live listener first (buffering), then
reads the log after `after`. It sends `chat.snapshot` when the read returns one
(the client's `after` predates the last compaction or history fold, or
`after === 0` and the chat has a snapshot), then `chat.entries`, then any
buffered live entries past what it sent, then goes live with `chat.entry`. A
client whose `after` is ahead of the log (the log was reset) gets a snapshot of
the current state. Re-subscribing replaces the previous subscription. Unknown
chats subscribe fine (empty `chat.entries`); their first entries arrive live.
If the client sent `after > 0` for a chat with no log (it was deleted), it
first gets an empty `chat.snapshot` at `seq: 0`, so its head resets and seq 1
isn't dropped as a duplicate.

**Workspaces.** The renderer pushes its workspace list to main
(`remoteReportWorkspaces`, debounced to 250 ms, whenever the list or a status
changes) into `WorkspaceRegistry`; rows are the v1 `workspaces.list` rows, and
`status` is the full `workspace.status` payload (`busy`, `streaming`,
`completed`, `approval`, `awaitingQuestion`, `streamingSessionId`,
`streamingSessionIds`, `suspendedSessionIds`, `awaitingSessionIds`) when the
workspace has had any activity. `workspaces.changed` is pushed only when the
list actually differs. Until the renderer has reported once, the
`workspaces.subscribe` reply falls back to the proxied v1 list (empty if the
renderer doesn't answer).

**Chat lists.** `chats.subscribe` pushes `chats.changed` when any chat under the
project (by realpath) changes its list row: `title`, `updatedAt`, `openTurn`,
`queued`, `headSeq`, or the chat is created, imported or deleted. Pushes are
throttled per project to one per 500 ms, trailing edge: a burst (a phone-created
chat's first entries, a streaming reply's deltas) becomes a single push of the
list as it is at the end of the window. Re-subscribing a project replaces the
previous subscription.

**App settings.** `settings` holds exactly these settings.json keys when set
(unset ones are omitted; apply the desktop defaults): `theme`, `accent`,
`highlightTheme`, `messageStampMode`, `toolCallsExpanded`,
`tagMessagesWithTask`, `saiAnimationEnabled`, `autoCompactThreshold`; plus
`remoteCeiling` (`'auto' | 'auto-read' | 'always-ask' | null`, the remote
permission ceiling). `app.settings.changed` is pushed when one of them changes
(a settings write on the desktop, a GitHub settings sync, or a ceiling change).

**Models.** `models.list` calls the same function as the desktop's
`claude:models`, `codex:models`, `gemini:models` or `kimi:models` handler
(`electron/services/providerModels.ts`), so `models` has that handler's shape
(e.g. `{ models, detected }` for Claude, `{ models, defaultModel }` for
Gemini and Kimi). An unknown `provider` gets `chat.error bad_request`.

**Slash commands.** `slash.list` re-pulls a Claude chat's live list
(`claude:refreshSlashCommands` with the chat id as scope). A logged chat uses
its logged `projectPath` and provider; an unknown chat counts as Claude with the
client's `projectPath`. Other providers get `commands: []`.

**Files.** `file.read` returns at most 25 MB (bigger: `error: "too_large"`).
- `toolImage`: `ref` is the absolute `filePath` a tool-result image carries in
  the chat. It must realpath inside `userData/tool-result-images`: `..`, a
  symlink inside the dir, or any other path gets `error: "forbidden"`. The MIME
  type comes from the extension.
- `model`: `ref` is a 3D model `versionKey` (32 hex), read from the model cache
  like `model:readCached`; the data URL is `application/octet-stream`.

**Background tasks.** While a chat is subscribed, `chat.background` carries its
background tasks: once right after the subscribe catch-up (`tasks: []` when it
has none), then on every snapshot the desktop's `claude:backgroundTasks` IPC
gets for that chat (scope = chat id). A push replaces the client's list.

**Chat-list cap.** A socket may hold 32 `chats.subscribe` projects. A 33rd
distinct project gets `chat.error bad_request` "too many chat-list
subscriptions"; re-subscribing a held project, or unsubscribing one first, is
fine.

All subscriptions end when the socket closes.

**CORS.** `POST /pair` and `GET /healthz` send `Access-Control-Allow-Origin: *`,
`Access-Control-Allow-Methods: GET, POST, OPTIONS` and
`Access-Control-Allow-Headers: content-type`; `OPTIONS` on those two paths
answers 204. No other path has CORS headers.

**Client rules** (the same as `src/hooks/useChatLog.ts`):
- A snapshot REPLACES the client's state; its `seq` becomes the client head.
- Apply an entry only when `seq === head + 1`; ignore `seq <= head` (duplicates).
- `seq > head + 1` is a gap: re-send `chat.subscribe` with `after: head`.
- A LIVE `chat.entry` that is `history_imported` at `head + 1` means the
  desktop just folded older history in front of the chat: don't apply it;
  re-subscribe with `after: 0` or with your current head (the fold's snapshot
  sits at the entry's seq, so either returns it). Inside a `chat.entries`
  catch-up batch, apply `history_imported` like any entry (the reducer treats
  it as a no-op) and don't re-subscribe: a fold that happened before the batch
  already reached you as its snapshot, and a stray entry from a fold whose
  snapshot write failed would otherwise make you re-subscribe forever.
- The snapshot holds the last 200 messages; `olderCount` is the absolute index
  of the first one. Page older messages with `chat.page` (`beforeIndex =
  olderCount`). `turn.startIndex` in a trimmed snapshot is shifted by the cut
  (clamped at 0).

**Commands.** `chat.command` runs through `ChatCommands.run`, which is
idempotent per `clientId`: a repeat (e.g. a retry after a dropped socket) acks
`duplicate: true` with the first result and has no side effect. The desktop
keeps a fixed-size in-memory ledger, so retry with the same `clientId`, and
reuse it only for the same command. Only the fields a phone may set are kept:
- `send` — `chatId`, `clientId`, `text`, `images` (data URLs, ≤ 8, ≤ 24 MB total;
  written to temp files like the v1 prompt), `now`, `provider`, `label`, and
  `projectPath` (only to create a new chat). `origin` is always `'remote'`, so
  the chat's settings are capped by the remote permission ceiling;
  `imagePaths`, `promptOverride` and `taskId` are dropped.
- `settings` — `settings` (`provider`, `model`, `permMode`, `effort`,
  `approvalMode`, `conversationMode`), capped by the remote ceiling;
  `projectPath` only to create a chat (with `settings.provider`).
- `approve` (`toolUseId`, `approved`, `modifiedCommand?`), `answer`
  (`toolUseId`, `answers`), `planReview` (`toolUseId`, `approved`),
  `interrupt`, `queueRemove` / `queuePromote` (`target` = the queued item's
  `clientId`), `queueClear`.
- `clear` — appends `cleared` (the composer's `/clear`).
- `compact` (`queue?`) — compacts the chat's context with its settings, capped
  by the remote ceiling (the desktop's `claude:compact`). Claude chats only;
  other providers ack `ok: false, error: "compact is not supported for <provider>"`.
  Like the desktop composer's `/compact`, it never bypasses the load guard:
  while paused — or, with `queue: true` (a queued send), while the chat's turn
  is live or items wait — it is logged and queued as a `/compact` send (its
  `clientId` is the command's) and drains like any send. So a phone can always
  send `compact`.
- `clientEvent` (`ev`, plus `projectPath` / `provider` only to create a chat)
  — appends an event with no backend effect: `local_note` (`noteId`,
  `content`, `error?`), `watcher_snapshot` (`messageId`, `snapshot`), or
  `user_message` with `local: true` (`clientId`, `text`; the `/help` bubble).
  Only those fields are kept, and a `user_message`'s `origin` is `'remote'`.
  Any other type, or a `user_message` without `local: true`, acks `ok: false`.
- `stopTask` (`taskId`) — stops one background task (`claude:stopTask`). Acks
  `ok: false, error: "task not stopped: <id>"` when nothing was stopped (not a
  Claude SDK chat, or the task already ended).
- An existing chat always keeps its logged `projectPath`; a phone-supplied one
  is ignored.
- Chat ids must match `^[A-Za-z0-9_-]{1,128}$` (the log's safe id shape) and
  must not be an `Object.prototype` name (`__proto__`, `constructor`, …):
  other ids get `chat.error bad_request`, or for a command an `ok: false`
  ack with `error: "invalid chatId"`.
- A malformed command acks `ok: false` with an `error`; a frame without a
  `clientId` gets `chat.error bad_request`.
- `queueRemove` acks `ok: false, error: "not queued: <id>"` when the item has
  already left the queue: treat that as "already sent or removed", not as a
  failure to retry.
- `settled` (the desktop's "IndexedDB history verified" claim) is never taken
  from a phone. A chat a phone creates is not marked imported, so the desktop still folds
  that chat's older IndexedDB history in when it next opens it (a
  `history_imported` entry follows).

**Desktop-only.** These stay on the desktop by design. A phone sees the prompts in
the state but has no command for them:
- Always-allow (`claudeAlwaysAllow`): a phone's `approve` is a plain yes/no.
  Persistent permission grants are made on the desktop.
- Sudo password replies (`claudeSudoReply`): passwords never cross the bridge.
- Codex App Server prompts (always-allow, exec-policy amendments, user-input
  requests, MCP elicitations: `pendingApproval`, `pendingCodexUserInput`,
  `pendingCodexMcpElicitation`).
- Answers to `sai_render_form`, `sai_confirm` and `sai_choose`.
- File-mode `sai-render://` renders (an Electron-only protocol): the phone
  shows an "open on desktop" note instead.
