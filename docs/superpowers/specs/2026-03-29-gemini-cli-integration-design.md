# Gemini CLI Integration Design

**Date:** 2026-03-29
**Status:** Approved

## Summary

Add Google Gemini CLI as a third AI provider in SAI, following the same integration pattern established by Codex CLI. Users can switch between Claude, Codex, and Gemini from the settings modal or accordion bar, with provider-specific settings preserved independently.

## Architecture

### Backend Service (`electron/services/gemini.ts`)

New service mirroring `codex.ts`:

- **Spawning:** `gemini -p <prompt> --output-format stream-json -m <model> --approval-mode <mode>`
- **PATH enrichment:** Reuse `getEnrichedEnv()` pattern — Gemini is installed under nvm v24 at `~/.nvm/versions/node/v24.14.1/bin/gemini`
- **IPC handlers:** `gemini:models`, `gemini:start`, `gemini:send`, `gemini:stop`
- **Model list:** Hardcoded (no programmatic list endpoint available)

### Event Translation (`stream-json` → `claude:message`)

All events flow through the unified `claude:message` IPC channel:

| Gemini event | Translated to |
|---|---|
| `init` | Ignored (session metadata only) |
| `message` (role: user) | Ignored (echo of input) |
| `message` (role: assistant, delta: true) | `{ type: 'assistant', message: { content: [{ type: 'text', text }] } }` |
| `tool_use` | `{ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } }` |
| `tool_result` | Ignored (result shown via tool_use card) |
| `result` (status: success) | `{ type: 'result', usage: { input_tokens, output_tokens, cache_read_input_tokens } }` + `{ type: 'done' }` |
| `result` (status: error) / errors | `{ type: 'error', text }` + `{ type: 'done' }` |

**Usage mapping from `result.stats`:**
- `input_tokens` → `stats.input_tokens`
- `output_tokens` → `stats.output_tokens`
- `cache_read_input_tokens` → `stats.cached`

### IPC Bridge (`electron/preload.ts`)

Expose four methods:
- `geminiModels()` → invoke (returns hardcoded model list)
- `geminiStart(cwd)` → invoke
- `geminiSend(projectPath, message, imagePaths, approvalMode, conversationMode, model)` → send
- `geminiStop(projectPath)` → send

### Workspace State (`electron/services/workspace.ts`)

```typescript
export interface WorkspaceGemini {
  process: ChildProcess | null;
  buffer: string;
  cwd: string;
  busy: boolean;
}
```

Added to `Workspace` interface alongside existing `claude` and `codex`.

### Main Process (`electron/main.ts`)

Import and call `registerGeminiHandlers(mainWindow)`.

## CLI Flag Mapping

### Model List (Hardcoded)

| ID | Display Name |
|---|---|
| `auto-gemini-3` | Auto (Gemini 3) |
| `auto-gemini-2.5` | Auto (Gemini 2.5) |
| `gemini-3.1-pro` | Gemini 3.1 Pro |
| `gemini-3-flash` | Gemini 3 Flash |
| `gemini-2.5-pro` | Gemini 2.5 Pro |
| `gemini-2.5-flash` | Gemini 2.5 Flash |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite |

Default: `auto-gemini-3`

### Conversation Mode

| UI Label | Behavior |
|---|---|
| Planning | Use selected model as-is (default: `auto-gemini-3` which routes to pro for complex tasks) |
| Fast | Override model to `gemini-3-flash` regardless of selection |

### Approval Mode

| UI Label | CLI Flag |
|---|---|
| Default | `--approval-mode default` |
| Auto Edit | `--approval-mode auto_edit` |
| Yolo | `--approval-mode yolo` |
| Plan | `--approval-mode plan` |

## Frontend

### Settings Modal

Add to `PROVIDER_OPTIONS`:
```typescript
{ id: 'gemini', label: 'Gemini CLI', svg: 'svg/Google-gemini-icon.svg', color: '#4285f4' }
```

### Type Updates

```typescript
type AIProvider = 'claude' | 'codex' | 'gemini';
type GeminiApprovalMode = 'default' | 'auto_edit' | 'yolo' | 'plan';
type GeminiConversationMode = 'planning' | 'fast';
```

### App State (`src/App.tsx`)

New state variables:
- `geminiModel` (default: `'auto-gemini-3'`)
- `geminiModels` (hardcoded list, loaded at startup)
- `geminiApprovalMode` (default: `'default'`)
- `geminiConversationMode` (default: `'planning'`)

Nested settings: `gemini: { model, approvalMode, conversationMode }`

Save helpers: `saveGeminiSetting(key, value)` using read-merge-write pattern.

### Accordion Bar

Gemini SVG icon via CSS mask-image with brand color `#4285f4`.

### ChatInput Controls (when `aiProvider === 'gemini'`)

Three controls in the input toolbar:
1. **Model dropdown** — hardcoded list
2. **Conversation mode button** — cycles: Planning → Fast
3. **Approval mode button** — cycles: Default → Auto Edit → Yolo → Plan

Context ring and rate limit displays hidden (same as Codex).

### ChatMessage Icons

New `.chat-msg-gemini` CSS class:
- Uses `Google-gemini-icon.svg` via mask-image
- Color: `#4285f4` (Gemini blue)

### Thinking Animation — 6-Dot Grid

Gemini-branded thinking indicator:
- **Layout:** 2 rows x 3 columns of small circles
- **Animation:** Dots light up sequentially in a clockwise pattern (~2s cycle)
- **Color:** Cycles through Gemini gradient — blue (`#4285f4`) → purple (`#a855f7`) → pink (`#ea4335`) → back to blue
- **Idle state:** Dots are dim/muted
- **Active state:** Currently-lit dot uses the gradient color at that animation phase

### ChatPanel Routing

Provider routing extended for gemini:
- `gemini:start` → `window.sai.geminiStart(projectPath)`
- `gemini:send` → `window.sai.geminiSend(projectPath, prompt, imagePaths, approvalMode, conversationMode, model)`
- `gemini:stop` → `window.sai.geminiStop(projectPath)`

Thinking animation: render `<GeminiThinkingAnimation />` when streaming with gemini provider.

## Settings Persistence

Nested under `gemini` key alongside `claude` and `codex`:
```json
{
  "aiProvider": "gemini",
  "claude": { "model": "sonnet", "effort": "high" },
  "codex": { "model": "gpt-5.4", "permission": "auto" },
  "gemini": { "model": "auto-gemini-3", "approvalMode": "default", "conversationMode": "planning" }
}
```

GitHub settings sync updated to include `gemini` object in `githubOnSettingsApplied` handler.

## Files Modified

| File | Change |
|---|---|
| `electron/services/gemini.ts` | New — backend service |
| `electron/preload.ts` | Add gemini IPC bridges |
| `electron/main.ts` | Register gemini handlers |
| `electron/services/workspace.ts` | Add `WorkspaceGemini` interface |
| `src/App.tsx` | Extend AIProvider, add gemini state/handlers/settings |
| `src/components/SettingsModal.tsx` | Add Gemini to PROVIDER_OPTIONS |
| `src/components/Chat/ChatPanel.tsx` | Add gemini routing, 6-dot thinking animation |
| `src/components/Chat/ChatInput.tsx` | Add gemini controls (model, conversation mode, approval mode) |
| `src/components/Chat/ChatMessage.tsx` | Add `.chat-msg-gemini` icon class |
