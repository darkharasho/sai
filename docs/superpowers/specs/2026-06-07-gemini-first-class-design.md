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

### Unit tests
- `capabilities.ts` — assert each provider's flags are correct values
- Unified IPC routing — assert `provider.send('claude', ...)` invokes `ipcRenderer.send('claude:send', ...)` with correct args; same for gemini and codex
- Session `provider` field back-compat migration — sessions with only `claudeSessionId` set get `provider: 'claude'`

### Component tests
- `ChatPanel` — orchestrator tab absent when provider is gemini
- `ChatInput` — effort mode absent for gemini, conversation mode present for gemini, approval mode present for gemini
- `ChatHistorySidebar` — only sessions matching active provider are shown

### Manual smoke test checklist
1. Switch provider Claude → Gemini in settings
2. Verify chat sidebar shows only Gemini sessions (empty if first use)
3. Verify orchestrator tab is gone
4. Verify toolbar shows conversation mode + approval mode, no effort level
5. Change Gemini default model in settings, start new session — verify model pre-selected
6. Change default approval mode, start new session — verify approval mode pre-set
7. Switch back to Claude — verify Claude session history returns, orchestrator tab reappears
8. Verify no console errors during provider switch
