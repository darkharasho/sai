# Live Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared Markdown canvas pane that the user and any agent provider both edit, with the user's edits sent back to the agent.

**Architecture:** Canvases are files in `<workspace>/.sai/canvas/*.md`. Main process watches that dir and pushes `{path, content}` to the renderer. A pure renderer core (block split, block 3-way merge, edit describer, store) decides attribution, merge-back, and pending updates. A `CanvasView` Code-panel tab renders blocks interactively and writes edits back. A delivery hook sends coalesced "Canvas update" messages through the existing `chatSendTextRef` (`queue: true`). A shared `CHAT_CANVAS_NUDGE` teaches every provider the convention.

**Tech Stack:** Electron 36, React, TypeScript, vitest; `mdast-util-from-markdown` + `mdast-util-gfm` + `micromark-extension-gfm` (already in node_modules transitively, promote to direct deps); existing mermaid and render sandbox.

**Spec:** `docs/superpowers/specs/2026-11-24-live-canvas-design.md`

## Global Constraints

- Canvas path: `<workspace>/.sai/canvas/<slug>.md`; any `.md` directly in that dir is a canvas. Do not auto-gitignore.
- Path comparison by realpath, never string equality (`/home/mstephens` → `/var/home/mstephens` symlink).
- `html` blocks use the existing render sandbox (`RenderedHtml`, no `allow-same-origin`).
- No new MCP tool in v1.
- Vitest: always `npx vitest run --maxWorkers=2 <path>`.
- Never `git checkout <sha>` (detached HEAD strands commits); work on branch `live-canvas`.
- Never schedule side effects inside a React state updater.

**Plan-level calls (narrowing the spec, flag in PR body):**
- Target chat = the active chat of the canvas's workspace (the one `chatSendTextRef` reaches). Seen-snapshots are still keyed per `(canvasPath, chatKey)`, so switching chats sends that chat full content first. Routing to a non-active "last-writer" chat is deferred.
- While the target chat is busy, the update is held in the canvas store, not inserted into `MessageQueue`. It flushes once the chat goes idle and the 5 s idle window has passed. This gives the same coalescing without mutating queued items.
- Agent-write attribution = "a change not written by SAI that arrived while the workspace had a live chat turn or a live background task." No tool-call path matching.
- Seen-snapshots and auto-send toggles live in memory for this version, not in settings storage. A restart costs one full-content update per canvas, which is the spec's own stated worst case.
- Constants: `CANVAS_WRITE_DEBOUNCE_MS = 400`, `CANVAS_IDLE_SEND_MS = 5000`, watcher debounce 150 ms.

## Review Focus

1. **The agent writes while a user block edit is open, then the user saves.** The user's text must win for that block. The agent's other blocks must survive. A conflict marker must appear. → Task 2 `merge keeps ours on both-changed and records conflict`, Task 6 `save during agent write merges`.
2. **SAI's own write-back fires a watcher event.** It must not count as an agent write or a user edit (self-echo loop). → Task 4 `ignores echo of own write`.
3. **The user ticks a box mid-turn, and the turn's agent rewrite drops the tick.** The tick must be merged back into the file once, with no repeat rewrite. → Task 4 `merge-back restores user tick once`.
4. **A canvas is deleted or renamed on disk while its tab is open.** The tab closes, there's no crash, and its pending update is dropped. → Task 4 `delete clears state`, Task 7 `closes tab on delete`.
5. **Malformed content** (unterminated fence, empty file, CRLF line endings) must not lose bytes: `joinBlocks(splitBlocks(x)) === x` for every input. → Task 1 `round-trips exactly` with those fixtures.

---

### Task 1: Block model (`src/canvas/canvasBlocks.ts`)

**Files:**
- Create: `src/canvas/canvasBlocks.ts`
- Modify: `package.json` (add direct deps `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm` at the versions already in `node_modules`)
- Test: `tests/unit/canvas/canvasBlocks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BlockKind = 'markdown' | 'checklist' | 'mermaid' | 'html';
  export interface CanvasBlock { index: number; kind: BlockKind; source: string; hash: string; /** html/mermaid only: first line after the fence lang, e.g. ```html id=picker */ label?: string; }
  export function splitBlocks(md: string): CanvasBlock[];
  export function joinBlocks(blocks: Pick<CanvasBlock,'source'>[]): string;
  export function replaceBlock(md: string, index: number, source: string): string;
  export function toggleTask(md: string, blockIndex: number, itemIndex: number): string;
  export function addTaskNote(md: string, blockIndex: number, itemIndex: number, note: string): string;
  export function canvasTitle(md: string, fallbackSlug: string): string;
  ```
- A block is one top-level mdast node's source slice, *including* the whitespace that follows it up to the next node, so concatenation is lossless. Leading whitespace before the first node attaches to block 0. `checklist` means a `list` node whose every item has `checked !== null`. The kind is decided by the `code` node's `lang`: `mermaid` or `html`. `hash` = a short stable string hash of `source.trim()`.
- A task note is an indented `  > note text` line under the item. `toggleTask` flips `[ ]`↔`[x]` on that item's line only.

- [ ] **Step 1: Write failing tests**
  - `round-trips exactly`: for fixtures `''`, `'# T\n\npara\n'`, `'```mermaid\ngraph TD\n'` (unterminated), `'a\r\n\r\n- [ ] x\r\n'`, and a mixed doc of heading + checklist + mermaid + html + table, assert `joinBlocks(splitBlocks(x)) === x`.
  - `classifies kinds`: the mixed doc yields kinds `['markdown','checklist','mermaid','html','markdown']`. A list with some non-task items is `'markdown'`.
  - `toggleTask flips only target`: `'- [ ] a\n- [ ] b\n'` with (0,1) → `'- [ ] a\n- [x] b\n'`.
  - `addTaskNote`: (0,0,'crashed here') on `'- [ ] a\n- [ ] b\n'` → `'- [ ] a\n  > crashed here\n- [ ] b\n'`.
  - `canvasTitle`: `'# Mod test\n…'` → `'Mod test'`; `'no heading'`, `'steps'` → `'steps'`.
  - `hash stable across trailing whitespace`: the same block with `\n` vs `\n\n\n` after it gives an equal `hash`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/unit/canvas/canvasBlocks.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement.** Use `fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })` and slice by `position.start.offset`.
- [ ] **Step 4: Run tests.** Expect PASS.
- [ ] **Step 5: Commit** `feat(canvas): markdown block model`

### Task 2: Block 3-way merge (`src/canvas/canvasMerge.ts`)

**Files:** Create `src/canvas/canvasMerge.ts`; Test `tests/unit/canvas/canvasMerge.test.ts`

**Interfaces:**
- Consumes: `splitBlocks`, `joinBlocks` (Task 1)
- Produces:
  ```ts
  export interface MergeConflict { index: number; ours: string; theirs: string; }
  export function mergeBlocks(base: string, ours: string, theirs: string): { merged: string; conflicts: MergeConflict[]; changed: boolean /* merged !== theirs */ };
  ```
- Algorithm: align the three block lists by an LCS on `hash`. For each aligned slot: unchanged on both sides → base; only ours changed → ours; only theirs changed → theirs; both changed to different text → ours plus a conflict. Inserted blocks are kept in order, theirs before ours at the same anchor. A block deleted by one side and untouched by the other is deleted. Deleted by one side and changed by the other → keep the changed one.

- [ ] **Step 1: Write failing tests**, each with base/ours/theirs strings built from 3–4 blocks:
  - `takes theirs when only agent changed` → `merged === theirs`, `changed === false`.
  - `restores user tick dropped by agent rewrite`: base has `- [ ] a`; ours has `- [x] a`; theirs keeps `- [ ] a` and edits another block → merged has `- [x] a` plus the agent's other edit, `changed === true`.
  - `merge keeps ours on both-changed and records conflict` → `conflicts.length === 1`, `conflicts[0].theirs` is the agent's text.
  - `keeps both inserts`: agent appends block X, user appends block Y → both are present, X before Y.
  - `delete vs untouched deletes`, `delete vs changed keeps changed`.
- [ ] **Step 2: Run** (expect FAIL) → **Step 3: Implement** → **Step 4: Run** (expect PASS)
- [ ] **Step 5: Commit** `feat(canvas): block-level three-way merge`

### Task 3: Edit describer + message builder (`src/canvas/canvasDiff.ts`)

**Files:** Create `src/canvas/canvasDiff.ts`; Test `tests/unit/canvas/canvasDiff.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  ```ts
  export function describeUserEdits(seen: string, current: string): string[];
  export function buildCanvasUpdateMessage(input: { relPath: string; lines: string[]; emits: { label: string; data: unknown }[]; fullContent?: string }): string;
  ```
- Line formats (exact):
  - `☑ "<item text>"`
  - `☐ "<item text>"` (unticked)
  - `+ item "<text>"`
  - `− item "<text>"`
  - `note on "<item text>": <note>`
  - `diagram "<label or 'block N'>": edited`
  - `edited block N: <first 80 chars of new text, one line>`
  - `+ block N: <first 80 chars>`
  - `− block N`
- Message format (exact):
  ```
  [Canvas update] .sai/canvas/<file>.md
  The user edited the canvas:
  - <line>
  ...
  Re-read the file for full context.
  ```
  `emits` append as `- html "<label>" sent: <JSON, max 500 chars>`. With `fullContent`, replace the bullet list with `The user is sharing this canvas with you (current content below).\n\n` + the content fenced in a ` ```markdown ` block. That message is used for a chat's first update for a canvas.

- [ ] **Step 1: Failing tests**:
  - `ticks`: seen `'- [ ] Load save\n'`, current `'- [x] Load save\n'` → `['☑ "Load save"']`.
  - `note`: a `> crashed here` note added → `['note on "Open shop": crashed here']`.
  - `mermaid edit` gives a `diagram` line; `paragraph edit` gives an `edited block` line.
  - `no change` → `[]`.
  - The message builder's exact output for one line, for one emit, and for full-content mode.
- [ ] **Step 2–4:** Run (expect FAIL), implement, run (expect PASS).
- [ ] **Step 5: Commit** `feat(canvas): describe user edits for the agent`

### Task 4: Canvas store (`src/canvas/canvasStore.ts`)

The single owner of attribution, merge-back, seen-snapshots, and pending updates. It is pure apart from its injected I/O.

**Files:** Create `src/canvas/canvasStore.ts`; Test `tests/unit/canvas/canvasStore.test.ts`

**Interfaces:**
- Consumes: `mergeBlocks` (Task 2), `describeUserEdits` (Task 3)
- Produces:
  ```ts
  export interface CanvasStoreDeps { writeFile(path: string, content: string): Promise<void>; now(): number; }
  export interface CanvasState { path: string; content: string; lastEditor: 'user' | 'agent'; lastEditedAt: number; conflicts: MergeConflict[]; autoSend: boolean; }
  export function createCanvasStore(deps: CanvasStoreDeps): {
    subscribe(fn: () => void): () => void;
    get(path: string): CanvasState | undefined;
    list(): CanvasState[];
    /** Watcher event. agentLive = workspace has a live chat turn or background task. */
    onDiskChange(path: string, content: string | null, agentLive: boolean): Promise<void>;
    /** User edit from the pane; writes the file (caller debounces). */
    userWrite(path: string, content: string): Promise<void>;
    userEmit(path: string, label: string, data: unknown): void;
    setAutoSend(path: string, on: boolean): void;
    resolveConflict(path: string, index: number, take: 'ours' | 'theirs'): Promise<void>;
    /** Pending message for chatKey, or null if nothing to send. Does not mark seen. */
    pendingMessage(path: string, chatKey: string): string | null;
    /** Marks the current content (+ emits) as seen by chatKey. */
    markDelivered(path: string, chatKey: string): void;
    hasPending(path: string, chatKey: string): boolean;
    /** Paths whose last change was an agent write not yet auto-opened. Clears them. */
    takeAgentTouched(): string[];
  };
  ```
- Rules:
  - SAI tracks `lastSaiWrite` content per path. A disk change equal to it is an echo: ignore it.
  - A change not from SAI with `agentLive` is an **agent write**:
    - Run `mergeBlocks(agentBase, userContent, disk)`. `agentBase` is the content at the previous agent write or delivery. `userContent` is the latest user-written content.
    - If `changed`, write `merged` back once and record it as `lastSaiWrite`.
    - Store `conflicts`. Advance every chat's seen-snapshot over the agent's own blocks: set seen to `mergeBlocks(seen, seen, disk).merged`, so agent edits never show up as user edits.
  - A change not from SAI without `agentLive` is a **user edit** (vim, git).
  - `content === null` is a delete: drop all state for that path.
  - `pendingMessage`: if `chatKey` has no seen-snapshot, return `buildCanvasUpdateMessage({fullContent})`. Otherwise use `describeUserEdits(seen, content)` + emits. If both are empty, return `null`.
- Persistence is deferred: seen-snapshots and auto-send live in memory per app run. Losing them only costs one full-content update, and the spec permits that.

- [ ] **Step 1: Failing tests** (fake deps recording writes):
  - `ignores echo of own write`: `userWrite(p,'A')`, then `onDiskChange(p,'A',true)` → no extra `writeFile`, `lastEditor === 'user'`.
  - `merge-back restores user tick once`: seen `- [ ] a\n\nx\n` delivered to chat `c`. The user ticks it. The agent writes `- [ ] a\n\ny\n` with agentLive → exactly one `writeFile` containing `- [x] a` and `y`. Feeding that write back as a disk change produces no further write.
  - `agent edits never pending`: after delivery, an agent-only change → `pendingMessage(p,'c') === null`.
  - `external edit without agent is user`: `onDiskChange(p, ticked, false)` → `pendingMessage` contains `☑`.
  - `first message to new chat is full content`: `pendingMessage(p,'other')` contains `current content below`.
  - `delete clears state`: `onDiskChange(p,null,false)` → `get(p) === undefined`, `hasPending` false.
  - `emits included then cleared by markDelivered`.
- [ ] **Step 2–4:** Run (expect FAIL), implement, run (expect PASS).
- [ ] **Step 5: Commit** `feat(canvas): store with attribution and merge-back`

### Task 5: Watcher IPC (`electron/services/canvasWatch.ts`)

**Files:**
- Create: `electron/services/canvasWatch.ts`
- Modify: `electron/services/fs.ts` (register handlers next to `fs:watchFile`, ~line 133), `electron/preload.ts` (~line 255)
- Test: `tests/unit/electron/canvasWatch.test.ts`

**Interfaces:**
- Produces (preload):
  ```ts
  canvasWatch: (projectPath: string) => Promise<void>;
  canvasUnwatch: (projectPath: string) => Promise<void>;
  onCanvasChanged: (cb: (e: { projectPath: string; path: string; content: string | null }) => void) => () => void; // channel 'canvas:changed'
  canvasList: (projectPath: string) => Promise<{ path: string; content: string }[]>;
  ```
- Main side: `createCanvasWatcher(emit, { debounceMs = 150 })` with `watch(projectPath)` and `unwatch(projectPath)`. Ref-count per realpath'd project. Only `*.md` files directly in `.sai/canvas` count. Emit content `null` when the file is gone.
  - If `.sai/canvas` is missing: watch the project root (non-recursive) for `.sai`, then `.sai` for `canvas`, then attach the canvas watcher. Never create the dir.
  - Dispose watchers per sender, the same way `createSenderWatches` does.

- [ ] **Step 1: Failing tests** (tmp dir, real fs):
  - `emits on create/modify/delete` of `.sai/canvas/a.md`.
  - `ignores non-md and nested files`.
  - `picks up dir created after watch`: `watch()` on a project with no `.sai`, then mkdir + write → event received.
  - `unwatch stops events`.
  - Wait for events with `vi.waitFor`, never fixed sleeps.
- [ ] **Step 2–4:** Run (expect FAIL), implement, run (expect PASS).
- [ ] **Step 5: Commit** `feat(canvas): watch .sai/canvas and expose IPC`

### Task 6: `CanvasView` component + HTML emit bridge

**Files:**
- Create: `src/components/Canvas/CanvasView.tsx`, `src/components/Canvas/CanvasBlockEditor.tsx`, `src/components/Canvas/canvas.css`
- Modify: `src/components/Chat/RenderToolCard.tsx`
  - Export `MermaidRender` and `RenderedHtml`.
  - Add an `onEmit?: (data: unknown) => void` prop to `RenderedHtml`. When set, inject `window.sai={canvas:{emit:function(d){parent.postMessage({__saiCanvasEmit:1,data:d},'*')}}}`. Validate the sender by `event.source`, exactly as `SUBMIT_BRIDGE` does.
- Test: `tests/unit/components/CanvasView.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers; store API (Task 4)
- Produces:
  ```ts
  export default function CanvasView(props: { path: string; store: ReturnType<typeof createCanvasStore>; agentStatus: 'idle' | 'busy'; sendIn: number | null; onSendNow(): void; onHoldToggle(): void; onOpenSource(): void; onOpenCanvas(path: string): void }): JSX.Element;
  ```
- Behavior:
  - **Header:** title (`canvasTitle`), `last edited by you/agent · <relative time>`, a sync pill, a "Source" button that calls `onOpenSource`, and a "Canvases" dropdown listing `store.list()` titles; picking one opens it via `onOpenCanvas(path)`.
    - Pill text when `sendIn` is set: `Sending to agent in {n}s · Send now · Hold`.
    - With pending changes while the agent is busy: `Will send when agent is free`.
    - With auto-send off: `Held · Send`.
  - **Blocks:**
    - Markdown renders via the existing react-markdown + remark-gfm + rehype-highlight setup.
    - Checklist items get real checkboxes (`toggleTask`) and an "add note" affordance (`addTaskNote`).
    - Mermaid blocks use `MermaidRender`. HTML blocks use `RenderedHtml` with `onEmit → store.userEmit`.
  - **Block editing:** clicking a block's edit icon opens `CanvasBlockEditor` (a textarea, with a live preview for mermaid). Commit → `replaceBlock` → debounced (`400` ms) `store.userWrite`.
  - **Incoming changes:** the open editor keeps its draft. Its base is the content when editing started. On commit, write `mergeBlocks(base, draftDoc, current).merged`.
  - **Conflicts:** blocks with a conflict show `Agent also changed this · View agent version`, with buttons "Keep mine" and "Use agent's" (`resolveConflict`).

- [ ] **Step 1: Failing tests** (jsdom, fake store):
  - `renders checklist and toggles` → `userWrite` is called with `- [x]` after 400 ms (fake timers).
  - `save during agent write merges`: open the editor on block 2, have the store change block 0 externally, commit → the written content has both changes.
  - `shows conflict actions` → clicking "Use agent's" calls `resolveConflict(p, i, 'theirs')`.
  - `pill text` for each of the three states.
  - `html emit reaches store` (dispatch a message event whose `source` is the iframe's `contentWindow`).
- [ ] **Step 2–4:** Run (expect FAIL), implement, run (expect PASS).
- [ ] **Step 5: Commit** `feat(canvas): interactive canvas view`

### Task 7: Wiring — Code panel tab, auto-open, delivery

**Files:**
- Create: `src/canvas/useCanvasDelivery.ts`, `src/canvas/canvasFiles.ts`, `src/canvas/CanvasContext.tsx`
- Modify:
  - `src/components/CodePanel/CodePanel.tsx` (~line 332): add an `isCanvasFile(activeFile.path)` branch before the model branch. Render `CanvasView` when `!activeFile.canvasSource`.
  - `src/types.ts` `OpenFile`: add `canvasSource?: boolean`.
  - `src/App.tsx`:
    - Create one store per workspace inside `CanvasContext`.
    - On the active workspace, subscribe `canvasWatch` + `onCanvasChanged`. Compute `agentLive` as `chatStreamingWorkspaces.has(ws) || liveBackgroundTaskCount > 0`.
    - After each change, call `store.takeAgentTouched()` and pass each path to `handleFileOpen`. Skip this when the focused element is an editor/textarea outside the canvas.
    - Mount `useCanvasDelivery`.
- Test: `tests/unit/canvas/useCanvasDelivery.test.ts`, `tests/unit/canvas/canvasFiles.test.ts`

**Interfaces:**
- `canvasFiles.ts`:
  - `export function isCanvasFile(absPath: string): boolean` matches `/.sai/canvas/<name>.md` with no deeper nesting.
  - `export function canvasRelPath(projectPath: string, absPath: string): string` uses realpath-normalized prefixes; pass both spellings in the tests.
- `useCanvasDelivery(opts: { store; chatKey: string | null; chatBusy: boolean; send: ((text: string) => void) | null; lastUserEditAt: number })` returns `{ sendIn: number | null; sendNow(path: string): void }`.
  - It sends when `!chatBusy`, auto-send is on, and `now - lastUserEditAt >= 5000`, one message per canvas: `send(store.pendingMessage(...))`, then `markDelivered`.
  - `chatKey` = the active chat's session id (falling back to the scope string). `send` = `chatSendTextRef.current`.
  - Timers live in effects, never in state updaters.
- On the `canvas:changed` delete event, close any open tab for that path.

- [ ] **Step 1: Failing tests**:
  - `isCanvasFile` true/false cases, including nested and non-md paths.
  - `canvasRelPath` with a `/home` vs `/var/home` pair.
  - `waits 5s idle then sends once`.
  - `holds while busy, sends after idle`.
  - `hold toggle suppresses auto-send; sendNow sends immediately`.
  - `no send when pendingMessage null`.
  - `closes tab on delete` (test the App helper that maps a delete event to `openFiles` removal, extracted as a pure function in `canvasFiles.ts`: `export function closeDeletedCanvas(openFiles: OpenFile[], path: string): OpenFile[]`).
- [ ] **Step 2–4:** Run (expect FAIL), implement, run (expect PASS).
- [ ] **Step 5: Typecheck** `npx tsc --noEmit -p .`. Expect no errors.
- [ ] **Step 6: Commit** `feat(canvas): open canvases as tabs and deliver user edits`

### Task 8: Agent guidance for every provider

**Files:**
- Modify:
  - `electron/services/chatNudges.ts`: add `export const CHAT_CANVAS_NUDGE`.
  - `electron/services/claude.ts` (~line 290): push it.
  - `electron/services/claudeBackend/sdkBackend.ts` (~line 1221): add it to `nudges`.
  - `electron/services/codexBackend/chatMcpConfig.ts` (~line 37): add it to `developer_instructions`.
  - ACP: append it to the text returned by `buildProjectBootstrap` in `electron/services/acpProvider.ts`.
- Test: extend the existing tests for those builders (grep `CHAT_RENDER_NUDGE` under `tests/`) with `includes canvas nudge`.

**Nudge copy (exact):**
```
SAI canvases: for anything the user will act on, revisit, or co-edit — step-by-step instructions they must perform (e.g. manual testing steps), plans, checklists, evolving diagrams — write a Markdown file at .sai/canvas/<short-slug>.md in the project instead of a one-shot render. It opens live beside the chat. Use GFM task lists (- [ ]) for steps, ```mermaid fences for diagrams, and ```html fences for small interactive widgets (they may call sai.canvas.emit(data) to send you an event). The user edits canvases directly; their changes arrive as messages starting with "[Canvas update]". When you get one, re-read the file before editing it, and keep the user's ticks and notes intact.
```

- [ ] **Step 1: Failing tests** (`includes canvas nudge` for each of the 4 providers).
- [ ] **Step 2–4:** Run (expect FAIL), implement, run (expect PASS).
- [ ] **Step 5: Commit** `feat(canvas): teach every provider about canvases`

### Task 9: End-to-end verification

**Files:** Test `tests/e2e/canvas.spec.ts`. Follow the existing e2e mock pattern, and mock the What's New version so the overlay doesn't block clicks.

- [ ] **Step 1: Write the e2e test.**
  - Write `.sai/canvas/steps.md` with `- [ ] Launch game` while the mocked chat is streaming → a canvas tab opens.
  - Click the checkbox → the file on disk contains `- [x] Launch game`.
  - End the mocked turn, advance 5 s → the mocked chat send receives a message starting with `[Canvas update] .sai/canvas/steps.md`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/canvas.spec.ts`. Expect PASS.
- [ ] **Step 3: Run the full unit suite** `npx vitest run --maxWorkers=2`. Expect PASS.
- [ ] **Step 4: Live dogfood** with `/run`.
  - Ask the agent: "make me a canvas checklist for testing the shop mod."
  - Tick an item mid-turn and confirm it survives the agent's next write.
  - Edit a mermaid block and confirm the agent receives the update.
- [ ] **Step 5: Commit** `test(canvas): e2e flow`
