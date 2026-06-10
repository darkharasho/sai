# Gemini First-Class Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini a first-class provider by introducing a capabilities abstraction, unified IPC routing, strict provider-scoped session history, a hidden Swarm button for non-Claude providers, capability-driven toolbar controls, and an expanded Gemini settings page.

**Architecture:** Two new seams: `src/providers/capabilities.ts` (pure data, capability flags per provider) and `window.sai.provider.*` (unified IPC routing in preload.ts). Backend service files are untouched. The UI is refactored to use capability flags instead of `aiProvider ===` checks. An `inferSessionProvider` utility enables strict sidebar filtering without a database migration.

**Tech Stack:** TypeScript, React, Electron contextBridge, Vitest, React Testing Library

---

## Existing state (read before touching code)

Many things already exist — read these before assuming something needs to be added:

- `ChatSession.aiProvider?: AIProvider` — field exists in `src/types.ts:56`
- `ChatHistorySidebar` already filters: `sessions.filter(s => !s.aiProvider || s.aiProvider === aiProvider)` — needs to become strict (Task 4)
- `handleNewChat()` in `App.tsx:3232` already stamps `aiProvider` on new sessions
- `onSettingChange('aiProvider', ...)` in `App.tsx:4328` already calls `handleNewChat()` — provider switch already triggers fresh session
- `geminiModel`, `geminiApprovalMode`, `geminiConversationMode` state + persistence already exists in `App.tsx:176-179` and `saveGeminiSetting` at `App.tsx:3432`
- Settings already load Gemini values from `settingsGet('gemini', {})` at `App.tsx:1729` and `SettingsModal.tsx:117`
- `handleGeminiModelChange`, `handleGeminiApprovalModeChange`, `handleGeminiConversationModeChange` handlers already exist at `App.tsx:3438-3451`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/providers/capabilities.ts` | **Create** | Capability flags per provider |
| `tests/unit/providers/capabilities.test.ts` | **Create** | Capability flag unit tests |
| `electron/preload.ts` | **Modify** | Add `window.sai.provider.*` routing namespace |
| `tests/unit/preload.test.ts` | **Modify** | Characterization + routing tests |
| `src/lib/sessionProvider.ts` | **Create** | `inferSessionProvider` utility |
| `tests/unit/lib/sessionProvider.test.ts` | **Create** | Inference logic tests |
| `src/components/Chat/ChatHistorySidebar.tsx` | **Modify** | Strict provider filtering |
| `src/components/NavBar.tsx` | **Modify** | Add `hasOrchestrator` prop, hide Swarm button |
| `src/App.tsx` | **Modify** | Pass capability to NavBar; add Gemini onSettingChange handlers |
| `src/components/Chat/ChatInput.tsx` | **Modify** | Replace `aiProvider ===` with capability flags |
| `src/components/SettingsModal.tsx` | **Modify** | Add default model/approvalMode/conversationMode controls |
| `tests/unit/components/Chat/ChatInput.test.tsx` | **Modify** | Capability gate tests |
| `tests/unit/components/NavBar.test.tsx` | **Modify** (if exists) | Swarm button visibility tests |

---

## Task 1: Phase 0 — Characterization tests (write BEFORE touching any implementation code)

These lock in current behavior. They must be green before any other task starts.

**Files:**
- Modify: `tests/unit/preload.test.ts`

- [ ] **Step 1: Add characterization tests for existing IPC routing**

Open `tests/unit/preload.test.ts`. Read the existing tests to understand the mock pattern (ipcRenderer is mocked via `vi.hoisted`). Add these tests at the end of the file:

```typescript
describe('characterization: existing IPC routing', () => {
  it('claudeSend forwards to claude:send with all positional args', () => {
    window.sai.claudeSend('/proj', 'hi', ['/img.png'], 'default', 'medium', 'sonnet', 'chat');
    expect(ipcRenderer.send).toHaveBeenCalledWith(
      'claude:send', '/proj', 'hi', ['/img.png'], 'default', 'medium', 'sonnet', 'chat'
    );
  });

  it('codexSend forwards to codex:send with all positional args', () => {
    window.sai.codexSend('/proj', 'hi', [], 'auto', 'codex-mini');
    expect(ipcRenderer.send).toHaveBeenCalledWith(
      'codex:send', '/proj', 'hi', [], 'auto', 'codex-mini'
    );
  });

  it('geminiStart forwards to gemini:start', () => {
    (window.sai as any).geminiStart('/proj', 'meta');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('gemini:start', '/proj', 'meta');
  });

  it('claudeStart forwards to claude:start', () => {
    window.sai.claudeStart('/proj', 'chat', 'chat', undefined, undefined, 'meta');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'claude:start', '/proj', 'chat', 'chat', undefined, undefined, 'meta'
    );
  });
});
```

- [ ] **Step 2: Run and confirm all characterization tests pass**

```bash
npx vitest run --project unit tests/unit/preload.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All tests pass on the unmodified codebase. If any fail, the test is wrong — fix the test, not the code.

- [ ] **Step 3: Commit characterization tests**

```bash
git add tests/unit/preload.test.ts
git commit -m "test: characterization tests for existing IPC routing"
```

---

## Task 2: Create `src/providers/capabilities.ts`

**Files:**
- Create: `src/providers/capabilities.ts`
- Create: `tests/unit/providers/capabilities.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `tests/unit/providers/capabilities.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getCapabilities } from '../../../src/providers/capabilities';

describe('getCapabilities', () => {
  describe('claude', () => {
    it('has orchestrator', () => expect(getCapabilities('claude').hasOrchestrator).toBe(true));
    it('has slash commands', () => expect(getCapabilities('claude').hasSlashCommands).toBe(true));
    it('has effort mode', () => expect(getCapabilities('claude').hasEffortMode).toBe(true));
    it('does not have conversation mode', () => expect(getCapabilities('claude').hasConversationMode).toBe(false));
    it('does not have approval mode', () => expect(getCapabilities('claude').hasApprovalMode).toBe(false));
    it('supports images', () => expect(getCapabilities('claude').supportsImages).toBe(true));
    it('supports terminal scope', () => expect(getCapabilities('claude').supportsTerminalScope).toBe(true));
    it('supports multi-scope', () => expect(getCapabilities('claude').supportsMultiScope).toBe(true));
  });

  describe('gemini', () => {
    it('does not have orchestrator', () => expect(getCapabilities('gemini').hasOrchestrator).toBe(false));
    it('does not have slash commands', () => expect(getCapabilities('gemini').hasSlashCommands).toBe(false));
    it('does not have effort mode', () => expect(getCapabilities('gemini').hasEffortMode).toBe(false));
    it('has conversation mode', () => expect(getCapabilities('gemini').hasConversationMode).toBe(true));
    it('has approval mode', () => expect(getCapabilities('gemini').hasApprovalMode).toBe(true));
    it('supports images', () => expect(getCapabilities('gemini').supportsImages).toBe(true));
  });

  describe('codex', () => {
    it('does not have orchestrator', () => expect(getCapabilities('codex').hasOrchestrator).toBe(false));
    it('does not have slash commands', () => expect(getCapabilities('codex').hasSlashCommands).toBe(false));
    it('does not have effort mode', () => expect(getCapabilities('codex').hasEffortMode).toBe(false));
    it('does not have conversation mode', () => expect(getCapabilities('codex').hasConversationMode).toBe(false));
    it('has approval mode', () => expect(getCapabilities('codex').hasApprovalMode).toBe(true));
    it('does not support terminal scope', () => expect(getCapabilities('codex').supportsTerminalScope).toBe(false));
    it('does not support multi-scope', () => expect(getCapabilities('codex').supportsMultiScope).toBe(false));
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run --project unit tests/unit/providers/capabilities.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the capabilities module**

Create `src/providers/capabilities.ts`:

```typescript
import type { AIProvider } from '../types';

export interface ProviderCapabilities {
  hasOrchestrator: boolean;
  hasSlashCommands: boolean;
  hasEffortMode: boolean;
  hasConversationMode: boolean;
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

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run --project unit tests/unit/providers/capabilities.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/capabilities.ts tests/unit/providers/capabilities.test.ts
git commit -m "feat: add provider capabilities module"
```

---

## Task 3: Add `window.sai.provider.*` unified IPC routing

**Files:**
- Modify: `electron/preload.ts`
- Modify: `tests/unit/preload.test.ts`

- [ ] **Step 1: Write the routing tests first**

Add to `tests/unit/preload.test.ts`:

```typescript
describe('window.sai.provider routing', () => {
  describe('provider.send', () => {
    it('routes claude to claude:send with mapped args', () => {
      (window.sai as any).provider.send('claude', '/proj', 'hello', {
        imagePaths: ['/a.png'], permMode: 'default', effortLevel: 'high',
        model: 'sonnet', scope: 'chat',
      });
      expect(ipcRenderer.send).toHaveBeenCalledWith(
        'claude:send', '/proj', 'hello', ['/a.png'], 'default', 'high', 'sonnet', 'chat'
      );
    });

    it('routes gemini to gemini:send with mapped args', () => {
      (window.sai as any).provider.send('gemini', '/proj', 'hello', {
        imagePaths: [], approvalMode: 'auto_edit', conversationMode: 'fast',
        model: 'gemini-2.5-flash', scope: 'chat',
      });
      expect(ipcRenderer.send).toHaveBeenCalledWith(
        'gemini:send', '/proj', 'hello', [], 'auto_edit', 'fast', 'gemini-2.5-flash', 'chat'
      );
    });

    it('routes codex to codex:send with mapped args', () => {
      (window.sai as any).provider.send('codex', '/proj', 'hello', {
        imagePaths: [], permMode: 'auto', model: 'codex-mini',
      });
      expect(ipcRenderer.send).toHaveBeenCalledWith(
        'codex:send', '/proj', 'hello', [], 'auto', 'codex-mini'
      );
    });
  });

  describe('provider.start', () => {
    it('routes claude to claude:start', () => {
      (window.sai as any).provider.start('claude', '/proj', { scope: 'chat', kind: 'chat', metaPreamble: 'meta' });
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'claude:start', '/proj', 'chat', 'chat', undefined, undefined, 'meta'
      );
    });

    it('routes gemini to gemini:start', () => {
      (window.sai as any).provider.start('gemini', '/proj', { metaPreamble: 'meta' });
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('gemini:start', '/proj', 'meta');
    });

    it('routes codex to codex:start', () => {
      (window.sai as any).provider.start('codex', '/proj', { metaPreamble: 'meta' });
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('codex:start', '/proj', 'meta');
    });
  });

  describe('provider.stop', () => {
    it('routes claude to claude:stop', () => {
      (window.sai as any).provider.stop('claude', '/proj');
      expect(ipcRenderer.send).toHaveBeenCalledWith('claude:stop', '/proj', undefined);
    });

    it('routes gemini to gemini:stop', () => {
      (window.sai as any).provider.stop('gemini', '/proj', 'chat');
      expect(ipcRenderer.send).toHaveBeenCalledWith('gemini:stop', '/proj', 'chat');
    });

    it('routes codex to codex:stop', () => {
      (window.sai as any).provider.stop('codex', '/proj');
      expect(ipcRenderer.send).toHaveBeenCalledWith('codex:stop', '/proj');
    });
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run --project unit tests/unit/preload.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — `window.sai.provider` is undefined.

- [ ] **Step 3: Add `provider` namespace to preload.ts**

Open `electron/preload.ts`. Inside the `contextBridge.exposeInMainWorld('sai', { ... })` object (after line 68, before `claudeOnMessage`), add:

```typescript
  // Unified provider routing — dispatches to the correct per-provider channel.
  // Existing window.sai.claudeSend / geminiSend / codexSend remain for backward compat.
  provider: {
    start(provider: string, cwd: string, opts: {
      scope?: string; kind?: string; orchestratorContext?: unknown;
      scopeCwd?: string; metaPreamble?: string;
    } = {}) {
      if (provider === 'claude') {
        return ipcRenderer.invoke('claude:start', cwd, opts.scope, opts.kind, opts.orchestratorContext, opts.scopeCwd, opts.metaPreamble);
      } else if (provider === 'gemini') {
        return ipcRenderer.invoke('gemini:start', cwd, opts.metaPreamble);
      } else {
        return ipcRenderer.invoke('codex:start', cwd, opts.metaPreamble);
      }
    },
    send(provider: string, projectPath: string, message: string, opts: {
      imagePaths?: string[]; model?: string; scope?: string;
      effortLevel?: string; permMode?: string;
      approvalMode?: string; conversationMode?: string;
    } = {}) {
      const images = opts.imagePaths ?? [];
      if (provider === 'claude') {
        ipcRenderer.send('claude:send', projectPath, message, images, opts.permMode, opts.effortLevel, opts.model, opts.scope);
      } else if (provider === 'gemini') {
        ipcRenderer.send('gemini:send', projectPath, message, images, opts.approvalMode, opts.conversationMode, opts.model, opts.scope);
      } else {
        ipcRenderer.send('codex:send', projectPath, message, images, opts.permMode, opts.model);
      }
    },
    stop(provider: string, projectPath: string, scope?: string) {
      if (provider === 'claude') {
        ipcRenderer.send('claude:stop', projectPath, scope);
      } else if (provider === 'gemini') {
        ipcRenderer.send('gemini:stop', projectPath, scope);
      } else {
        ipcRenderer.send('codex:stop', projectPath);
      }
    },
    setSessionId(provider: string, projectPath: string, sessionId: string | undefined, scope?: string) {
      if (provider === 'claude') {
        ipcRenderer.send('claude:setSessionId', projectPath, sessionId, scope);
      } else if (provider === 'gemini') {
        ipcRenderer.send('gemini:setSessionId', projectPath, sessionId, scope);
      } else {
        ipcRenderer.send('codex:setSessionId', projectPath, sessionId);
      }
    },
  },
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run --project unit tests/unit/preload.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass (characterization tests still pass + new routing tests pass).

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts tests/unit/preload.test.ts
git commit -m "feat: add window.sai.provider unified IPC routing"
```

---

## Task 4: Strict provider session filtering

**Files:**
- Create: `src/lib/sessionProvider.ts`
- Create: `tests/unit/lib/sessionProvider.test.ts`
- Modify: `src/components/Chat/ChatHistorySidebar.tsx`
- Modify: `tests/unit/components/Chat/ChatHistorySidebar.test.tsx`

- [ ] **Step 1: Write failing tests for the inference utility**

Create `tests/unit/lib/sessionProvider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { inferSessionProvider } from '../../../src/lib/sessionProvider';
import type { ChatSession } from '../../../src/types';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'test-id',
    title: 'Test',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    ...overrides,
  };
}

describe('inferSessionProvider', () => {
  it('returns aiProvider if set', () => {
    expect(inferSessionProvider(makeSession({ aiProvider: 'gemini' }))).toBe('gemini');
  });

  it('infers claude from claudeSessionId', () => {
    expect(inferSessionProvider(makeSession({ claudeSessionId: 'abc' }))).toBe('claude');
  });

  it('infers gemini from geminiSessionId', () => {
    expect(inferSessionProvider(makeSession({ geminiSessionId: 'abc' }))).toBe('gemini');
  });

  it('infers codex from codexSessionId', () => {
    expect(inferSessionProvider(makeSession({ codexSessionId: 'abc' }))).toBe('codex');
  });

  it('defaults to claude when no session IDs are set', () => {
    expect(inferSessionProvider(makeSession())).toBe('claude');
  });

  it('aiProvider takes precedence over session IDs', () => {
    expect(inferSessionProvider(makeSession({ aiProvider: 'gemini', claudeSessionId: 'abc' }))).toBe('gemini');
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run --project unit tests/unit/lib/sessionProvider.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the inference utility**

Create `src/lib/sessionProvider.ts`:

```typescript
import type { AIProvider, ChatSession } from '../types';

export function inferSessionProvider(session: ChatSession): AIProvider {
  if (session.aiProvider) return session.aiProvider;
  if (session.geminiSessionId) return 'gemini';
  if (session.codexSessionId) return 'codex';
  return 'claude';
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run --project unit tests/unit/lib/sessionProvider.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass.

- [ ] **Step 5: Update ChatHistorySidebar to use strict filtering**

Open `src/components/Chat/ChatHistorySidebar.tsx`. Find the `providerSessions` memo (around line 112):

```typescript
// existing — replace this:
const providerSessions = useMemo(
  () => sessions.filter(s => !s.aiProvider || s.aiProvider === aiProvider),
  [sessions, aiProvider]
);
```

Replace with:

```typescript
// new — strict filtering via inferSessionProvider
const providerSessions = useMemo(
  () => sessions.filter(s => inferSessionProvider(s) === aiProvider),
  [sessions, aiProvider]
);
```

Also add the import at the top of the file:

```typescript
import { inferSessionProvider } from '../../lib/sessionProvider';
```

- [ ] **Step 6: Update ChatHistorySidebar tests**

Open `tests/unit/components/Chat/ChatHistorySidebar.test.tsx`. Find tests that assert untagged sessions appear for all providers and update them to expect strict filtering behavior. Add:

```typescript
it('shows only sessions matching the active provider', () => {
  const sessions = [
    makeSession({ id: '1', aiProvider: 'claude' }),
    makeSession({ id: '2', aiProvider: 'gemini' }),
    makeSession({ id: '3', aiProvider: 'codex' }),
    makeSession({ id: '4' }), // untagged — infers claude
  ];
  render(<ChatHistorySidebar sessions={sessions} aiProvider="claude" {...defaultProps} />);
  // Sessions 1 and 4 (inferred claude) should appear; 2 and 3 should not
  expect(screen.getByText('session-1-title')).toBeInTheDocument();
  expect(screen.queryByText('session-2-title')).not.toBeInTheDocument();
});
```

Adjust the test content string to match whatever title format the `makeSession` helper uses in that file.

- [ ] **Step 7: Run all sidebar tests**

```bash
npx vitest run --project unit tests/unit/components/Chat/ChatHistorySidebar.test.tsx --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sessionProvider.ts tests/unit/lib/sessionProvider.test.ts src/components/Chat/ChatHistorySidebar.tsx tests/unit/components/Chat/ChatHistorySidebar.test.tsx
git commit -m "feat: strict provider-scoped session filtering in chat sidebar"
```

---

## Task 5: Hide Swarm nav button for non-orchestrator providers

**Files:**
- Modify: `src/components/NavBar.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/unit/components/NavBar.test.tsx` (create if missing)

- [ ] **Step 1: Write the failing tests**

Check if `tests/unit/components/NavBar.test.tsx` exists. If not, create it. Add:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NavBar from '../../../src/components/NavBar';

const defaultProps = {
  activeSidebar: null,
  onToggle: () => {},
};

describe('NavBar swarm button visibility', () => {
  it('shows Swarm button when hasOrchestrator is true', () => {
    render(<NavBar {...defaultProps} hasOrchestrator={true} />);
    expect(screen.getByTitle('Swarm')).toBeInTheDocument();
  });

  it('hides Swarm button when hasOrchestrator is false', () => {
    render(<NavBar {...defaultProps} hasOrchestrator={false} />);
    expect(screen.queryByTitle('Swarm')).not.toBeInTheDocument();
  });

  it('shows Swarm button by default (no prop)', () => {
    render(<NavBar {...defaultProps} />);
    expect(screen.getByTitle('Swarm')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run --project unit tests/unit/components/NavBar.test.tsx --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL on the `hasOrchestrator={false}` test.

- [ ] **Step 3: Update NavBar.tsx**

Open `src/components/NavBar.tsx`. Add `hasOrchestrator?: boolean` to the `NavBarProps` interface:

```typescript
interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
  gitChangeCount?: number;
  swarmApprovalCount?: number;
  chatNotificationCount?: number;
  overallStatus?: OverallStatus;
  hasOrchestrator?: boolean;  // add this line
}
```

Update the function signature to destructure it with a default of `true`:

```typescript
export default function NavBar({ activeSidebar, onToggle, gitChangeCount = 0, swarmApprovalCount = 0, chatNotificationCount = 0, overallStatus = null, hasOrchestrator = true }: NavBarProps) {
```

Wrap the Swarm button (lines 61-70) in a conditional:

```typescript
{hasOrchestrator && (
  <button
    className={`nav-btn ${activeSidebar === 'swarm' ? 'active' : ''}`}
    onClick={() => onToggle('swarm')}
    title="Swarm"
    aria-label="Swarm"
  >
    <Zap size={18} />
    <span className="nav-label">Swarm</span>
    {swarmApprovalCount > 0 && <span className="nav-badge">{swarmBadgeLabel}</span>}
  </button>
)}
```

- [ ] **Step 4: Pass the prop from App.tsx**

Open `src/App.tsx`. Add the import at the top (with other imports from providers):

```typescript
import { getCapabilities } from './providers/capabilities';
```

Find the `<NavBar` JSX (around line 4410). Add the `hasOrchestrator` prop:

```typescript
<NavBar
  activeSidebar={sidebarOpen}
  onToggle={toggleSidebar}
  gitChangeCount={gitChangeCount}
  swarmApprovalCount={swarmApprovalCount}
  chatNotificationCount={chatNotificationCount}
  overallStatus={approvalSessions.size > 0 ? 'approval' : completedWorkspaces.size > 0 ? 'done' : busyWorkspaces.size > 0 ? 'busy' : null}
  hasOrchestrator={getCapabilities(aiProvider).hasOrchestrator}
/>
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run --project unit tests/unit/components/NavBar.test.tsx --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/NavBar.tsx src/App.tsx tests/unit/components/NavBar.test.tsx
git commit -m "feat: hide Swarm nav button for non-orchestrator providers"
```

---

## Task 6: Replace `aiProvider ===` checks with capability flags in ChatInput

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`
- Modify: `tests/unit/components/Chat/ChatInput.test.tsx`

- [ ] **Step 1: Write failing tests for capability-gated controls**

Open `tests/unit/components/Chat/ChatInput.test.tsx`. Read the existing test setup to understand `defaultProps` and the mock pattern. Add:

```typescript
import { getCapabilities } from '../../../../src/providers/capabilities';

describe('capability-gated toolbar controls', () => {
  it('renders effort mode button for claude', () => {
    render(<ChatInput {...defaultProps} aiProvider="claude" effortLevel="medium" onEffortChange={vi.fn()} />);
    // effort mode button exists for claude
    expect(document.querySelector('.effort-btn')).toBeInTheDocument();
  });

  it('hides effort mode button for gemini', () => {
    render(<ChatInput {...defaultProps} aiProvider="gemini" />);
    expect(document.querySelector('.effort-btn')).not.toBeInTheDocument();
  });

  it('hides effort mode button for codex', () => {
    render(<ChatInput {...defaultProps} aiProvider="codex" />);
    expect(document.querySelector('.effort-btn')).not.toBeInTheDocument();
  });

  it('renders conversation mode toggle for gemini', () => {
    render(<ChatInput {...defaultProps} aiProvider="gemini" geminiConversationMode="planning" onGeminiConversationModeChange={vi.fn()} />);
    expect(screen.getByTitle(/Conversation mode/i)).toBeInTheDocument();
  });

  it('hides conversation mode toggle for claude', () => {
    render(<ChatInput {...defaultProps} aiProvider="claude" />);
    expect(screen.queryByTitle(/Conversation mode/i)).not.toBeInTheDocument();
  });

  it('hides conversation mode toggle for codex', () => {
    render(<ChatInput {...defaultProps} aiProvider="codex" />);
    expect(screen.queryByTitle(/Conversation mode/i)).not.toBeInTheDocument();
  });
});
```

Note: look up the actual `aiProvider` prop name in `ChatInput`'s prop interface before writing. If `ChatInput` receives `aiProvider` as a direct prop, use it; if it's nested differently, adjust accordingly.

- [ ] **Step 2: Run to confirm tests fail (or confirm positive cases already pass)**

```bash
npx vitest run --project unit tests/unit/components/Chat/ChatInput.test.tsx --pool=forks --poolOptions.forks.maxForks=2
```

Expected: The gemini/codex hide tests may fail if the current code shows effort mode for all providers. The claude positive tests should pass.

- [ ] **Step 3: Replace conditionals in ChatInput.tsx**

Open `src/components/Chat/ChatInput.tsx`. Add the import near the top:

```typescript
import { getCapabilities } from '../../providers/capabilities';
```

Find the effort level button (around line 1120). Change:

```typescript
// before:
{aiProvider === 'claude' && (() => {

// after:
{getCapabilities(aiProvider).hasEffortMode && (() => {
```

Find the conversation mode toggle (around line 1245). Change:

```typescript
// before:
{aiProvider === 'gemini' && (

// after:
{getCapabilities(aiProvider).hasConversationMode && (
```

Leave all other provider-specific blocks (model selectors, approval mode blocks) unchanged — they already render correctly per provider.

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run --project unit tests/unit/components/Chat/ChatInput.test.tsx --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatInput.tsx tests/unit/components/Chat/ChatInput.test.tsx
git commit -m "feat: replace aiProvider checks with capability flags in ChatInput toolbar"
```

---

## Task 7: Expand Gemini settings page

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/App.tsx`

The Gemini settings in both `App.tsx` and `SettingsModal.tsx` share a nested `gemini` object in `settings.json`. The state and persistence in `App.tsx` are already wired for model, approvalMode, and conversationMode (they're saved by the toolbar handlers). The settings modal just needs UI controls + sync via `onSettingChange`.

- [ ] **Step 1: Add state to SettingsModal**

Open `src/components/SettingsModal.tsx`. After the `geminiLoadingPhrases` state (line 91), add:

```typescript
const [geminiDefaultModel, setGeminiDefaultModel] = useState('auto-gemini-3');
const [geminiDefaultApprovalMode, setGeminiDefaultApprovalMode] = useState<'default' | 'auto_edit' | 'yolo' | 'plan'>('default');
const [geminiDefaultConversationMode, setGeminiDefaultConversationMode] = useState<'planning' | 'fast'>('planning');
```

- [ ] **Step 2: Load from settings on mount**

Find the `settingsGet('gemini', {})` block in the `useEffect` (around line 117). Expand it:

```typescript
window.sai.settingsGet('gemini', {}).then((g: any) => {
  if (g.loadingPhrases === 'witty' || g.loadingPhrases === 'tips' || g.loadingPhrases === 'all' || g.loadingPhrases === 'off') setGeminiLoadingPhrases(g.loadingPhrases);
  if (g.model) setGeminiDefaultModel(g.model);
  if (g.approvalMode === 'default' || g.approvalMode === 'auto_edit' || g.approvalMode === 'yolo' || g.approvalMode === 'plan') setGeminiDefaultApprovalMode(g.approvalMode);
  if (g.conversationMode === 'planning' || g.conversationMode === 'fast') setGeminiDefaultConversationMode(g.conversationMode);
});
```

- [ ] **Step 3: Add change handlers**

After `handleGeminiLoadingPhrasesChange` (around line 291), add:

```typescript
const handleGeminiDefaultModelChange = (model: string) => {
  setGeminiDefaultModel(model);
  window.sai.settingsGet('gemini', {}).then((existing: any) => {
    window.sai.settingsSet('gemini', { ...existing, model });
  });
  onSettingChange?.('geminiModel', model);
};

const handleGeminiDefaultApprovalModeChange = (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => {
  setGeminiDefaultApprovalMode(mode);
  window.sai.settingsGet('gemini', {}).then((existing: any) => {
    window.sai.settingsSet('gemini', { ...existing, approvalMode: mode });
  });
  onSettingChange?.('geminiApprovalMode', mode);
};

const handleGeminiDefaultConversationModeChange = (mode: 'planning' | 'fast') => {
  setGeminiDefaultConversationMode(mode);
  window.sai.settingsGet('gemini', {}).then((existing: any) => {
    window.sai.settingsSet('gemini', { ...existing, conversationMode: mode });
  });
  onSettingChange?.('geminiConversationMode', mode);
};
```

- [ ] **Step 4: Add UI controls to renderGeminiPage**

Find `renderGeminiPage` (around line 835). Replace its contents with:

```typescript
const renderGeminiPage = () => (
  <section className="settings-section">
    <div className="settings-section-label">Gemini</div>
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name">Default model</div>
        <div className="settings-row-desc">Pre-selected model when starting a new Gemini session</div>
      </div>
      <select
        className="settings-select"
        value={geminiDefaultModel}
        onChange={e => handleGeminiDefaultModelChange(e.target.value)}
      >
        <option value="auto-gemini-3">auto-gemini-3</option>
        <option value="auto-gemini-2.5">auto-gemini-2.5</option>
        <option value="gemini-3.1-pro">gemini-3.1-pro</option>
        <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
        <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
      </select>
    </div>
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name">Default approval mode</div>
        <div className="settings-row-desc">How Gemini handles file edits and tool calls</div>
      </div>
      <select
        className="settings-select"
        value={geminiDefaultApprovalMode}
        onChange={e => handleGeminiDefaultApprovalModeChange(e.target.value as any)}
      >
        <option value="default">Default</option>
        <option value="auto_edit">Auto Edit</option>
        <option value="yolo">Yolo</option>
        <option value="plan">Plan</option>
      </select>
    </div>
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name">Default conversation mode</div>
        <div className="settings-row-desc">Planning uses extended thinking; Fast is quicker</div>
      </div>
      <select
        className="settings-select"
        value={geminiDefaultConversationMode}
        onChange={e => handleGeminiDefaultConversationModeChange(e.target.value as any)}
      >
        <option value="planning">Planning</option>
        <option value="fast">Fast</option>
      </select>
    </div>
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name">Loading phrases</div>
        <div className="settings-row-desc">What to show while Gemini is thinking</div>
      </div>
      <select
        className="settings-select"
        value={geminiLoadingPhrases}
        onChange={e => handleGeminiLoadingPhrasesChange(e.target.value as any)}
      >
        <option value="all">All (witty + tips)</option>
        <option value="witty">Witty phrases</option>
        <option value="tips">Informative tips</option>
        <option value="off">Off</option>
      </select>
    </div>
  </section>
);
```

- [ ] **Step 5: Add onSettingChange handlers in App.tsx**

Open `src/App.tsx`. Find the `onSettingChange` handler (around line 4325). Add after the `geminiLoadingPhrases` line (4331):

```typescript
if (key === 'geminiModel') handleGeminiModelChange(value);
if (key === 'geminiApprovalMode') handleGeminiApprovalModeChange(value);
if (key === 'geminiConversationMode') handleGeminiConversationModeChange(value);
```

- [ ] **Step 6: Run the full unit test suite to confirm no regressions**

```bash
npx vitest run --project unit --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All tests pass. If any fail, investigate before committing.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsModal.tsx src/App.tsx
git commit -m "feat: expand Gemini settings page with default model, approval mode, conversation mode"
```

---

## Task 8: Full test run and manual smoke test

- [ ] **Step 1: Run full unit test suite**

```bash
npx vitest run --project unit --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass.

- [ ] **Step 2: Manual smoke test checklist**

Start the app (`npm run dev`) and verify:

1. Switch provider Claude → Gemini in settings
   - Chat sidebar shows only Gemini sessions (empty if first use)
   - Swarm button gone from NavBar
   - Toolbar shows conversation mode + approval mode toggles, no effort level button
2. Change default model in Gemini settings → start new session → model pre-selected
3. Change default approval mode in Gemini settings → start new session → approval mode pre-set
4. Change default conversation mode → start new session → conversation mode pre-set
5. Switch back to Claude → Claude history returns, Swarm button reappears, effort level shows
6. Switch to Codex → only Codex sessions shown, Swarm gone, no effort/conversation controls
7. No console errors during any provider switch

- [ ] **Step 3: Commit final cleanup if needed**

```bash
git add -p  # stage only intentional changes
git commit -m "feat: gemini first-class provider pass complete"
```
