# Mobile Remote

Bridge between the desktop SAI Electron app and a Tailscale-private PWA running on the user's phone. See `docs/superpowers/specs/2026-05-25-mobile-remote-roadmap.md`.

Modules:
- `tailnet.ts` — resolves the Tailscale IP/hostname for this host
- `pairing-store.ts` — argon2id-hashed bearer tokens, single-table sqlite
- `screenshot-urls.ts` — signed single-use URLs for binary payloads
- `session-bus.ts` — output fan-out: subscribeAll + per-topic subscribe + history
- `bridge-server.ts` — HTTP + WS, binds tailnet IP only
- `chat-v2.ts` — chat protocol v2 (below) over the durable chat log (`../chatlog/`)
- `index.ts` — RemoteModule supervisor

Tests live under `tests/unit/remote/` and `tests/integration/remote/` per SAI's vitest project layout.

## Chat protocol v2

Runs on the same `/ws` socket as v1, after the same `auth` frame (any frame
before `auth_ok`, v2 included, closes the socket with 4001). Frames whose
`type` starts with `chat.` or is `chats.list` are v2; everything else is v1 and
unchanged. Every v2 frame the desktop sends carries `v: 2`. The chat log, its
seq numbers and the reducer (`src/lib/chat/reducer.ts`) are shared with the
desktop: a client that applies the same entries ends with the same state.

Client → desktop:

| Frame | Fields |
|---|---|
| `chat.subscribe` | `chatId`, `after` (last seq the client applied; 0 = none) |
| `chat.unsubscribe` | `chatId` |
| `chats.list` | `reqId`, `projectPath` (matched by realpath, so `/home/...` and `/var/home/...` both work) |
| `chat.page` | `reqId`, `chatId`, `beforeIndex`, `limit` (≤ 200) |
| `chat.command` | `command`: a `ChatCommand` (`electron/services/chatlog/commands.ts`) |

Desktop → client:

| Frame | Fields |
|---|---|
| `chat.snapshot` | `chatId`, `seq`, `state` (a `ChatState`, last 200 messages), `olderCount` (messages cut) |
| `chat.entries` | `chatId`, `entries`: catch-up batch, contiguous from the snapshot seq (or `after`) + 1; may be empty |
| `chat.entry` | `chatId`, `entry`: one live entry |
| `chats.list.result` | `reqId`, `chats: ChatMeta[]` (newest first) |
| `chat.page.result` | `reqId`, `chatId`, `messages` (indices `[olderCount, beforeIndex)`), `olderCount` |
| `chat.ack` | `result: CommandResult` (`clientId`, `ok`, `duplicate`, `seq?`, `error?`) |
| `chat.error` | `chatId?`, `code` (`bad_request`, `unknown_chat`, `unavailable`, `read_failed`, `unknown_type`, `internal`), `message` |

**Subscribe.** The desktop attaches its live listener first (buffering), then
reads the log after `after`. It sends `chat.snapshot` when the read returns one
(the client's `after` predates the last compaction or history fold, or
`after === 0` and the chat has a snapshot), then `chat.entries`, then any
buffered live entries past what it sent, then goes live with `chat.entry`. A
client whose `after` is ahead of the log (the log was reset) gets a snapshot of
the current state. Re-subscribing replaces the previous subscription. Unknown
chats subscribe fine (empty `chat.entries`); their first entries arrive live.

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
- A chat a phone creates is not marked imported, so the desktop still folds
  that chat's older IndexedDB history in when it next opens it (a
  `history_imported` entry follows).

**Known gaps.** `approve` maps to yes/no only. Codex App Server prompts
(always-allow, exec-policy amendments, user-input requests, MCP elicitations)
are still answered from the desktop renderer directly, so a phone can see them
in the state (`pendingApproval`, `pendingCodexUserInput`,
`pendingCodexMcpElicitation`) but cannot answer them yet.
