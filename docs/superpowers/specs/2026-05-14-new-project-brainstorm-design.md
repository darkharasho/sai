# New Project: Brainstorm Tab — Design

**Date:** 2026-05-14
**Status:** Approved (pending implementation plan)

## Summary

Add an optional **Brainstorm** tab to the existing `NewProjectModal`. Users can chat with an AI about feasibility, options, and constraints before committing to a project folder, scaffolding, and GitHub repo. When the user is satisfied, the brainstorm synthesizes a project name and context summary that prefill the existing Setup tab fields. The full transcript travels through scaffolding and seeds the first chat message in the newly-opened project.

## Goals

- Let users explore a project idea conversationally before scaffolding anything.
- Make the handoff to project creation a single explicit action ("Use this →").
- Preserve continuity: the new project's first chat is seeded with the brainstorm summary plus the full transcript as referenceable context.
- Add no friction for users who don't want to brainstorm — the Setup tab remains the default and is unchanged.

## Non-Goals

- No persistence of brainstorm sessions across modal close. Brainstorms are ephemeral until committed.
- No automatic toggling of setup helpers (Git init, GitHub repo, etc.) based on conversation content. Helpers remain user-controlled.
- No tool use during brainstorm. The AI cannot read files, run commands, or touch the filesystem.
- No telemetry.

## UI

### Tab Structure

`NewProjectModal` gains a tab bar at the top with two tabs:

- **Setup** — the existing form (default tab).
- **Brainstorm** — the new chat interface.

A small "🧠 Brainstorm first" link sits next to the modal title for one-click access to the Brainstorm tab.

### Brainstorm Tab

- Scrollable transcript area with user/AI bubbles, matching the main chat panel's visual language.
- Multi-line input + Send button at the bottom.
- The modal footer's primary action becomes **"Use this →"** while on the Brainstorm tab (replacing "Create Project"). Disabled until at least one AI reply exists.

### Setup Tab (changes)

- Project name and Context fields show a subtle "✨ from brainstorm" badge when prefilled by synthesis. Badge clears the moment the user edits that field.
- A hidden state `brainstormTranscript: string` is carried with the modal so it can be passed to `scaffoldProject` on submit.

## AI Backend

Reuses the existing Claude Code chat pipeline via a tailored system prompt. No tool use, no working directory binding.

### IPC Channels

- `brainstormStart()` → `{ sessionId: string }`. Spawns a `claude` process with the brainstorm system prompt. Tool use disabled.
- `brainstormSend(sessionId, message)` → streams assistant tokens via event channel `brainstorm:chunk:<sessionId>`; emits `brainstorm:done:<sessionId>` when complete.
- `brainstormSynthesize(sessionId)` → asks the same session to emit strict JSON `{ projectName, context }`. Returns parsed result or throws on parse failure.
- `brainstormEnd(sessionId)` → kills the process and removes listeners.

### System Prompt

> You are helping the user think through a brand-new software project before they create the folder and scaffolding. Your job is to explore feasibility, surface trade-offs, ask about constraints, and propose options. Keep responses concise and conversational. Do NOT produce code or file structures. When asked to synthesize, output strict JSON with `projectName` (kebab-case, ≤ 40 chars) and `context` (2–4 sentence summary suitable for a CLAUDE.md "Project Context" section).

### Lifecycle

- Session starts lazily on the user's first message (not on tab open — avoids spawning a process for users who only peek at the tab).
- Session ends on:
  - Modal close.
  - Successful project creation.
  - "Use this →" followed by Create on the Setup tab.

## Synthesize → Prefill Flow

When the user clicks **"Use this →"**:

1. Disable the button; show inline "Synthesizing…".
2. Call `brainstormSynthesize(sessionId)`.
3. On parse failure (malformed JSON, empty fields): show inline error "Couldn't summarize — try sending one more message clarifying the goal" and stay on the Brainstorm tab.
4. On success:
   - Set `projectName` state — **only if currently empty**. Never silently overwrite user-typed input.
   - Set `context` state — same rule.
   - Stash full transcript in `brainstormTranscript` state.
   - Switch active tab to **Setup**.
   - Show "✨ from brainstorm" badge next to prefilled fields.

### Already-Filled Fields

If the user typed a project name or context before clicking "Use this →", the synthesized values for those fields are offered via an inline "Replace?" prompt next to the field instead of silently overwriting.

## Scaffold Handoff & First Conversation Seed

### `scaffoldProject` Changes

`electron/services/scaffold.ts`:

- Add optional `brainstormTranscript?: string` to `ScaffoldProjectOptions`.
- After scaffolding succeeds, if a transcript is provided:
  - Write `<projectPath>/.sai/brainstorm-seed.md` with the content:

    ```
    # Seed message (synthesized)
    <context summary>

    <brainstorm-transcript>
    <full transcript, role-tagged>
    </brainstorm-transcript>
    ```

  - If `.gitignore` is being generated, include `.sai/` in it. If `.gitignore` already exists, append `.sai/` only if it is not already present.

### First-Message Seeding on Project Open

When the renderer opens the newly-created project (existing `onCreated` path):

1. Check for `<projectPath>/.sai/brainstorm-seed.md`.
2. If present:
   - Read the file.
   - Delete the file (one-shot — prevents replays on subsequent opens).
   - Inject the contents as the user's first chat message and send it immediately so the AI's response is the first thing the user sees.
3. If absent: existing behavior (empty chat).

### Why a File Handoff

Project creation can race with chat-panel mount; an on-disk handoff is robust and survives if the user closes/reopens the window before the first message lands. One-shot deletion prevents replays.

## Error Handling

- **`brainstormStart` failure** (e.g., `claude` binary missing): Brainstorm tab shows an inline banner: "AI brainstorm unavailable — [reason]. You can still fill out the Setup tab manually." Modal remains usable.
- **Mid-conversation stream error**: append a system bubble "Connection lost — try sending again." Session is reusable.
- **`brainstormSynthesize` JSON parse failure**: handled in the Synthesize flow above — inline message, stay on tab.
- **Seed-file read failure on project open**: log and continue with empty chat. Never block opening the project.

## Settings

- Add `brainstormEnabled` (default `true`). If `claude` binary is unavailable at app start, the renderer hides the Brainstorm tab and the "🧠 Brainstorm first" link.

## Testing

### Unit

- JSON parser for synthesize output: valid JSON, malformed JSON, missing `projectName`, missing `context`, extra fields ignored, oversized `projectName` rejected.
- `scaffold.ts` correctly writes `.sai/brainstorm-seed.md` only when transcript is provided.
- `scaffold.ts` adds `.sai/` to a generated `.gitignore` exactly once.

### Component (React Testing Library)

- Tab switching preserves state on both tabs.
- "Use this →" is disabled until first AI reply.
- "Replace?" prompt appears when target fields are already filled at synthesize time.
- "✨ from brainstorm" badge clears the moment the user edits the field.
- Brainstorm tab is hidden when `brainstormEnabled` is false.

### Manual E2E

- Open modal → switch to Brainstorm → have a multi-turn conversation → "Use this →" → verify Setup tab prefilled → Create Project → verify the new project opens with the brainstorm seed message sent automatically and the AI responding to it.
- Verify `.sai/brainstorm-seed.md` is deleted after first open.
- Verify `.sai/` is in `.gitignore` when one was generated.

## File-by-File Impact

- `src/components/NewProjectModal.tsx` — tab bar, Brainstorm tab UI, synthesize wiring, transcript state, "Replace?" prompts, "✨ from brainstorm" badges.
- `electron/services/scaffold.ts` — accept `brainstormTranscript`, write seed file, update `.gitignore`.
- `electron/preload.ts` — expose `brainstormStart` / `brainstormSend` / `brainstormSynthesize` / `brainstormEnd` to the renderer.
- `electron/services/brainstorm.ts` (new) — manage brainstorm Claude sessions (lifecycle, streaming, synthesize).
- Renderer chat panel (existing project open path) — check for and consume `.sai/brainstorm-seed.md` on mount.
- New unit + component tests alongside the above.
