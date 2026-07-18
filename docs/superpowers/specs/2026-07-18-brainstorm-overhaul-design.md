# Brainstorm-a-New-Project Overhaul — Design

**Date:** 2026-07-18
**Status:** Approved design, pending implementation plan

## Problem

The current brainstorm flow (Brainstorm tab in `NewProjectModal`) has three structural failures:

1. **It never converges.** The system prompt (`electron/services/brainstorm.ts:76`) tells the
   model to "explore feasibility, surface trade-offs, ask about constraints" and never
   instructs it to wrap up. There is no readiness signal and no question budget, so the model
   refines indefinitely.
2. **"Use this" almost always fails.** The system prompt explicitly forbids emitting JSON
   ("Even if the user asks you to summarize or wrap up… Do not emit JSON"), yet the synthesize
   step keeps that system prompt active and demands JSON-only output. The contradictory
   instructions plus regex/JSON.parse scraping of raw text (`parseSynthesizeOutput`,
   `brainstorm.ts:41-74`) make synthesis unreliable by design. The flow also still spawns the
   `claude` CLI per turn — it predates the SDK cutover.
3. **The UI is finicky.** A cramped modal with a Setup/Brainstorm tab split, results that
   teleport to a form tab, a "Replace both / Name only / Context only / Keep mine" prompt,
   and a "Use this →" button that morphs into "Use this anyway →".

## Goals

- The brainstorm conversation drives itself toward a **project brief** (not just name +
   context) within a bounded number of questions.
- Creating the project from the brief is **deterministic** — no model call, no parsing, no
  failure mode at create time.
- After creation, the brief **kicks off the dev cycle automatically**: the new project opens
  with its first chat session already working from the brief.
- The UI becomes a **full-window two-pane surface**: conversation left, live brief right, one
  primary Create action.

## Non-goals

- Persisting half-finished brainstorms across app restarts (v1 discards on close, with a
  confirm if the brief has content).
- Reusing ChatPanel/SdkBackend wholesale for the brainstorm session (considered and
  rejected: drags in tools/permissions/chat-state complexity for no gain).
- Any change to the manual Setup path fields themselves (parent dir, git/CLAUDE.md/README/
  GitHub toggles keep their semantics; only their presentation moves).

## Architecture

### Backend: SDK-based brief-building service

Rewrite `electron/services/brainstorm.ts` on `@anthropic-ai/claude-agent-sdk` (`query()`),
removing the per-turn `claude` CLI spawning. Delete outright: `SYNTHESIZE_PROMPT`,
`SYNTHESIZE_PROMPT_FORCE`, `parseSynthesizeOutput`, the `NEED_MORE` protocol, and the
transcript-rollback trick.

**The brief is built during the conversation, not extracted afterward.** The session exposes
one in-process MCP tool, `update_brief`, which the model is instructed to call after every
user reply with whatever it has learned. The service validates each call against the schema,
merges it into a single brief object held in the main process, and pushes the updated brief
to the renderer over IPC (`brainstorm:brief` event).

**Brief schema:**

| Field | Type | Notes |
|---|---|---|
| `projectName` | string | kebab-case, ≤ 40 chars — **required for Create** |
| `summary` | string | 2–4 sentences, CLAUDE.md-ready — **required for Create** |
| `goals` | string[] | what it should do |
| `nonGoals` | string[] | explicitly out of scope |
| `stack` | {name, rationale}[] | suggested technologies, one-line rationale each |
| `openQuestions` | string[] | intentionally undecided items |
| `ready` | boolean | model sets true when it judges the brief complete |

Validation failures return an error to the model through the tool result; the model corrects
on its own. The user never sees a parse error.

**Convergence prompt.** The new system prompt instructs the model to:

- ask **one question per turn, at most five total**, prioritized by what the brief is missing
  (purpose → users → scope → stack);
- call `update_brief` after every user message;
- once name + summary + goals are covered, present the draft brief in prose, set
  `ready: true`, and stop asking — subsequent turns only refine;
- never block creation — refinement is optional once the draft exists.

The old "never emit JSON" rule is gone along with the synthesize step, so no contradictory
instruction remains.

**Create is a read, not a request.** The Create action reads the current brief object from
the main process. Enabled when `projectName` + `summary` exist (early bail-out with a thin
brief is allowed); visually "recommended" (gold glow + Ready pill) when `ready` is true.
Zero model involvement at create time.

### Frontend: full-window two-pane takeover

`NewProjectModal` is replaced by a full-window takeover surface (mockup approved 2026-07-18;
palette/idiom follow `src/styles/globals.css`).

- **Header:** "New Project" + subtitle "brainstorm → brief → create", close (✕).
- **Left pane — conversation** (~58% width): roomy chat at 13.5px, user/assistant avatars,
  the model's single question per turn set off as a gold-left-border callout, a quiet status
  line under the latest reply ("brief updated · 2 questions asked of 5 max") exposing the
  budget, composer at the bottom.
- **Right pane — live brief** (380–480px): sections for Name, Summary, Goals, Out of scope,
  Suggested stack (tag chips), Open questions (dashed cards — visibly unresolved, not
  blocking). Sections animate in as `update_brief` calls land; a "Ready" pill appears when
  `ready` flips true. **Every brief field is click-to-edit** — the panel is the form, which
  is what removes the old Setup-tab teleport and the replace-prompt dialog. Edit conflicts
  resolve last-writer-wins: a user edit updates the brief immediately and is injected into
  the conversation context on the next turn (so the model builds on it rather than
  reverting it); later `update_brief` calls apply normally.
- **Bottom-right:** a one-line collapsible "Setup options" disclosure (parent dir + Browse,
  git/CLAUDE.md/.gitignore/README/settings/GitHub toggles — summary line when collapsed),
  then the **Create project** button, then a hint line ("Creates the folder, seeds the first
  chat with this brief, and starts building").

Removed UI: Setup/Brainstorm tabs, the replace-prompt modal, "Use this →" / "Use this
anyway →", the small red synthesize-error strings.

### Handoff: brief → scaffold → first session

`electron/services/scaffold.ts` accepts the full brief:

- **CLAUDE.md** gains a Project Context section from `summary`, plus Goals / Out of scope /
  Suggested stack sections generated from the brief fields.
- **`.sai/brainstorm-seed.md`** becomes the full brief as markdown, plus open questions and
  the conversation transcript.
- **Auto-kickoff:** on scaffold success, SAI opens the new project and automatically starts
  the first chat session with a kickoff turn: read the seed, propose an implementation plan,
  flag the open questions. The existing one-shot seed-consumption rail in
  `src/components/Chat/ChatPanel.tsx` is reused; the change is that the first turn fires
  automatically instead of waiting for the user to type.

## Error handling

- **Invalid `update_brief` call:** schema error returned to the model via the tool result;
  self-corrects. Worst case a field updates one turn late.
- **SDK/auth/stream failure mid-conversation:** inline error card in the chat pane with
  Retry. Brief state lives in the main process and survives.
- **Scaffold failure** (directory exists, permissions, GitHub): surfaced in the setup
  disclosure area; brief and conversation remain intact, user fixes the path/toggles and
  retries Create.
- **Close mid-brainstorm:** confirm prompt if the brief has content; otherwise close
  silently. No cross-restart persistence in v1.

## Testing

- **Unit:** brief merge/validation logic (schema acceptance, kebab/length constraints,
  partial merges, `ready` transitions).
- **Service:** brainstorm service with a mocked SDK stream — tool calls become brief
  updates + IPC events; Create requires no model round-trip; error paths (invalid tool
  args, stream failure) behave as specified.
- **E2E:** one flow over the takeover — converse, brief fills, Create, project scaffolded,
  `.sai/brainstorm-seed.md` contains the brief, first-session kickoff fires. (Mind the
  What's New overlay: e2e mock must return the real package.json version.)
- Vitest runs with `--maxWorkers=2` per global config.

## Key files

| File | Change |
|---|---|
| `electron/services/brainstorm.ts` | rewrite on SDK + `update_brief` tool; delete synthesize/parse/NEED_MORE |
| `electron/services/scaffold.ts` | accept full brief; richer CLAUDE.md + seed; kickoff signal |
| `electron/preload.ts` | brainstorm IPC surface: brief-update event, create-from-brief |
| `src/components/NewProjectModal.tsx` + `NewProjectModal/*` | replaced by two-pane takeover components |
| `src/components/Chat/ChatPanel.tsx` | auto-fire kickoff turn when a fresh seed exists |
