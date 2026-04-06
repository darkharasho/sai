# Terminal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Warp-inspired terminal-first view where commands render as structured blocks with inline AI assistance and an approval flow.

**Architecture:** Terminal Mode is a new top-level view in App.tsx, toggled via the NavBar. It owns its own PTY and renders commands/output as React component blocks instead of a raw xterm terminal. AI integration reuses the existing `claudeSend`/`claudeOnMessage` IPC, with responses rendered inline and suggested commands gated behind an approve/reject/edit flow.

**Tech Stack:** React 19, TypeScript, Lucide icons, node-pty (via existing IPC), existing AI provider IPC (`claudeSend`, `claudeOnMessage`)

**Spec:** `docs/superpowers/specs/2026-04-05-terminal-mode-design.md`

---

### Task 1: Block Type Definitions

**Files:**
- Create: `src/components/TerminalMode/types.ts`

- [ ] **Step 1: Create the type definitions file**

```typescript
// src/components/TerminalMode/types.ts

export type BlockType = 'command' | 'ai-response' | 'approval';

export interface CommandBlock {
  type: 'command';
  id: string;
  command: string;
  output: string;
  exitCode: number | null;  // null = still running
  startTime: number;
  duration: number | null;
  groupId?: string;
}

export interface AIResponseBlock {
  type: 'ai-response';
  id: string;
  content: string;
  parentBlockId: string;
}

export interface ApprovalBlock {
  type: 'approval';
  id: string;
  command: string;
  parentBlockId: string;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
}

export type Block = CommandBlock | AIResponseBlock | ApprovalBlock;

export type InputMode = 'shell' | 'ai';
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: Clean output, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalMode/types.ts
git commit -m "feat(terminal-mode): add block type definitions"
```

---

### Task 2: NavBar Terminal Mode Button

**Files:**
- Modify: `src/components/NavBar.tsx`
- Modify: `tests/unit/components/NavBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/unit/components/NavBar.test.tsx`:

```typescript
it('renders terminal mode toggle button', () => {
  const { container } = render(
    <NavBar activeSidebar={null} onToggle={vi.fn()} />
  );
  expect(getNavButton(container, 'Terminal Mode')).toBeTruthy();
});

it('calls onToggle with "terminal-mode" when terminal mode button is clicked', () => {
  const onToggle = vi.fn();
  const { container } = render(
    <NavBar activeSidebar={null} onToggle={onToggle} />
  );
  fireEvent.click(getNavButton(container, 'Terminal Mode'));
  expect(onToggle).toHaveBeenCalledWith('terminal-mode');
});

it('adds active class to terminal mode button when activeSidebar is "terminal-mode"', () => {
  const { container } = render(
    <NavBar activeSidebar="terminal-mode" onToggle={vi.fn()} />
  );
  const btn = getNavButton(container, 'Terminal Mode');
  expect(btn.className).toContain('active');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/NavBar.test.tsx`
Expected: 3 new tests FAIL — no button with title "Terminal Mode" found.

- [ ] **Step 3: Add the Terminal Mode button to NavBar**

In `src/components/NavBar.tsx`, add the `SquareTerminal` import and the button:

```typescript
import { FolderClosed, GitBranch, SquareTerminal } from 'lucide-react';
```

Add this button after the git button (before the closing `</div>` of `.navbar`):

```tsx
      <button
        className={`nav-btn ${activeSidebar === 'terminal-mode' ? 'active' : ''}`}
        onClick={() => onToggle('terminal-mode')}
        title="Terminal Mode"
      >
        <SquareTerminal size={20} />
      </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/NavBar.test.tsx`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/NavBar.tsx tests/unit/components/NavBar.test.tsx
git commit -m "feat(terminal-mode): add terminal mode button to navbar"
```

---

### Task 3: View Switching in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add activeView state and modify toggleSidebar**

At the top of the `App()` function (near `sidebarOpen` state around line 86), add:

```typescript
const [activeView, setActiveView] = useState<'default' | 'terminal-mode'>('default');
```

Modify the `toggleSidebar` function (around line 952) to handle the terminal-mode toggle differently — it switches the view instead of opening a sidebar:

```typescript
const toggleSidebar = (id: string) => {
  if (id === 'terminal-mode') {
    setActiveView(prev => prev === 'terminal-mode' ? 'default' : 'terminal-mode');
    return;
  }
  if (activeView === 'terminal-mode') setActiveView('default');
  setSidebarOpen(prev => prev === id ? null : id);
};
```

- [ ] **Step 2: Create a placeholder TerminalModeView component**

Create `src/components/TerminalMode/TerminalModeView.tsx`:

```tsx
export default function TerminalModeView({ projectPath }: { projectPath: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      Terminal Mode — {projectPath}
    </div>
  );
}
```

- [ ] **Step 3: Conditionally render TerminalModeView in App.tsx**

Import the new component at the top of `App.tsx`:

```typescript
import TerminalModeView from './components/TerminalMode/TerminalModeView';
```

In the `app-body` div (around line 1347), wrap the existing main-content in a conditional:

Replace:
```tsx
        <div className="main-content" ref={mainContentRef}>
          {allPanels.map((panel, i) => (
            <div key={panel} style={{ display: 'contents' }}>
              {renderPanel(panel)}
              {showHandleAfter(panel) && (
                <div
                  className={`drag-handle ${isDragging ? 'dragging' : ''}`}
                  onMouseDown={handleDragStart}
                />
              )}
            </div>
          ))}
        </div>
```

With:
```tsx
        {activeView === 'terminal-mode' ? (
          <div className="main-content" style={{ display: 'flex' }}>
            <TerminalModeView projectPath={projectPath} />
          </div>
        ) : (
          <div className="main-content" ref={mainContentRef}>
            {allPanels.map((panel, i) => (
              <div key={panel} style={{ display: 'contents' }}>
                {renderPanel(panel)}
                {showHandleAfter(panel) && (
                  <div
                    className={`drag-handle ${isDragging ? 'dragging' : ''}`}
                    onMouseDown={handleDragStart}
                  />
                )}
              </div>
            ))}
          </div>
        )}
```

- [ ] **Step 4: Verify it compiles and the view toggles**

Run: `npx tsc --noEmit`
Expected: Clean.

Run: `npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/TerminalMode/TerminalModeView.tsx
git commit -m "feat(terminal-mode): add view switching between default and terminal mode"
```

---

### Task 4: CommandBlock Component

**Files:**
- Create: `src/components/TerminalMode/CommandBlock.tsx`
- Create: `tests/unit/components/TerminalMode/CommandBlock.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/TerminalMode/CommandBlock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CommandBlock from '../../../../src/components/TerminalMode/CommandBlock';
import type { CommandBlock as CommandBlockType } from '../../../../src/components/TerminalMode/types';

const baseBlock: CommandBlockType = {
  type: 'command',
  id: '1',
  command: 'npm run build',
  output: 'Compiled successfully in 812ms\nBuild output: dist/',
  exitCode: 0,
  startTime: Date.now() - 800,
  duration: 800,
};

describe('CommandBlock', () => {
  it('renders the command text', () => {
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('$ npm run build');
  });

  it('renders the output', () => {
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('Compiled successfully in 812ms');
  });

  it('shows success status for exit code 0', () => {
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('0.8s');
  });

  it('shows failure status for non-zero exit code', () => {
    const failBlock = { ...baseBlock, exitCode: 1 };
    const { container } = render(
      <CommandBlock block={failBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('exit 1');
  });

  it('shows running state when exitCode is null', () => {
    const runningBlock = { ...baseBlock, exitCode: null, duration: null };
    const { container } = render(
      <CommandBlock block={runningBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('running');
  });

  it('calls onCopy when copy icon is clicked', () => {
    const onCopy = vi.fn();
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={onCopy} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    const copyBtn = container.querySelector('[title="Copy output"]') as HTMLElement;
    fireEvent.click(copyBtn);
    expect(onCopy).toHaveBeenCalledWith(baseBlock.output);
  });

  it('calls onAskAI when sparkles icon is clicked', () => {
    const onAskAI = vi.fn();
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={onAskAI} onRerun={vi.fn()} />
    );
    const aiBtn = container.querySelector('[title="Ask AI"]') as HTMLElement;
    fireEvent.click(aiBtn);
    expect(onAskAI).toHaveBeenCalledWith(baseBlock);
  });

  it('calls onRerun when rerun icon is clicked', () => {
    const onRerun = vi.fn();
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={onRerun} />
    );
    const rerunBtn = container.querySelector('[title="Rerun"]') as HTMLElement;
    fireEvent.click(rerunBtn);
    expect(onRerun).toHaveBeenCalledWith(baseBlock.command);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/CommandBlock.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CommandBlock**

Create `src/components/TerminalMode/CommandBlock.tsx`:

```tsx
import { Copy, Sparkles, RotateCw } from 'lucide-react';
import type { CommandBlock as CommandBlockType } from './types';

interface CommandBlockProps {
  block: CommandBlockType;
  onCopy: (text: string) => void;
  onAskAI: (block: CommandBlockType) => void;
  onRerun: (command: string) => void;
  isGrouped?: 'first' | 'middle' | 'last' | 'only';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function CommandBlock({ block, onCopy, onAskAI, onRerun, isGrouped }: CommandBlockProps) {
  const isRunning = block.exitCode === null;
  const isSuccess = block.exitCode === 0;
  const isFail = block.exitCode !== null && block.exitCode !== 0;

  const borderRadius = isGrouped === 'first' ? '4px 4px 0 0'
    : isGrouped === 'middle' ? '0'
    : isGrouped === 'last' ? '0 0 4px 4px'
    : '4px';

  const borderColor = isFail ? 'rgba(248, 81, 73, 0.27)' : 'var(--border)';
  const showTopSeparator = isGrouped === 'middle' || isGrouped === 'last';

  return (
    <div style={{
      border: `1px solid ${borderColor}`,
      borderRadius,
      overflow: 'hidden',
      ...(showTopSeparator ? { borderTop: '1px solid var(--bg-hover)' } : {}),
    }}>
      {/* Command row */}
      <div className="tm-block-header">
        <span className="tm-command-text">$ {block.command}</span>
        <div className="tm-block-actions">
          <span className="tm-icon" title="Copy output" onClick={() => onCopy(block.output)}>
            <Copy size={11} />
          </span>
          <span className="tm-icon" title="Ask AI" onClick={() => onAskAI(block)}>
            <Sparkles size={11} />
          </span>
          <span className="tm-icon" title="Rerun" onClick={() => onRerun(block.command)}>
            <RotateCw size={11} />
          </span>
          {isRunning && <span className="tm-status tm-status-running">running</span>}
          {isSuccess && <span className="tm-status tm-status-success">{'\u2713'} {formatDuration(block.duration!)}</span>}
          {isFail && <span className="tm-status tm-status-fail">{'\u2717'} exit {block.exitCode}</span>}
        </div>
      </div>

      {/* Output */}
      {block.output && (
        <div className="tm-block-output">
          {block.output}
        </div>
      )}

      <style>{`
        .tm-block-header {
          background: var(--bg);
          padding: 6px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--bg-hover);
        }
        .tm-command-text {
          color: #58a6ff;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
        .tm-block-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tm-icon {
          color: var(--text-muted);
          opacity: 0.4;
          cursor: pointer;
          display: flex;
          align-items: center;
          transition: opacity 0.15s, color 0.15s;
        }
        .tm-icon:hover {
          opacity: 1;
          color: var(--text);
        }
        .tm-status {
          font-size: 10px;
          margin-left: 4px;
        }
        .tm-status-running {
          color: var(--accent);
        }
        .tm-status-success {
          color: var(--green);
        }
        .tm-status-fail {
          color: var(--red);
        }
        .tm-block-output {
          background: var(--bg);
          padding: 8px 10px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-all;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/CommandBlock.test.tsx`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalMode/CommandBlock.tsx tests/unit/components/TerminalMode/CommandBlock.test.tsx
git commit -m "feat(terminal-mode): add CommandBlock component with tests"
```

---

### Task 5: AIResponseBlock Component

**Files:**
- Create: `src/components/TerminalMode/AIResponseBlock.tsx`
- Create: `tests/unit/components/TerminalMode/AIResponseBlock.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/TerminalMode/AIResponseBlock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AIResponseBlock from '../../../../src/components/TerminalMode/AIResponseBlock';
import type { AIResponseBlock as AIResponseBlockType } from '../../../../src/components/TerminalMode/types';

const baseBlock: AIResponseBlockType = {
  type: 'ai-response',
  id: '2',
  content: 'Your `add()` function returns `a + b + 1` instead of `a + b`.',
  parentBlockId: '1',
};

describe('AIResponseBlock', () => {
  it('renders the AI label', () => {
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={vi.fn()} />
    );
    expect(container.textContent).toContain('Claude');
  });

  it('renders the response content as markdown', () => {
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={vi.fn()} />
    );
    // The content should contain the text (rendered from markdown)
    expect(container.textContent).toContain('add()');
  });

  it('calls onCopy when copy icon is clicked', () => {
    const onCopy = vi.fn();
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={onCopy} />
    );
    const copyBtn = container.querySelector('[title="Copy"]') as HTMLElement;
    fireEvent.click(copyBtn);
    expect(onCopy).toHaveBeenCalledWith(baseBlock.content);
  });

  it('collapses and expands when chevron is clicked', () => {
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={vi.fn()} />
    );
    const chevron = container.querySelector('[title="Collapse"]') as HTMLElement;
    fireEvent.click(chevron);
    // After collapsing, the body should be hidden
    const body = container.querySelector('.tm-ai-body') as HTMLElement;
    expect(body.style.display).toBe('none');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/AIResponseBlock.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AIResponseBlock**

Create `src/components/TerminalMode/AIResponseBlock.tsx`:

```tsx
import { useState } from 'react';
import { Copy, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AIResponseBlock as AIResponseBlockType } from './types';

interface AIResponseBlockProps {
  block: AIResponseBlockType;
  onCopy: (text: string) => void;
}

export default function AIResponseBlock({ block, onCopy }: AIResponseBlockProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="tm-ai-block">
      {/* Header */}
      <div className="tm-ai-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={12} color="#a371f7" />
          <span className="tm-ai-label">Claude</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="tm-icon" title="Copy" onClick={() => onCopy(block.content)}>
            <Copy size={11} />
          </span>
          <span
            className="tm-icon"
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="tm-ai-body" style={{ display: collapsed ? 'none' : undefined }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {block.content}
        </ReactMarkdown>
      </div>

      <style>{`
        .tm-ai-block {
          border: 1px solid rgba(163, 113, 247, 0.2);
          border-radius: 4px;
          overflow: hidden;
        }
        .tm-ai-header {
          background: var(--bg);
          padding: 6px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(163, 113, 247, 0.13);
        }
        .tm-ai-label {
          color: #a371f7;
          font-size: 11px;
          font-weight: 500;
        }
        .tm-ai-body {
          background: var(--bg);
          padding: 10px 12px;
          color: var(--text);
          font-size: 12px;
          line-height: 1.6;
        }
        .tm-ai-body p { margin: 0 0 8px 0; }
        .tm-ai-body p:last-child { margin-bottom: 0; }
        .tm-ai-body code {
          background: var(--bg-hover);
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/AIResponseBlock.test.tsx`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalMode/AIResponseBlock.tsx tests/unit/components/TerminalMode/AIResponseBlock.test.tsx
git commit -m "feat(terminal-mode): add AIResponseBlock component with tests"
```

---

### Task 6: ApprovalBlock Component

**Files:**
- Create: `src/components/TerminalMode/ApprovalBlock.tsx`
- Create: `tests/unit/components/TerminalMode/ApprovalBlock.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/TerminalMode/ApprovalBlock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ApprovalBlock from '../../../../src/components/TerminalMode/ApprovalBlock';
import type { ApprovalBlock as ApprovalBlockType } from '../../../../src/components/TerminalMode/types';

const pendingBlock: ApprovalBlockType = {
  type: 'approval',
  id: '3',
  command: "sed -i 's/a + b + 1/a + b/' src/utils.ts",
  parentBlockId: '2',
  status: 'pending',
};

describe('ApprovalBlock', () => {
  it('renders the suggested command', () => {
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    expect(container.textContent).toContain("sed -i 's/a + b + 1/a + b/' src/utils.ts");
  });

  it('shows approve and reject buttons when pending', () => {
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    expect(container.textContent).toContain('approve');
    expect(container.textContent).toContain('reject');
  });

  it('calls onApprove when approve is clicked', () => {
    const onApprove = vi.fn();
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    const approveBtn = container.querySelector('[title="Approve"]') as HTMLElement;
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledWith(pendingBlock);
  });

  it('calls onReject when reject is clicked', () => {
    const onReject = vi.fn();
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={onReject} onEdit={vi.fn()} />
    );
    const rejectBtn = container.querySelector('[title="Reject"]') as HTMLElement;
    fireEvent.click(rejectBtn);
    expect(onReject).toHaveBeenCalledWith(pendingBlock);
  });

  it('calls onEdit when edit icon is clicked', () => {
    const onEdit = vi.fn();
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={vi.fn()} onEdit={onEdit} />
    );
    const editBtn = container.querySelector('[title="Edit"]') as HTMLElement;
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(pendingBlock);
  });

  it('hides approve/reject buttons when not pending', () => {
    const approved = { ...pendingBlock, status: 'approved' as const };
    const { container } = render(
      <ApprovalBlock block={approved} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    expect(container.querySelector('[title="Approve"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/ApprovalBlock.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ApprovalBlock**

Create `src/components/TerminalMode/ApprovalBlock.tsx`:

```tsx
import { Check, X, Pencil } from 'lucide-react';
import type { ApprovalBlock as ApprovalBlockType } from './types';

interface ApprovalBlockProps {
  block: ApprovalBlockType;
  onApprove: (block: ApprovalBlockType) => void;
  onReject: (block: ApprovalBlockType) => void;
  onEdit: (block: ApprovalBlockType) => void;
}

export default function ApprovalBlock({ block, onApprove, onReject, onEdit }: ApprovalBlockProps) {
  const isPending = block.status === 'pending';

  return (
    <div className={`tm-approval-block ${block.status !== 'pending' ? 'tm-approval-resolved' : ''}`}>
      <div className="tm-approval-content">
        <div className="tm-approval-command">
          <span className="tm-approval-prompt">{'\u276F'}</span> {block.command}
        </div>
        {isPending && (
          <div className="tm-approval-actions">
            <span className="tm-icon" title="Edit" onClick={() => onEdit(block)}>
              <Pencil size={11} />
            </span>
            <span className="tm-approval-divider">{'\u2502'}</span>
            <span className="tm-approval-approve" title="Approve" onClick={() => onApprove(block)}>
              <Check size={11} />
              approve
            </span>
            <span className="tm-approval-reject" title="Reject" onClick={() => onReject(block)}>
              <X size={11} />
              reject
            </span>
          </div>
        )}
      </div>

      <style>{`
        .tm-approval-block {
          border: 1px solid var(--border);
          border-radius: 4px;
          overflow: hidden;
        }
        .tm-approval-resolved {
          opacity: 0.5;
        }
        .tm-approval-content {
          background: var(--bg);
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tm-approval-command {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text);
          flex: 1;
        }
        .tm-approval-prompt {
          color: var(--accent);
          opacity: 0.8;
        }
        .tm-approval-actions {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-shrink: 0;
        }
        .tm-approval-divider {
          color: var(--border);
        }
        .tm-approval-approve {
          color: var(--green);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 2px 8px;
          border: 1px solid rgba(63, 185, 80, 0.2);
          border-radius: 3px;
          font-size: 10px;
        }
        .tm-approval-approve:hover {
          border-color: rgba(63, 185, 80, 0.4);
        }
        .tm-approval-reject {
          color: var(--red);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          opacity: 0.5;
          font-size: 10px;
        }
        .tm-approval-reject:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/ApprovalBlock.test.tsx`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalMode/ApprovalBlock.tsx tests/unit/components/TerminalMode/ApprovalBlock.test.tsx
git commit -m "feat(terminal-mode): add ApprovalBlock component with tests"
```

---

### Task 7: TerminalModeInput Component

**Files:**
- Create: `src/components/TerminalMode/TerminalModeInput.tsx`
- Create: `tests/unit/components/TerminalMode/TerminalModeInput.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/TerminalMode/TerminalModeInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import TerminalModeInput from '../../../../src/components/TerminalMode/TerminalModeInput';

describe('TerminalModeInput', () => {
  it('renders with $ prompt in shell mode', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={vi.fn()} />
    );
    expect(container.textContent).toContain('$');
  });

  it('renders with sparkle prompt in AI mode', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="ai" onToggleMode={vi.fn()} />
    );
    const prompt = container.querySelector('.tm-input-prompt');
    expect(prompt?.textContent).toContain('\u2726');
  });

  it('calls onSubmit with input value on Enter', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TerminalModeInput onSubmit={onSubmit} mode="shell" onToggleMode={vi.fn()} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('ls -la');
  });

  it('clears input after submit', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={vi.fn()} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('calls onToggleMode when Tab is pressed', () => {
    const onToggleMode = vi.fn();
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={onToggleMode} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onToggleMode).toHaveBeenCalled();
  });

  it('does not submit empty input', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TerminalModeInput onSubmit={onSubmit} mode="shell" onToggleMode={vi.fn()} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('populates input when initialValue is provided', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={vi.fn()} initialValue="echo hello" />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('echo hello');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/TerminalModeInput.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TerminalModeInput**

Create `src/components/TerminalMode/TerminalModeInput.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { InputMode } from './types';

interface TerminalModeInputProps {
  onSubmit: (value: string) => void;
  mode: InputMode;
  onToggleMode: () => void;
  initialValue?: string;
  disabled?: boolean;
}

export default function TerminalModeInput({ onSubmit, mode, onToggleMode, initialValue, disabled }: TerminalModeInputProps) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialValue !== undefined) setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      onToggleMode();
      return;
    }
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
      setValue('');
    }
  };

  const isAI = mode === 'ai';

  return (
    <div className="tm-input-wrapper">
      <div className="tm-input-box">
        <div className="tm-input-row">
          <span className={`tm-input-prompt ${isAI ? 'tm-input-prompt-ai' : ''}`}>
            {isAI ? '\u2726' : '$'}
          </span>
          <input
            ref={inputRef}
            className="tm-input-field"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAI ? 'Ask AI...' : 'Enter command...'}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="tm-input-toolbar">
          <div style={{ flex: 1 }} />
          <div className="tm-input-toolbar-right">
            <span className="tm-input-hint">
              tab {'\u2192'} {isAI
                ? <span>$ shell</span>
                : <span className="tm-input-hint-ai">{'\u2726'} ai</span>}
            </span>
            <span className="tm-input-divider">{'\u2502'}</span>
            <span className="tm-icon" onClick={() => value.trim() && onSubmit(value.trim())}>
              <CornerDownLeft size={14} color={isAI ? '#a371f7' : 'var(--accent)'} />
            </span>
          </div>
        </div>
      </div>

      <style>{`
        .tm-input-wrapper {
          padding: 0 15% 14px;
          margin-top: 8px;
        }
        .tm-input-box {
          position: relative;
          border-radius: 4px;
          background: var(--bg);
          overflow: visible;
        }
        .tm-input-box::before {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 6px;
          padding: 2px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--orange) 20%, var(--red) 50%, var(--orange) 80%, var(--accent) 100%);
          background-size: 300% 300%;
          animation: gradient-sweep 20s ease-in-out infinite alternate;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 0;
          opacity: 0.7;
          transition: opacity 0.2s ease;
        }
        .tm-input-box:focus-within::before {
          opacity: 1;
        }
        .tm-input-row {
          position: relative;
          z-index: 1;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tm-input-prompt {
          color: var(--accent);
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .tm-input-prompt-ai {
          color: #a371f7;
        }
        .tm-input-field {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: var(--text);
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }
        .tm-input-field::placeholder {
          color: var(--text-muted);
        }
        .tm-input-toolbar {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          padding: 4px 8px 6px;
          gap: 4px;
          border-top: 1px solid var(--bg-hover);
        }
        .tm-input-toolbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-right: 6px;
        }
        .tm-input-hint {
          color: var(--text-muted);
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
        }
        .tm-input-hint-ai {
          color: #a371f7;
        }
        .tm-input-divider {
          color: var(--border);
        }
        @keyframes gradient-sweep {
          0% { background-position: 0% 0%; }
          100% { background-position: 100% 100%; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/TerminalModeInput.test.tsx`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalMode/TerminalModeInput.tsx tests/unit/components/TerminalMode/TerminalModeInput.test.tsx
git commit -m "feat(terminal-mode): add TerminalModeInput component with shell/AI toggle"
```

---

### Task 8: TerminalModeBlockList Component

**Files:**
- Create: `src/components/TerminalMode/TerminalModeBlockList.tsx`

- [ ] **Step 1: Implement TerminalModeBlockList**

This component renders the scrollable block list with grouping and connectors.

Create `src/components/TerminalMode/TerminalModeBlockList.tsx`:

```tsx
import { useRef, useEffect } from 'react';
import CommandBlock from './CommandBlock';
import AIResponseBlock from './AIResponseBlock';
import ApprovalBlock from './ApprovalBlock';
import type { Block, CommandBlock as CommandBlockType, AIResponseBlock as AIResponseBlockType, ApprovalBlock as ApprovalBlockType } from './types';

interface TerminalModeBlockListProps {
  blocks: Block[];
  onCopy: (text: string) => void;
  onAskAI: (block: CommandBlockType) => void;
  onRerun: (command: string) => void;
  onApprove: (block: ApprovalBlockType) => void;
  onReject: (block: ApprovalBlockType) => void;
  onEdit: (block: ApprovalBlockType) => void;
}

/** Determine the group position of a command block for connected rendering. */
function getGroupPosition(blocks: Block[], index: number): 'first' | 'middle' | 'last' | 'only' {
  const block = blocks[index];
  if (block.type !== 'command' || !block.groupId) return 'only';

  const prev = index > 0 ? blocks[index - 1] : null;
  const next = index < blocks.length - 1 ? blocks[index + 1] : null;
  const prevSameGroup = prev?.type === 'command' && prev.groupId === block.groupId;
  const nextSameGroup = next?.type === 'command' && next.groupId === block.groupId;

  if (!prevSameGroup && nextSameGroup) return 'first';
  if (prevSameGroup && nextSameGroup) return 'middle';
  if (prevSameGroup && !nextSameGroup) return 'last';
  return 'only';
}

/** Determine connector color based on block relationships. */
function getConnectorColor(block: Block): string | null {
  if (block.type === 'ai-response') return 'rgba(163, 113, 247, 0.27)';
  if (block.type === 'approval') return 'rgba(210, 153, 34, 0.2)';
  return null;
}

export default function TerminalModeBlockList({
  blocks, onCopy, onAskAI, onRerun, onApprove, onReject, onEdit,
}: TerminalModeBlockListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks.length]);

  return (
    <div className="tm-block-list">
      {blocks.map((block, i) => {
        const connectorColor = i > 0 ? getConnectorColor(block) : null;
        const needsGap = i > 0 && !connectorColor
          && !(block.type === 'command' && block.groupId
            && blocks[i - 1]?.type === 'command'
            && (blocks[i - 1] as CommandBlockType).groupId === block.groupId);

        return (
          <div key={block.id}>
            {connectorColor && (
              <div className="tm-connector" style={{ borderColor: connectorColor }} />
            )}
            {needsGap && <div style={{ height: 12 }} />}

            {block.type === 'command' && (
              <CommandBlock
                block={block}
                onCopy={onCopy}
                onAskAI={onAskAI}
                onRerun={onRerun}
                isGrouped={getGroupPosition(blocks, i)}
              />
            )}
            {block.type === 'ai-response' && (
              <AIResponseBlock block={block} onCopy={onCopy} />
            )}
            {block.type === 'approval' && (
              <ApprovalBlock block={block} onApprove={onApprove} onReject={onReject} onEdit={onEdit} />
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />

      <style>{`
        .tm-block-list {
          flex: 1;
          padding: 16px 15% 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .tm-connector {
          border-left: 2px solid;
          margin-left: 16px;
          height: 8px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalMode/TerminalModeBlockList.tsx
git commit -m "feat(terminal-mode): add TerminalModeBlockList with grouping and connectors"
```

---

### Task 9: ANSI Stripping Utility

**Files:**
- Create: `src/components/TerminalMode/stripAnsi.ts`
- Create: `tests/unit/components/TerminalMode/stripAnsi.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/TerminalMode/stripAnsi.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../../../../src/components/TerminalMode/stripAnsi';

describe('stripAnsi', () => {
  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('strips color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips bold/underline codes', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[22m')).toBe('bold');
  });

  it('strips cursor movement codes', () => {
    expect(stripAnsi('\x1b[2Jhello')).toBe('hello');
  });

  it('strips OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips multiple sequences in one string', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m \x1b[1mbold\x1b[0m')).toBe('green bold');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/stripAnsi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement stripAnsi**

Create `src/components/TerminalMode/stripAnsi.ts`:

```typescript
// Matches ANSI escape sequences: CSI (ESC[...), OSC (ESC]...BEL/ST), and other ESC sequences
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b\(B|\x1b[=>]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/stripAnsi.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalMode/stripAnsi.ts tests/unit/components/TerminalMode/stripAnsi.test.ts
git commit -m "feat(terminal-mode): add ANSI escape code stripping utility"
```

---

### Task 10: TerminalModeView — PTY Integration & Shell Execution

**Files:**
- Modify: `src/components/TerminalMode/TerminalModeView.tsx` (replace placeholder)

This is the core task — wiring up the PTY, capturing output, detecting command completion, and managing block state.

- [ ] **Step 1: Implement TerminalModeView with PTY integration**

Replace the placeholder `src/components/TerminalMode/TerminalModeView.tsx`:

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import TerminalModeBlockList from './TerminalModeBlockList';
import TerminalModeInput from './TerminalModeInput';
import { stripAnsi } from './stripAnsi';
import type { Block, CommandBlock as CommandBlockType, ApprovalBlock as ApprovalBlockType, InputMode } from './types';

// Reuse the prompt regex from terminalBuffer.ts
const PROMPT_RE = /^(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s/;
const EXIT_MARKER_RE = /__EXIT:(\d+)__/;

interface TerminalModeViewProps {
  projectPath: string;
}

let blockIdCounter = 0;
function nextBlockId(): string {
  return `tm-${++blockIdCounter}`;
}

let groupIdCounter = 0;
function nextGroupId(): string {
  return `grp-${++groupIdCounter}`;
}

export default function TerminalModeView({ projectPath }: TerminalModeViewProps) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>('shell');
  const [editValue, setEditValue] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);

  const ptyIdRef = useRef<number | null>(null);
  const activeBlockRef = useRef<string | null>(null);
  const outputBufferRef = useRef('');
  const startTimeRef = useRef(0);
  const currentGroupRef = useRef<string>(nextGroupId());

  // Create PTY on mount
  useEffect(() => {
    let cleanupData: (() => void) | null = null;

    const init = async () => {
      const id = await window.sai.terminalCreate(projectPath);
      ptyIdRef.current = id;

      cleanupData = window.sai.terminalOnData((ptyId: number, data: string) => {
        if (ptyId !== ptyIdRef.current) return;
        if (!activeBlockRef.current) return;

        const stripped = stripAnsi(data);
        outputBufferRef.current += stripped;

        // Check for exit marker
        const exitMatch = outputBufferRef.current.match(EXIT_MARKER_RE);
        if (exitMatch) {
          const exitCode = parseInt(exitMatch[1], 10);
          const duration = Date.now() - startTimeRef.current;

          // Clean up the output: remove the echoed command, exit marker, and trailing prompt
          let output = outputBufferRef.current;
          output = output.replace(EXIT_MARKER_RE, '');
          // Remove trailing prompt line
          const lines = output.split('\n');
          while (lines.length > 0 && PROMPT_RE.test(lines[lines.length - 1])) {
            lines.pop();
          }
          // Remove leading echoed command line
          if (lines.length > 0) lines.shift();
          output = lines.join('\n').trim();

          const blockId = activeBlockRef.current;
          setBlocks(prev => prev.map(b =>
            b.id === blockId && b.type === 'command'
              ? { ...b, output, exitCode, duration }
              : b
          ));
          activeBlockRef.current = null;
          outputBufferRef.current = '';
          setIsRunning(false);
        }
      });
    };

    init();

    return () => {
      cleanupData?.();
      if (ptyIdRef.current !== null) {
        window.sai.terminalKill(ptyIdRef.current);
      }
    };
  }, [projectPath]);

  const executeCommand = useCallback((command: string) => {
    if (ptyIdRef.current === null || isRunning) return;

    const blockId = nextBlockId();
    const block: CommandBlockType = {
      type: 'command',
      id: blockId,
      command,
      output: '',
      exitCode: null,
      startTime: Date.now(),
      duration: null,
      groupId: currentGroupRef.current,
    };

    setBlocks(prev => [...prev, block]);
    activeBlockRef.current = blockId;
    outputBufferRef.current = '';
    startTimeRef.current = Date.now();
    setIsRunning(true);

    // Write command with exit code marker appended
    window.sai.terminalWrite(ptyIdRef.current, `${command}; echo __EXIT:$?__\n`);
  }, [isRunning]);

  const handleSubmit = useCallback((value: string) => {
    if (inputMode === 'shell') {
      executeCommand(value);
      setEditValue(undefined);
    } else {
      // AI mode — send to Claude and handle response
      // Start a new group after AI interaction
      currentGroupRef.current = nextGroupId();
      handleAIRequest(value);
    }
  }, [inputMode, executeCommand]);

  const handleAIRequest = useCallback((prompt: string) => {
    // Send the prompt to the AI provider
    window.sai.claudeSend(projectPath, prompt, undefined, 'default', 'high', 'sonnet');

    const aiBlockId = nextBlockId();
    setBlocks(prev => [...prev, {
      type: 'ai-response',
      id: aiBlockId,
      content: '',
      parentBlockId: prev.length > 0 ? prev[prev.length - 1].id : '',
    }]);

    // Listen for streaming response
    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      if (msg.projectPath && msg.projectPath !== projectPath) return;

      if (msg.type === 'assistant' && msg.message) {
        setBlocks(prev => prev.map(b =>
          b.id === aiBlockId && b.type === 'ai-response'
            ? { ...b, content: b.content + msg.message }
            : b
        ));
      }

      if (msg.type === 'done') {
        cleanup();
        // Check if the AI response contains a suggested command (fenced bash block)
        setBlocks(prev => {
          const aiBlock = prev.find(b => b.id === aiBlockId);
          if (!aiBlock || aiBlock.type !== 'ai-response') return prev;

          const bashMatch = aiBlock.content.match(/```(?:bash|sh|shell)\n([\s\S]*?)```/);
          if (bashMatch) {
            const suggestedCmd = bashMatch[1].trim();
            return [...prev, {
              type: 'approval' as const,
              id: nextBlockId(),
              command: suggestedCmd,
              parentBlockId: aiBlockId,
              status: 'pending' as const,
            }];
          }
          return prev;
        });
      }
    });
  }, [projectPath]);

  const handleAskAI = useCallback((block: CommandBlockType) => {
    currentGroupRef.current = nextGroupId();
    const prompt = `The following command ${block.exitCode === 0 ? 'succeeded' : 'failed'} with exit code ${block.exitCode}:\n\n\`\`\`\n$ ${block.command}\n${block.output}\n\`\`\`\n\nAnalyze this and suggest a fix if needed. If you suggest a command, put it in a \`\`\`bash code block.`;
    handleAIRequest(prompt);
  }, [handleAIRequest]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleRerun = useCallback((command: string) => {
    executeCommand(command);
  }, [executeCommand]);

  const handleApprove = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'approved' as const } : b
    ));
    currentGroupRef.current = nextGroupId();
    executeCommand(block.command);
  }, [executeCommand]);

  const handleReject = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'rejected' as const } : b
    ));
  }, []);

  const handleEdit = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'edited' as const } : b
    ));
    setEditValue(block.command);
    setInputMode('shell');
  }, []);

  const toggleMode = useCallback(() => {
    setInputMode(prev => prev === 'shell' ? 'ai' : 'shell');
  }, []);

  return (
    <div className="tm-view">
      <TerminalModeBlockList
        blocks={blocks}
        onCopy={handleCopy}
        onAskAI={handleAskAI}
        onRerun={handleRerun}
        onApprove={handleApprove}
        onReject={handleReject}
        onEdit={handleEdit}
      />
      <TerminalModeInput
        onSubmit={handleSubmit}
        mode={inputMode}
        onToggleMode={toggleMode}
        initialValue={editValue}
        disabled={isRunning}
      />

      <style>{`
        .tm-view {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg);
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalMode/TerminalModeView.tsx
git commit -m "feat(terminal-mode): implement TerminalModeView with PTY integration and AI support"
```

---

### Task 11: TerminalModeEditor Side Panel

**Files:**
- Create: `src/components/TerminalMode/TerminalModeEditor.tsx`

- [ ] **Step 1: Implement TerminalModeEditor**

Create `src/components/TerminalMode/TerminalModeEditor.tsx`:

```tsx
import { useState } from 'react';
import { PanelRightClose } from 'lucide-react';

interface EditorFile {
  path: string;
  content: string;
  highlightLine?: number;
}

interface TerminalModeEditorProps {
  files: EditorFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onClose: () => void;
}

export default function TerminalModeEditor({ files, activeFile, onSelectFile, onClose }: TerminalModeEditorProps) {
  const file = files.find(f => f.path === activeFile);

  if (files.length === 0) return null;

  return (
    <div className="tm-editor">
      {/* Tab bar */}
      <div className="tm-editor-tabs">
        {files.map(f => (
          <div
            key={f.path}
            className={`tm-editor-tab ${f.path === activeFile ? 'tm-editor-tab-active' : ''}`}
            onClick={() => onSelectFile(f.path)}
          >
            {f.path.split('/').pop()}
          </div>
        ))}
        <div className="tm-editor-close" onClick={onClose}>
          <PanelRightClose size={14} />
        </div>
      </div>

      {/* File content */}
      <div className="tm-editor-content">
        {file && file.content.split('\n').map((line, i) => (
          <div
            key={i}
            className={file.highlightLine === i + 1 ? 'tm-editor-line-highlight' : ''}
          >
            <span className="tm-editor-line-num">{i + 1}</span>
            {'  '}{line}
          </div>
        ))}
      </div>

      <style>{`
        .tm-editor {
          width: 260px;
          border-left: 1px solid var(--border);
          background: var(--bg);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }
        .tm-editor-tabs {
          background: var(--bg);
          padding: 0;
          border-bottom: 1px solid var(--border);
          display: flex;
          font-size: 11px;
        }
        .tm-editor-tab {
          padding: 6px 12px;
          color: var(--text-muted);
          cursor: pointer;
        }
        .tm-editor-tab-active {
          color: var(--text);
          border-bottom: 2px solid var(--accent);
        }
        .tm-editor-close {
          margin-left: auto;
          padding: 6px 8px;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
        }
        .tm-editor-close:hover {
          color: var(--text);
        }
        .tm-editor-content {
          flex: 1;
          padding: 12px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.8;
          overflow: auto;
          white-space: pre;
        }
        .tm-editor-line-num {
          color: var(--text-muted);
          opacity: 0.4;
          user-select: none;
        }
        .tm-editor-line-highlight {
          background: rgba(248, 81, 73, 0.13);
          margin: 0 -12px;
          padding: 0 12px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalMode/TerminalModeEditor.tsx
git commit -m "feat(terminal-mode): add read-only editor side panel"
```

---

### Task 12: Integration — Wire Editor Panel into TerminalModeView

**Files:**
- Modify: `src/components/TerminalMode/TerminalModeView.tsx`

- [ ] **Step 1: Add editor state and integrate the panel**

At the top of `TerminalModeView`, add:

```typescript
import TerminalModeEditor from './TerminalModeEditor';
```

Add state for the editor panel inside the component:

```typescript
const [editorFiles, setEditorFiles] = useState<{ path: string; content: string; highlightLine?: number }[]>([]);
const [activeEditorFile, setActiveEditorFile] = useState<string | null>(null);
const [editorOpen, setEditorOpen] = useState(false);
```

Add a function to open a file in the editor (call this from AI response file references):

```typescript
const openFileInEditor = useCallback(async (filePath: string, line?: number) => {
  const absPath = filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
  const content = await window.sai.readFile(absPath);
  if (content === null) return;

  setEditorFiles(prev => {
    const existing = prev.find(f => f.path === absPath);
    if (existing) {
      return prev.map(f => f.path === absPath ? { ...f, highlightLine: line } : f);
    }
    return [...prev, { path: absPath, content, highlightLine: line }];
  });
  setActiveEditorFile(absPath);
  setEditorOpen(true);
}, [projectPath]);
```

Update the JSX return to include the editor panel — wrap the existing content in a flex row:

```tsx
return (
  <div className="tm-view">
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <TerminalModeBlockList ... />
      <TerminalModeInput ... />
    </div>
    {editorOpen && (
      <TerminalModeEditor
        files={editorFiles}
        activeFile={activeEditorFile}
        onSelectFile={setActiveEditorFile}
        onClose={() => setEditorOpen(false)}
      />
    )}
  </div>
);
```

Update the `.tm-view` style to be a flex row:

```css
.tm-view {
  flex: 1;
  display: flex;
  flex-direction: row;
  background: var(--bg);
  min-width: 0;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalMode/TerminalModeView.tsx
git commit -m "feat(terminal-mode): integrate editor side panel into view"
```

---

### Task 13: Final Integration Test & Cleanup

**Files:**
- All TerminalMode files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new).

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: Clean build.

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "feat(terminal-mode): final cleanup and integration"
```
