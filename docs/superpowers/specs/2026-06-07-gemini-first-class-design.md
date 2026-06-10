# Gemini First-Class Provider Design

**Date:** 2026-06-07
**Status:** Approved

## Goal

Make Gemini a first-class provider in SAI: feature-parity on the features it can support, clean capability-driven UI that hides Claude-only features, provider-scoped session history, and a meaningful settings page. This doc also establishes the shared foundation (capabilities file + unified IPC routing) that the Codex first-class pass will build on.

## What Gemini Already Has

Before listing gaps, note that Gemini is closer to parity than it looks:

- Model selector in toolbar
- Conversation mode toggle (Planning / Fast)
- Approval mode (4-level: default / auto_edit / yolo / plan)
- Image support (base64 pipeline)
- Session resume
- Terminal scopes
- Commit message generation (hidden ACP session)
- Token / usage display

The real gaps are: a thin settings page, the UI showing Claude-only controls when Gemini is active, sessions not scoped to a provider, and scattered `aiProvider === 'claude'` checks that make adding new capabilities fragile.

## Architecture

Two new seams are introduced. Backend service files (`claude.ts`, `gemini.ts`, `codex.ts`) are **not touched** by this work.

### Seam 1 — `src/providers/capabilities.ts`

A pure data module. No logic, no imports from the rest of the app.

```ts
export interface ProviderCapabilities {
  hasOrchestrator: boolean;
  hasSlashCommands: boolean;
  hasEffortMode: boolean;       // Claude: low/medium/high/max
  hasConversationMode: boolean; // Gemini: planning/fast
  hasApprovalMode: boolean;
  supportsImages: boolean;
  supportsTerminalScope: boolean;
  supportsMultiScope: boolean;
}

const CAPABILITIES: Record<AIProvider, ProviderCapabilities> = {
  claude: {
    hasOrchestrator: true,
    hasSlashCommands: true,
    hasEffortMode: true,
    hasConversationMode: false,
    hasApprovalMode: false,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
  },
  gemini: {
    hasOrchestrator: false,
    hasSlashCommands: false,
    hasEffortMode: false,
    hasConversationMode: true,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
  },
  codex: {
    hasOrchestrator: false,
    hasSlashCommands: false,
    hasEffortMode: false,
    hasConversationMode: false,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: false,
    supportsMultiScope: false,
  },
};

export function getCapabilities(provider: AIProvider): ProviderCapabilities {
  return CAPABILITIES[provider];
}
```

Every `aiProvider === 'claude'` check in the UI is replaced with a `getCapabilities(provider).flagName` lookup.

### Seam 2 — Unified IPC routing in `preload.ts`

A new `window.sai.provider` namespace that routes to the correct underlying channel based on the provider argument. Existing `window.sai.claudeSend`, `window.sai.geminiSend`, `window.sai.codexSend` are kept for backward compatibility during migration but the frontend progressively moves to the unified API.

```ts
window.sai.provider = {
  start(provider, cwd, opts): Promise<ProviderStartResult>
  send(provider, projectPath, message, opts): void
  stop(provider, projectPath): void
  setSessionId(provider, projectPath, sessionId): void
  getModels(provider): Promise<ModelOption[]>
}

// window.sai.provider.onMessage remains the existing claude:message listener
// (all three providers already broadcast on this channel)
```

`opts` is a union-friendly object: `{ imagePaths?, model?, scope?, effortLevel?, permMode?, approvalMode?, conversationMode? }`. The routing layer maps relevant fields to the correct positional args for each provider's IPC channel.

## Session Scoping

### Schema change

`ChatSession` gains a `provider: AIProvider` field. Default value on existing sessions is inferred from which session ID field is populated (`claudeSessionId` → `claude`, `geminiSessionId` → `gemini`, `codexSessionId` → `codex`; if ambiguous, `claude`).

```ts
export interface ChatSession {
  // existing fields...
  provider: AIProvider; // new — required, back-compat migrated
}
```

New sessions are stamped with the active `aiProvider` at creation time. This includes sessions created by the "New Chat" button, by provider switch, and by any code path that calls `createNewSession()` in `ChatPanel`.

### Sidebar filtering

`ChatHistorySidebar` filters the session list to only show sessions matching the active `aiProvider`. Each provider has a fully isolated history view. The filter is applied reactively — switching providers in settings immediately updates the sidebar.

### Provider switch behavior

`ChatPanel` watches `aiProvider` in settings. When it changes:
1. Current session is torn down (same as clicking "New Chat")
2. A fresh session is started for the new provider
3. No resume prompt — always starts clean

This eliminates the "stale Claude session state visible in Gemini" jank.

## Capability-Driven UI

### Orchestrator tab

Hidden entirely when `!getCapabilities(provider).hasOrchestrator`. No grayed-out or disabled state — the tab simply isn't mounted. This affects the tab bar in `ChatPanel` and any navigation that references the orchestrator scope.

### Slash commands

The `/` trigger and slash command palette only mounts when `getCapabilities(provider).hasSlashCommands`. For Gemini, the trigger does nothing. SAI-native slash commands (e.g. `/new`, `/clear`) are out of scope for this pass.

### Toolbar controls

Each toolbar control in `ChatInput` is gated on its capability flag:

| Control | Flag | Claude | Gemini | Codex |
|---------|------|--------|--------|-------|
| Effort level | `hasEffortMode` | shown | hidden | hidden |
| Conversation mode | `hasConversationMode` | hidden | shown | hidden |
| Approval mode | `hasApprovalMode` | hidden | shown | shown |

Note: Claude has a separate `permMode` (default/bypass) that is not the same concept as Gemini's `approvalMode` or Codex's permission level. Claude's control renders unconditionally for Claude; it is not gated on `hasApprovalMode`.

The existing Gemini conversation mode and approval mode controls already render correctly — this work just replaces the ad-hoc conditionals with capability lookups.

## Gemini Settings Expansion

The current Gemini settings page shows only a "Loading phrases" control. It is expanded to include:

- **Default model** — dropdown seeded from the hardcoded Gemini model list (`auto-gemini-3`, `auto-gemini-2.5`, etc.). Persisted to `settings.json` as `geminiDefaultModel`. Pre-fills the model selector when starting a new Gemini session.
- **Default approval mode** — select from `default` / `auto_edit` / `yolo` / `plan`. Persisted as `geminiDefaultApprovalMode`. Applied as the initial approval mode on session start.
- **Default conversation mode** — `planning` / `fast` toggle. Persisted as `geminiDefaultConversationMode`. Applied as the initial conversation mode on session start.
- **Loading phrases** — retained, moved to bottom of the page.

**Out of scope:** MCP config path for Gemini. The Gemini CLI supports `--mcp-config` but threading it through `gemini.ts`'s ACP initialization is a backend change. It can be added in a follow-up.

## What Is Explicitly Not In Scope

- Orchestrator support for Gemini (Gemini CLI has no equivalent)
- Slash commands for Gemini (Gemini CLI does not expose them on init)
- MCP config path setting (requires touching gemini.ts)
- Any changes to `gemini.ts`, `claude.ts`, or `codex.ts`

## Testing

The project already has 188 test files with `ChatPanel.test.tsx` (1,125 lines), `ChatInput.test.tsx` (310 lines), `claude.test.ts` (44KB), `gemini.test.ts` (18KB), and `codex.test.ts` (36KB). The testing strategy here is phased to maximize regression safety without writing tests for their own sake.

### Phase 0 — Characterization tests (written before any code changes)

These lock in current behavior. They are written first, run green on the unmodified codebase, and then serve as the regression net throughout the refactor.

**`tests/unit/preload.test.ts` additions:**
- `claudeSend` invokes `ipcRenderer.send('claude:send', ...)` with all positional args in the correct order
- `geminiSend` invokes `ipcRenderer.send('gemini:send', ...)` with correct args
- `codexSend` invokes `ipcRenderer.send('codex:send', ...)` with correct args
- `claudeStart` invokes `ipcRenderer.invoke('claude:start', ...)`

**`tests/unit/components/Chat/ChatPanel.test.tsx` additions:**
- Orchestrator tab IS present when `aiProvider='claude'`
- Effort mode IS present in ChatInput when `aiProvider='claude'`
- Gemini conversation mode IS present when `aiProvider='gemini'`
- Codex approval mode IS present when `aiProvider='codex'`

These four tests must pass before a single line of implementation code is written.

### Phase 1 — TDD for the two new seams

Written before each seam is implemented, in the same commit.

**New file: `tests/unit/providers/capabilities.test.ts`**
- `getCapabilities('claude')` returns `hasOrchestrator: true`, `hasEffortMode: true`, `hasSlashCommands: true`, `hasConversationMode: false`, `hasApprovalMode: false`
- `getCapabilities('gemini')` returns `hasOrchestrator: false`, `hasConversationMode: true`, `hasApprovalMode: true`, `hasEffortMode: false`
- `getCapabilities('codex')` returns `hasOrchestrator: false`, `hasApprovalMode: true`, `hasEffortMode: false`, `hasConversationMode: false`
- All three providers have `supportsImages: true`

**`tests/unit/preload.test.ts` additions for the unified routing layer:**
- `provider.send('claude', path, msg, opts)` dispatches to `claude:send` with correct arg mapping
- `provider.send('gemini', path, msg, opts)` dispatches to `gemini:send` with correct arg mapping
- `provider.send('codex', path, msg, opts)` dispatches to `codex:send` with correct arg mapping
- `provider.start('claude', cwd, opts)` dispatches to `claude:start`
- `provider.start('gemini', cwd, opts)` dispatches to `gemini:start`
- `provider.getModels('codex')` dispatches to `codex:models`

**Session migration: `tests/unit/lib/chatSession.test.ts` (or nearest existing session test):**
- Session with only `claudeSessionId` set → `provider: 'claude'`
- Session with only `geminiSessionId` set → `provider: 'gemini'`
- Session with only `codexSessionId` set → `provider: 'codex'`
- Session with none set → `provider: 'claude'` (safe fallback)
- Session with `provider` already set → unchanged

### Phase 2 — Capability gate tests (one test per gate, written with the gate)

Each capability gate in the UI is written alongside its test — not after.

**`ChatPanel.test.tsx` additions:**
- Orchestrator tab absent when `aiProvider='gemini'`
- Orchestrator tab absent when `aiProvider='codex'`
- Slash command palette not mounted when `aiProvider='gemini'`
- Provider switch from Claude → Gemini calls session teardown and creates new session with `provider: 'gemini'`
- Provider switch from Gemini → Claude creates new session with `provider: 'claude'`

**`ChatInput.test.tsx` additions:**
- Effort mode button absent when `aiProvider='gemini'`
- Effort mode button absent when `aiProvider='codex'`
- Conversation mode toggle absent when `aiProvider='claude'`
- Conversation mode toggle absent when `aiProvider='codex'`
- Approval mode toggle absent when `aiProvider='claude'`

**`ChatHistorySidebar.test.tsx` (new or existing):**
- With mixed sessions (claude/gemini/codex), only claude sessions shown when `aiProvider='claude'`
- Switching `aiProvider` to gemini shows only gemini sessions

### Manual smoke test checklist
1. Switch provider Claude → Gemini in settings — sidebar clears to Gemini history, orchestrator tab gone, effort mode gone
2. Verify toolbar shows conversation mode + approval mode for Gemini
3. Change Gemini default model in settings, start new session — verify model pre-selected
4. Change default approval mode, start new session — verify approval mode pre-set
5. Switch Claude → Gemini mid-session — active session torn down, fresh Gemini session started
6. Switch back to Claude — Claude history returns, orchestrator tab reappears, effort mode reappears
7. All existing Claude flows work identically to before (the characterization tests cover this)
