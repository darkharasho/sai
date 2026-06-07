# Codex First-Class Provider Design

**Date:** 2026-06-07
**Status:** Approved

## Goal

Make Codex a first-class provider in SAI. This pass runs after the Gemini first-class pass, which establishes the shared foundation (`src/providers/capabilities.ts` and unified IPC routing). This doc covers Codex-specific deltas on top of that foundation.

**Prerequisite:** `2026-06-07-gemini-first-class-design.md` is implemented. The shared foundation — `capabilities.ts`, unified IPC routing in `preload.ts`, `ChatSession.provider` field, and `ChatHistorySidebar` filtering — must exist before this pass. Codex's capability flags and IPC routing are already written into those shared files during the Gemini pass; this doc covers only the Codex-specific UI and settings work.

## What Codex Already Has

- Model selector in toolbar (models fetched dynamically from `codex app-server`)
- Approval/permission mode (3-level: auto / read-only / full-access)
- Image support (`-i` flag per image path)
- Session resume (`codex exec resume <sessionId>`)
- Commit message generation (one-shot `codex exec -q`)
- Token / usage display

## What Codex Does Not Have (and Won't Get This Pass)

| Gap | Reason skipped |
|-----|---------------|
| Orchestrator scope | Codex CLI has no equivalent |
| Slash commands | Codex CLI does not expose them |
| Terminal scope | Requires backend changes to `codex.ts`; single-scope is fine for now |
| Multiple concurrent scopes | Same — `WorkspaceCodex` is not a Map and that's OK |
| Effort / conversation mode | Codex CLI has no equivalent parameter |

## Codex Capability Flags

The `capabilities.ts` introduced in the Gemini pass already includes Codex:

```ts
codex: {
  hasOrchestrator: false,
  hasSlashCommands: false,
  hasEffortMode: false,
  hasConversationMode: false,
  hasApprovalMode: true,      // 3-level: auto / read-only / full-access
  supportsImages: true,
  supportsTerminalScope: false,
  supportsMultiScope: false,
},
```

No changes needed to the capabilities file — it was already written with Codex in mind.

## Session Scoping

Identical to the Gemini pass. `ChatSession.provider` back-compat migration assigns `codex` to sessions that have `codexSessionId` set. The sidebar filters to Codex-only sessions when Codex is active. Provider switch resets to a new session.

No new work required — this is already handled by the foundation layer.

## Capability-Driven UI

The Gemini pass already wires up all the capability gates. With Codex's flags in place:

- **Orchestrator tab** — hidden (same as Gemini)
- **Slash commands** — disabled (same as Gemini)
- **Effort mode** — hidden (`hasEffortMode: false`)
- **Conversation mode** — hidden (`hasConversationMode: false`)
- **Approval mode** — shown (`hasApprovalMode: true`) — the existing 3-level Codex toggle keeps working as-is

The only Codex-specific UI concern is the approval mode: Codex uses `auto / read-only / full-access` while Gemini uses `default / auto_edit / yolo / plan`. The capability flag marks both as `hasApprovalMode: true` but they render their own labels/icons. This is already the case — no change needed.

## Codex Settings Expansion

The current Codex settings page shows only static text: "Model and permission mode for Codex live in the chat toolbar." This is replaced with actual controls:

- **Default permission mode** — select from `auto` / `read-only` / `full-access`. Persisted as `codexDefaultPermMode`. Applied as the initial permission mode when starting a new Codex session.
- **Default model** — dropdown seeded from the model list fetched at settings open time via `codex:models`. Persisted as `codexDefaultModel`. Falls back to the first available model if the persisted value is no longer in the list. Pre-fills the model selector on new session start.

**Out of scope:** Any settings that would require touching `codex.ts` — e.g. custom working directory flags, timeout tuning, additional CLI flags.

## Unified IPC

The Gemini pass adds `window.sai.provider.send/start/stop/setSessionId/getModels`. Codex is already covered by that routing layer — `provider.send('codex', ...)` dispatches to `codex:send`. No additional IPC work needed for Codex.

One gap worth noting: `codex:send` currently has no `scope` parameter (it's hardcoded to `'chat'` in `codex.ts`). The unified routing layer passes `scope` through for future-compatibility but it's a no-op for Codex today. When terminal scope is added to Codex in a future pass, the routing layer already handles it.

## What Is Explicitly Not In Scope

- Orchestrator support
- Slash commands
- Terminal scope / multi-scope (requires backend changes to `codex.ts`)
- Effort or conversation mode (no CLI equivalent)
- Any changes to `codex.ts`, `claude.ts`, or `gemini.ts`

## Testing

### Unit tests
- Settings persistence — `codexDefaultPermMode` and `codexDefaultModel` round-trip through `settingsGet/Set`
- Model fallback — if persisted model not in current list, falls back to first available

### Component tests
- `ChatPanel` — orchestrator tab absent when provider is codex
- `ChatInput` — effort mode absent, conversation mode absent, approval mode shown with correct Codex-specific labels
- `ChatHistorySidebar` — only Codex sessions shown when Codex is active

### Manual smoke test checklist
1. Switch provider to Codex in settings
2. Verify chat sidebar shows only Codex sessions
3. Verify orchestrator tab is gone
4. Verify toolbar shows approval mode (auto/read-only/full-access), no effort level, no conversation mode
5. Set default permission mode in Codex settings, start new session — verify pre-set
6. Set default model, start new session — verify pre-selected
7. Switch to Claude — verify Claude history returns, orchestrator tab reappears
8. Switch to Gemini — verify Gemini history, correct toolbar for Gemini
9. Verify no console errors during provider switches
