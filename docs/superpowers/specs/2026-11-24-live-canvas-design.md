# Live Canvas — Design

Status: draft for approval · 2026-11-24

## Intent

A persistent, shared surface beside the chat that the user and the agent both
edit during a session. Today every SAI render (`sai_render_html`, `_mermaid`,
`_form`, …) is a one-shot card: it scrolls away, the agent can't revise it in
place, and nothing the user does on it reaches the agent unless a form is
blocking. The canvas fixes that: one living document per topic, edited by both
sides, with the user's edits flowing back to the agent.

Motivating uses (the user's examples, not the scope): a live checklist of
manual steps for game-mod testing ("launch, load save, open shop" — the user
ticks them off or flags "crashed here"), and diagrams that evolve with a
design. The feature must be general-purpose: notes, plans, tables, checklists,
diagrams, small custom widgets.

## Goals

- A canvas stays open and current across turns; agent edits appear live.
- The user edits in place (tick items, edit text, edit diagrams) and the agent
  learns about those edits without the user retyping them in chat.
- Works identically for every provider SAI drives (Claude SDK, Codex, Gemini,
  Kimi).
- Canvases survive restarts and are plain files the user can grep, diff, or
  commit.

## Non-goals (v1)

- Infinite whiteboard / freehand drawing / drag-to-edit diagram nodes.
- Real-time character-level co-editing (CRDT/OT).
- Canvas on the iOS app.
- Multiple users.

## Anti-goals (failure even if it "works")

- Every checkbox tick spawning its own agent turn (token burn, chat spam).
- The agent's own edits echoing back to it as "user changed the canvas".
- User edits silently lost when the agent writes the file at the same time.
- A canvas that only Claude can use.

## Approaches considered

- **A. File-backed Markdown canvas (CHOSEN).** Each canvas is a Markdown file;
  the agent edits with its normal file tools; SAI watches the file, renders it
  interactively, writes user edits back, and sends the agent a diff of what the
  user changed. Provider-agnostic, persistent, git-able. Limited by Markdown's
  expressiveness — mitigated by an embedded `html` block escape hatch.
- **B. Structured block document + `canvas_*` MCP tools.** Precise per-block
  events, but SAI owns a new document format and store, every provider needs the
  tools wired, and content is locked inside SAI.
- **C. Freeform HTML app pane.** Maximally flexible, but the agent rebuilds UI
  per task, state lives in the DOM, and user edits aren't structured enough to
  report back cleanly.

The user picked A. A's `html` block covers C's main advantage; B's precise
events are mostly recoverable by diffing at block granularity.

## Design

### Files

- Location: `<workspace>/.sai/canvas/<slug>.md`. Any `.md` under that dir is a
  canvas. *(Builder's call: not auto-gitignored — the user decides.)*
- Plain GFM Markdown. No front-matter required; an optional first `# Heading`
  is the canvas title (falls back to the slug).

### Block types (rendered interactively)

| Markdown | Renders as | User can |
|---|---|---|
| Paragraphs, headings, lists, tables, code | Standard rendered Markdown (reuse `MarkdownPreview` pipeline: react-markdown + remark-gfm + rehype-highlight) | Click a block to edit its source inline |
| `- [ ]` / `- [x]` task items | Checklist | Toggle checkbox (writes the file), add a note under an item, add/remove items |
| ` ```mermaid ` fence | Live diagram (reuse the existing mermaid renderer used by render cards) | Edit source with live preview |
| ` ```html ` fence | Sandboxed iframe, same sandbox as `sai_render_html` | Interact; the iframe can call `sai.canvas.emit(data)` to report an event to the agent |

"Block" = a top-level Markdown node (by mdast position). Block identity for
diffs = its index + a content hash; good enough for a human-scale doc.

### The pane

- A canvas opens as a tab in the Code panel, the same way model files get
  their own view (`CodePanel.tsx` branches on `isModelFile`; add an
  `isCanvasFile` branch). A toggle switches to raw Monaco source.
- Auto-open: when a canvas file is created or modified by the agent in the
  current workspace, SAI opens/focuses its tab (once per canvas per session;
  never steals focus while the user is typing in another editor tab).
- Header shows title, "last edited by you / agent · time", and the
  agent-sync control (below).

### Live sync

- Main process watches `.sai/canvas/` via the existing `fileWatch` registry
  (directory-level, debounced). Changes push to the renderer, which re-renders
  without losing scroll position or an in-progress inline edit.
- User edits write back to the file, debounced ~400 ms.
- Concurrency: SAI keeps a *base* (last content it synced). On an external
  change while the user has an unsaved block edit, do a block-level 3-way merge:
  blocks only the agent changed take the agent's version, blocks only the user
  changed keep the user's, a block both changed keeps the user's text and shows
  a small "agent also changed this" marker with the agent's version one click
  away. Never drop either side silently.
- Agent overwrites saved-but-unseen user edits (user's decision: **put them
  back**). After every agent write, SAI 3-way merges at block level. The base
  is that chat's seen-snapshot, "ours" is the user's saved content, "theirs"
  is the agent's write. User blocks the agent never meant to change are written
  back into the file. That merged write counts as the agent's write (it
  advances the seen-snapshot and doesn't echo back). The user edits still go
  out in the next canvas update as normal. If the agent's next `Edit` fails
  because the file changed under it, that's acceptable: it re-reads and
  carries on.

### Telling the agent (the collaborative part)

- SAI tracks, per canvas, the content the agent has *seen*. It advances when the
  agent writes the file (detected as a watcher change that arrives while that
  chat's turn is running and matches a Write/Edit tool call on that path) or
  when a canvas update message is delivered. So the agent's own edits never
  echo back.
- User edits accumulate into a pending update: a compact, human-readable diff
  per changed block (e.g. `☑ "Load a save"`, `note on "Open shop": crashed
  here`, `diagram "Flow": edited`, `html "picker" emitted {...}`), plus the
  canvas path.
- Delivery (builder's call on exact numbers):
  - Agent busy → the update joins the existing message queue (`MessageQueue`)
    as one coalesced "Canvas update" item that keeps updating until sent.
  - Agent idle → after the user stops editing the canvas for ~5 s, it sends as
    a turn. A pill in the canvas header shows "Sending canvas update in 4s ·
    Send now · Hold".
  - Per-canvas toggle: **Auto-send** (default) / **Hold** (accumulate until the
    user hits Send or next chats normally — then it's prepended to their
    message).
- Target chat: the chat that most recently wrote or was sent this canvas;
  if none, the active chat in the workspace.
- *(Builder's call)* The seen-snapshot is keyed per **(canvas, chat)**, not
  per canvas. The first update a chat receives for a canvas carries the full
  content, not a diff.
- *(Builder's call)* Attributing changes SAI didn't make itself:
  - Writes from SAI's canvas pane or its raw Monaco view count as **user**.
  - A change outside SAI that lands while an agent turn or background task is
    live in that workspace counts as **agent** and is absorbed silently. This
    covers Codex/Gemini/Kimi writing through shell, and subagents.
  - Any other change outside SAI (vim, git pull) counts as **user** and is
    reported.
  - Erring toward "agent" while work is live means an occasional missed report
    rather than an echo.

### Agent awareness

- Append a short block to the agent's system guidance (where SAI already adds
  render-tool guidance), for every provider: what canvases are, the path
  convention, the block types, that the user edits them and updates arrive as
  "Canvas update" messages, and when to prefer a canvas over a one-shot render
  (anything the user will act on, revisit, or co-edit — step lists, plans,
  evolving diagrams).
- Canvas update messages always restate the path so the agent can re-read the
  file for full context.

### Persistence and lifecycle

- The file is the state. Seen-snapshots and auto-send toggles persist per
  workspace in existing settings storage; losing them only means one redundant
  update.
- Deleting a canvas file closes its tab. A small "Canvases" list (in the Code
  panel tab bar overflow or file explorer filter) lets the user reopen them.

## Constraints

- Paths: compare via realpath (symlinked home: `/home` vs `/var/home`).
- `html` blocks reuse the existing render sandbox and allowed-roots rules.
- Synthetic turns must follow existing turnSeq / completion invariants (no
  false "finished" flashes; see notes in memory on superseded turns).
- No new MCP tool is required for v1. *(Optional later: `sai_canvas_open` to
  focus a canvas explicitly.)*
- Vitest with `--maxWorkers=2`.

## Left to the builder

- Exact debounce/idle timings, header styling, the Canvases list placement.
- Inline block editor implementation (textarea vs mini-Monaco).
- How agent writes are attributed (tool-call path match vs timing window),
  as long as the "no echo" anti-goal holds.
