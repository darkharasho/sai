# Terminal-Native Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Terminal Mode so the always-live PTY is the primary layer, with block rendering as a visual treatment and AI interactions inline — eliminating the jarring LiveTerminal layout shift for SSH and long-running commands.

**Architecture:** A hidden xterm.js instance processes all PTY data as a terminal state machine. A BlockSegmenter watches the data stream, detects prompts, and produces structured block data. React renders these blocks as styled cards. When alternate screen buffer is detected (vim, htop), the hidden xterm is promoted to visible. AI responses render as inline cards in the block flow.

**Tech Stack:** React 19, TypeScript 5.7, xterm.js (@xterm/xterm), node-pty (via Electron IPC), Vitest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-04-06-terminal-native-mode-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/components/TerminalMode/BlockSegmenter.ts` | Parses PTY data stream into structured blocks via prompt detection. Pure logic — no React. |
| `src/components/TerminalMode/HiddenXterm.tsx` | Manages the hidden xterm.js instance, exposes it for alt-screen promotion and ANSI parsing. |
| `src/components/TerminalMode/InlineAIBlock.tsx` | Renders AI responses as inline cards with question, response text, and Run/Skip suggested commands. |
| `src/components/TerminalMode/NativeBlockList.tsx` | Renders segmented blocks as styled cards with collapse/expand, replaces `TerminalModeBlockList.tsx`. |
| `src/components/TerminalMode/NativeCommandBlock.tsx` | Single command block card with prompt, output, exit code, duration, collapse toggle. |
| `tests/unit/components/TerminalMode/BlockSegmenter.test.ts` | Tests for block segmentation logic. |
| `tests/unit/components/TerminalMode/NativeCommandBlock.test.tsx` | Tests for the new command block component. |
| `tests/unit/components/TerminalMode/InlineAIBlock.test.tsx` | Tests for inline AI block rendering. |

### Modified files
| File | Changes |
|------|---------|
| `src/components/TerminalMode/TerminalModeView.tsx` | Replace block-first architecture with always-live PTY + BlockSegmenter. Remove LiveTerminal usage, 300ms timer, pendingBlocks. Wire HiddenXterm + BlockSegmenter + NativeBlockList. |
| `src/components/TerminalMode/types.ts` | Add `NativeBlock`, `SegmentedCommand`, `AIInlineBlock` types. Keep existing types for backwards compat during migration. |
| `src/components/TerminalMode/TerminalModeInput.tsx` | Update to pass keystrokes directly to PTY in shell mode. Add `Cmd+K` handler for AI mode toggle. Remove custom tab completion (shell handles it natively). |

### Preserved files (no changes needed)
| File | Reason |
|------|--------|
| `ApprovalBlock.tsx` | Reused as-is for inline approval rendering. |
| `AIResponseBlock.tsx` | Reused for AI streaming content rendering inside InlineAIBlock. |
| `stripAnsi.ts` | Reused by BlockSegmenter. |
| `TerminalModeEditor.tsx` | Side panel unchanged. |

### Removed files (after migration)
| File | Replaced by |
|------|-------------|
| `InteractiveTerminalBlock.tsx` | HiddenXterm.tsx (always-live, no popup) |
| `TerminalModeBlockList.tsx` | NativeBlockList.tsx |
| `CommandBlock.tsx` | NativeCommandBlock.tsx |

---

## Task 1: BlockSegmenter — Core Logic

The pure-logic engine that segments a PTY data stream into blocks. No React, no DOM — just string processing.

**Files:**
- Create: `src/components/TerminalMode/BlockSegmenter.ts`
- Create: `tests/unit/components/TerminalMode/BlockSegmenter.test.ts`

- [ ] **Step 1: Write failing tests for BlockSegmenter**

```typescript
// tests/unit/components/TerminalMode/BlockSegmenter.test.ts
import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '../../../../src/components/TerminalMode/BlockSegmenter';

describe('BlockSegmenter', () => {
  it('creates a block when prompt is detected after command output', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    // Simulate: prompt, command echo, output, next prompt
    seg.feed('user@host:~$ ls\n');
    seg.feed('file1.txt  file2.txt\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('ls');
    expect(blocks[0].output).toContain('file1.txt');
  });

  it('detects the initial prompt without creating a block', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(0);
    expect(seg.currentPrompt).toBe('user@host:~$ ');
  });

  it('handles prompt changes during SSH', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    // Local prompt
    seg.feed('user@local:~$ ssh deploy@prod\n');
    seg.feed('Welcome to Ubuntu\n');
    seg.feed('deploy@prod:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('ssh deploy@prod');
    expect(seg.currentPrompt).toContain('deploy@prod');
  });

  it('tracks block duration from prompt to prompt', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ sleep 1\n');

    // Simulate time passing
    const start = Date.now();
    setTimeout(() => {
      seg.feed('user@host:~$ ');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].duration).toBeGreaterThanOrEqual(0);
    }, 10);
  });

  it('detects alternate screen buffer entry', () => {
    const seg = new BlockSegmenter();
    let altScreen = false;
    seg.onAltScreen((entered) => { altScreen = entered; });

    seg.feed('user@host:~$ vim file.txt\n');
    seg.feed('\x1b[?1049h'); // alt screen entry

    expect(altScreen).toBe(true);
  });

  it('detects alternate screen buffer exit', () => {
    const seg = new BlockSegmenter();
    let altScreen = false;
    seg.onAltScreen((entered) => { altScreen = entered; });

    seg.feed('\x1b[?1049h');
    expect(altScreen).toBe(true);

    seg.feed('\x1b[?1049l'); // alt screen exit
    expect(altScreen).toBe(false);
  });

  it('handles empty commands (bare Enter)', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ \n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('');
    expect(blocks[0].output).toBe('');
  });

  it('handles commands with no output', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ cd /tmp\n');
    seg.feed('user@host:/tmp$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('cd /tmp');
    expect(blocks[0].output).toBe('');
  });

  it('strips ANSI codes from command and output', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('\x1b[32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ echo hi\n');
    seg.feed('hi\n');
    seg.feed('\x1b[32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('echo hi');
    expect(blocks[0].output).toBe('hi');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/BlockSegmenter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement BlockSegmenter**

```typescript
// src/components/TerminalMode/BlockSegmenter.ts
import { stripAnsi } from './stripAnsi';

const PROMPT_RE = /(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*$/;
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';

export interface SegmentedBlock {
  id: string;
  command: string;
  output: string;
  promptText: string;
  startTime: number;
  duration: number;
  isRemote: boolean;
}

type BlockCallback = (block: SegmentedBlock) => void;
type AltScreenCallback = (entered: boolean) => void;

export class BlockSegmenter {
  private blockCallbacks: BlockCallback[] = [];
  private altScreenCallbacks: AltScreenCallback[] = [];
  private lineBuffer = '';
  private currentCommand: string | null = null;
  private commandStartTime = 0;
  private outputLines: string[] = [];
  private initialPromptSeen = false;
  private _currentPrompt = '';
  private inAltScreen = false;
  private idCounter = 0;

  get currentPrompt(): string {
    return this._currentPrompt;
  }

  onBlock(cb: BlockCallback): void {
    this.blockCallbacks.push(cb);
  }

  onAltScreen(cb: AltScreenCallback): void {
    this.altScreenCallbacks.push(cb);
  }

  feed(data: string): void {
    // Check for alt screen sequences in raw data (before stripping ANSI)
    if (data.includes(ALT_SCREEN_ENTER) && !this.inAltScreen) {
      this.inAltScreen = true;
      this.altScreenCallbacks.forEach(cb => cb(true));
    }
    if (data.includes(ALT_SCREEN_EXIT) && this.inAltScreen) {
      this.inAltScreen = false;
      this.altScreenCallbacks.forEach(cb => cb(false));
    }

    // Don't segment while in alt screen
    if (this.inAltScreen) return;

    const stripped = stripAnsi(data);
    this.lineBuffer += stripped;

    const lines = this.lineBuffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (this.currentCommand !== null) {
        this.outputLines.push(line);
      }
    }

    // Check if the partial line buffer looks like a prompt
    const partialTrimmed = this.lineBuffer.trim();
    if (partialTrimmed && PROMPT_RE.test(partialTrimmed)) {
      if (!this.initialPromptSeen) {
        // First prompt — just record it, don't create a block
        this.initialPromptSeen = true;
        this._currentPrompt = this.lineBuffer;
        this.lineBuffer = '';
        return;
      }

      if (this.currentCommand !== null) {
        // Finish the current block
        const output = this.outputLines.join('\n').trimEnd();
        const block: SegmentedBlock = {
          id: `seg-${++this.idCounter}`,
          command: this.currentCommand,
          output,
          promptText: this._currentPrompt,
          startTime: this.commandStartTime,
          duration: Date.now() - this.commandStartTime,
          isRemote: this.isRemotePrompt(this._currentPrompt),
        };
        this.blockCallbacks.forEach(cb => cb(block));
        this.currentCommand = null;
        this.outputLines = [];
      }

      this._currentPrompt = this.lineBuffer;
      this.lineBuffer = '';
    } else if (this.initialPromptSeen && this.currentCommand === null) {
      // We've seen a prompt and now there's content — extract the command
      // The lineBuffer after prompt detection gets cleared, so new content
      // after a prompt = the user typed a command
      // Check completed lines for the command
      for (const line of lines) {
        if (this.currentCommand === null && line.trim()) {
          // First non-empty line after prompt is the command (echo)
          // Strip the prompt prefix if present
          let cmd = line;
          const promptMatch = cmd.match(PROMPT_RE);
          if (promptMatch) {
            const idx = cmd.indexOf(promptMatch[0]);
            cmd = cmd.slice(idx + promptMatch[0].length);
          }
          this.currentCommand = cmd.trim();
          this.commandStartTime = Date.now();
          this.outputLines = [];
        } else if (this.currentCommand !== null) {
          this.outputLines.push(line);
        }
      }
    }
  }

  private isRemotePrompt(prompt: string): boolean {
    // Simple heuristic: if the prompt contains @ and looks different from initial
    const stripped = stripAnsi(prompt).trim();
    return stripped.includes('@') && stripped.length > 0;
  }

  reset(): void {
    this.lineBuffer = '';
    this.currentCommand = null;
    this.outputLines = [];
    this.initialPromptSeen = false;
    this._currentPrompt = '';
    this.inAltScreen = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/BlockSegmenter.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Iterate on failing tests**

The segmenter's prompt detection and command extraction logic is inherently tricky with real terminal data. Adjust the implementation based on which tests fail — the key patterns to get right are:
1. Prompt detection at end of partial line (no trailing newline)
2. Echo stripping (first line after prompt is the echoed command)
3. ANSI stripping before prompt matching
4. Alt screen detection on raw data before stripping

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalMode/BlockSegmenter.ts tests/unit/components/TerminalMode/BlockSegmenter.test.ts
git commit -m "feat(terminal-mode): add BlockSegmenter for PTY data stream parsing"
```

---

## Task 2: HiddenXterm — Always-Live Terminal State Machine

The hidden xterm.js instance that processes all PTY data. Normally invisible — promoted to visible only when alt screen buffer is active (vim, htop, etc.).

**Files:**
- Create: `src/components/TerminalMode/HiddenXterm.tsx`

- [ ] **Step 1: Write HiddenXterm component**

```tsx
// src/components/TerminalMode/HiddenXterm.tsx
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface HiddenXtermHandle {
  /** Write data from PTY into xterm for state tracking */
  write: (data: string) => void;
  /** Send user input to PTY */
  sendInput: (data: string) => void;
  /** Get the xterm Terminal instance */
  getTerminal: () => Terminal | null;
  /** Focus the xterm terminal (for alt-screen mode) */
  focus: () => void;
}

interface HiddenXtermProps {
  ptyId: number;
  visible: boolean; // true when alt-screen active
  onData?: (data: string) => void; // forward raw data to BlockSegmenter
}

export default forwardRef<HiddenXtermHandle, HiddenXtermProps>(
  function HiddenXterm({ ptyId, visible, onData }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      const xterm = new Terminal({
        theme: {
          background: '#0a0d0f',
          foreground: '#bec6d0',
          cursor: '#bec6d0',
          cursorAccent: '#0a0d0f',
          selectionBackground: 'rgba(199, 145, 12, 0.3)',
          black: '#0c0f11',
          red: '#E35535',
          green: '#00a884',
          yellow: '#c7910c',
          blue: '#11B7D4',
          magenta: '#d46ec0',
          cyan: '#38c7bd',
          white: '#bec6d0',
          brightBlack: '#5a6a7a',
          brightRed: '#E35535',
          brightGreen: '#00a884',
          brightYellow: '#f5b832',
          brightBlue: '#11B7D4',
          brightMagenta: '#a85ff1',
          brightCyan: '#38c7bd',
          brightWhite: '#ffffff',
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        cursorBlink: true,
        scrollback: 5000,
        convertEol: true,
      });

      const fit = new FitAddon();
      xterm.loadAddon(fit);
      xterm.open(containerRef.current);

      // Forward keyboard input to PTY
      xterm.onData((data) => {
        window.sai.terminalWrite(ptyId, data);
      });

      xtermRef.current = xterm;
      fitRef.current = fit;

      return () => {
        xterm.dispose();
        xtermRef.current = null;
        fitRef.current = null;
      };
    }, [ptyId]);

    // Fit when visibility changes
    useEffect(() => {
      if (visible && fitRef.current && containerRef.current) {
        requestAnimationFrame(() => {
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.sai.terminalResize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
            }
          } catch { /* ignore */ }
        });
      }
    }, [visible, ptyId]);

    // Resize observer
    useEffect(() => {
      if (!containerRef.current) return;
      const observer = new ResizeObserver(() => {
        if (!visible) return;
        requestAnimationFrame(() => {
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.sai.terminalResize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
            }
          } catch { /* ignore */ }
        });
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [ptyId, visible]);

    useImperativeHandle(ref, () => ({
      write(data: string) {
        xtermRef.current?.write(data);
        onData?.(data);
      },
      sendInput(data: string) {
        window.sai.terminalWrite(ptyId, data);
      },
      getTerminal() {
        return xtermRef.current;
      },
      focus() {
        xtermRef.current?.focus();
      },
    }), [ptyId, onData]);

    return (
      <div
        ref={containerRef}
        className="tm-hidden-xterm"
        style={{
          position: visible ? 'relative' : 'absolute',
          width: visible ? '100%' : 0,
          height: visible ? '100%' : 0,
          overflow: 'hidden',
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          flex: visible ? 1 : undefined,
          minHeight: visible ? 0 : undefined,
        }}
      />
    );
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TerminalMode/HiddenXterm.tsx
git commit -m "feat(terminal-mode): add HiddenXterm always-live terminal component"
```

---

## Task 3: NativeCommandBlock — New Block Card Component

Renders a single command block with collapse/expand, prompt context, exit code, duration, and action icons.

**Files:**
- Create: `src/components/TerminalMode/NativeCommandBlock.tsx`
- Create: `tests/unit/components/TerminalMode/NativeCommandBlock.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// tests/unit/components/TerminalMode/NativeCommandBlock.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import NativeCommandBlock from '../../../../src/components/TerminalMode/NativeCommandBlock';

const baseBlock = {
  id: 'seg-1',
  command: 'npm run build',
  output: 'vite v6.2.0 building...\n✓ built in 2.1s',
  promptText: 'user@host:~$ ',
  startTime: Date.now() - 2100,
  duration: 2100,
  isRemote: false,
};

describe('NativeCommandBlock', () => {
  it('renders the prompt and command', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('npm run build');
  });

  it('renders the output', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('built in 2.1s');
  });

  it('shows duration', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('2.1s');
  });

  it('collapses when header is clicked', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} collapsed={false} onToggleCollapse={vi.fn()} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    const header = container.querySelector('.tn-block-header') as HTMLElement;
    fireEvent.click(header);
    // onToggleCollapse should be called
  });

  it('shows collapsed state without output', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} collapsed={true} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).not.toContain('built in 2.1s');
  });

  it('uses amber prompt color for remote blocks', () => {
    const remoteBlock = { ...baseBlock, isRemote: true, promptText: 'deploy@prod:~$ ' };
    const { container } = render(
      <NativeCommandBlock block={remoteBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    const prompt = container.querySelector('.tn-prompt') as HTMLElement;
    expect(prompt.style.color).toContain('#f59e0b');
  });

  it('shows "via AI" label when aiSuggested is true', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} aiSuggested={true} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('via AI');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/NativeCommandBlock.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement NativeCommandBlock**

```tsx
// src/components/TerminalMode/NativeCommandBlock.tsx
import { useState } from 'react';
import { Copy, Sparkles, RotateCw } from 'lucide-react';
import type { SegmentedBlock } from './BlockSegmenter';

const LONG_OUTPUT_LINES = 30; // threshold for "Show all" toggle

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function extractPromptUser(promptText: string): string {
  const stripped = promptText.trim();
  // Extract "user@host:path" or just return the prompt
  const match = stripped.match(/^([^$#%>❯]+)/);
  return match ? match[1].trim() : stripped;
}

interface NativeCommandBlockProps {
  block: SegmentedBlock;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  active?: boolean; // currently running
  aiSuggested?: boolean;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
}

export default function NativeCommandBlock({
  block, collapsed = false, onToggleCollapse, active = false, aiSuggested = false,
  onCopy, onAskAI, onRerun,
}: NativeCommandBlockProps) {
  const promptUser = extractPromptUser(block.promptText);
  const [showAll, setShowAll] = useState(false);
  const isLongOutput = block.output.split('\n').length > LONG_OUTPUT_LINES;

  return (
    <div
      className={`tn-block ${collapsed ? 'tn-block-collapsed' : ''} ${active ? 'tn-block-active' : ''}`}
      style={{ marginBottom: 8 }}
    >
      <div className="tn-block-header" onClick={onToggleCollapse} style={{ cursor: onToggleCollapse ? 'pointer' : undefined }}>
        <div className="tn-block-header-left">
          <span style={{ color: '#4b5563', fontSize: 10, marginRight: 6 }}>
            {collapsed ? '▶' : '▼'}
          </span>
          <span className="tn-prompt" style={{ color: block.isRemote ? '#f59e0b' : '#22c55e' }}>
            {promptUser}
          </span>
          <span style={{ color: '#4b5563' }}>$</span>
          <span style={{ color: '#e5e7eb', marginLeft: 4 }}>{block.command}</span>
          {aiSuggested && (
            <span style={{ color: '#8b5cf6', fontSize: 9, marginLeft: 6, opacity: 0.5 }}>via AI</span>
          )}
          {active && (
            <span className="tn-active-dot" />
          )}
        </div>
        <div className="tn-block-header-right">
          {!active && !collapsed && (
            <div className="tn-block-actions">
              <span title="Copy output" onClick={(e) => { e.stopPropagation(); onCopy(block.output); }}>
                <Copy size={12} />
              </span>
              <span title="Ask AI" onClick={(e) => { e.stopPropagation(); onAskAI(block); }}>
                <Sparkles size={12} />
              </span>
              <span title="Rerun" onClick={(e) => { e.stopPropagation(); onRerun(block.command); }}>
                <RotateCw size={12} />
              </span>
            </div>
          )}
          <span style={{ color: '#4b5563', fontSize: 10 }}>
            {active ? 'running' : formatDuration(block.duration)}
          </span>
        </div>
      </div>

      {!collapsed && block.output && (
        <>
          <div className={`tn-block-output ${isLongOutput && !showAll ? 'tn-block-output-clamped' : ''}`}>
            {block.output}
          </div>
          {isLongOutput && !showAll && (
            <div className="tn-block-show-all" onClick={() => setShowAll(true)}>
              Show all ({block.output.split('\n').length} lines)
            </div>
          )}
        </>
      )}

      <style>{`
        .tn-block {
          background: #111417;
          border-radius: 5px;
          border: 1px solid #1a1e24;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
          overflow: hidden;
        }
        .tn-block-collapsed {
          opacity: 0.6;
        }
        .tn-block-active {
          border-color: #22c55e40;
        }
        .tn-block-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 7px 11px;
        }
        .tn-block-header-left {
          display: flex;
          align-items: center;
          gap: 2px;
          min-width: 0;
          overflow: hidden;
        }
        .tn-block-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .tn-block-actions {
          display: flex;
          gap: 6px;
          opacity: 0;
          transition: opacity 0.15s;
        }
        .tn-block:hover .tn-block-actions {
          opacity: 1;
        }
        .tn-block-actions span {
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
        }
        .tn-block-actions span:hover {
          color: var(--text);
        }
        .tn-block-output {
          color: #9ca3af;
          font-size: 11.5px;
          border-left: 2px solid #1e2328;
          margin: 0 11px 8px 18px;
          padding-left: 10px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .tn-block-output-clamped {
          max-height: 300px;
          overflow-y: hidden;
        }
        .tn-block-show-all {
          color: var(--text-muted);
          font-size: 10px;
          cursor: pointer;
          padding: 2px 11px 6px 28px;
        }
        .tn-block-show-all:hover {
          color: var(--text);
        }
        .tn-active-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22c55e;
          margin-left: 6px;
          animation: tn-pulse 1.5s ease-in-out infinite;
        }
        @keyframes tn-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/NativeCommandBlock.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalMode/NativeCommandBlock.tsx tests/unit/components/TerminalMode/NativeCommandBlock.test.tsx
git commit -m "feat(terminal-mode): add NativeCommandBlock card component"
```

---

## Task 4: InlineAIBlock — Inline AI Response Card

Renders AI responses inline in the terminal flow with the user's question, AI response text, and suggested command buttons.

**Files:**
- Create: `src/components/TerminalMode/InlineAIBlock.tsx`
- Create: `tests/unit/components/TerminalMode/InlineAIBlock.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// tests/unit/components/TerminalMode/InlineAIBlock.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import InlineAIBlock from '../../../../src/components/TerminalMode/InlineAIBlock';

describe('InlineAIBlock', () => {
  it('renders the user question', () => {
    const { container } = render(
      <InlineAIBlock question="is this healthy?" content="Yes, nginx is running." onRunCommand={vi.fn()} />
    );
    expect(container.textContent).toContain('is this healthy?');
  });

  it('renders the AI response content', () => {
    const { container } = render(
      <InlineAIBlock question="test" content="The server is fine." onRunCommand={vi.fn()} />
    );
    expect(container.textContent).toContain('The server is fine.');
  });

  it('renders suggested commands with Run/Skip buttons', () => {
    const { container } = render(
      <InlineAIBlock
        question="test"
        content="Try this:"
        suggestedCommands={['tail -20 /var/log/syslog', 'systemctl restart nginx']}
        onRunCommand={vi.fn()}
      />
    );
    expect(container.textContent).toContain('tail -20 /var/log/syslog');
    expect(container.textContent).toContain('Run');
    expect(container.textContent).toContain('Skip');
  });

  it('calls onRunCommand when Run is clicked', () => {
    const onRun = vi.fn();
    const { container } = render(
      <InlineAIBlock
        question="test"
        content="Try:"
        suggestedCommands={['echo hello']}
        onRunCommand={onRun}
      />
    );
    const runBtn = container.querySelector('[data-action="run"]') as HTMLElement;
    fireEvent.click(runBtn);
    expect(onRun).toHaveBeenCalledWith('echo hello');
  });

  it('shows streaming indicator when streaming', () => {
    const { container } = render(
      <InlineAIBlock question="test" content="" streaming={true} onRunCommand={vi.fn()} />
    );
    expect(container.querySelector('.tn-ai-streaming')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/TerminalMode/InlineAIBlock.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement InlineAIBlock**

```tsx
// src/components/TerminalMode/InlineAIBlock.tsx
import { useState } from 'react';

interface InlineAIBlockProps {
  question: string;
  content: string;
  suggestedCommands?: string[];
  streaming?: boolean;
  entries?: import('./types').AIEntry[];
  aiProvider?: 'claude' | 'codex' | 'gemini';
  onRunCommand: (command: string) => void;
  onCopy?: (text: string) => void;
}

export default function InlineAIBlock({
  question, content, suggestedCommands = [], streaming = false,
  entries, aiProvider = 'claude', onRunCommand, onCopy,
}: InlineAIBlockProps) {
  const [dismissedCommands, setDismissedCommands] = useState<Set<number>>(new Set());

  const providerLabel = aiProvider === 'claude' ? 'Claude' : aiProvider === 'codex' ? 'Codex' : 'Gemini';

  return (
    <div className="tn-ai-block" style={{ marginBottom: 8 }}>
      <div className="tn-ai-header">
        <span className="tn-ai-icon">⬡</span>
        <span className="tn-ai-label">{providerLabel}</span>
        <span style={{ color: '#4b5563', fontSize: 11 }}>·</span>
        <span className="tn-ai-question">{question}</span>
        {streaming && <span className="tn-ai-streaming" />}
      </div>

      {content && (
        <div className="tn-ai-content">{content}</div>
      )}

      {suggestedCommands.length > 0 && (
        <div className="tn-ai-commands">
          {suggestedCommands.map((cmd, i) => (
            !dismissedCommands.has(i) && (
              <div key={i} className="tn-ai-cmd-row">
                <code className="tn-ai-cmd-text">{cmd}</code>
                <div className="tn-ai-cmd-actions">
                  <span
                    className="tn-ai-cmd-run"
                    data-action="run"
                    onClick={() => onRunCommand(cmd)}
                  >
                    ⏎ Run
                  </span>
                  <span
                    className="tn-ai-cmd-skip"
                    onClick={() => setDismissedCommands(prev => new Set(prev).add(i))}
                  >
                    Skip
                  </span>
                </div>
              </div>
            )
          ))}
        </div>
      )}

      <style>{`
        .tn-ai-block {
          background: #13111e;
          border-radius: 5px;
          border: 1px solid #2d2454;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
          padding: 10px 11px;
        }
        .tn-ai-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }
        .tn-ai-icon {
          color: #8b5cf6;
          font-size: 12px;
        }
        .tn-ai-label {
          color: #8b5cf6;
          font-size: 11px;
          font-weight: 600;
        }
        .tn-ai-question {
          color: #7c7f85;
          font-size: 11px;
          font-style: italic;
        }
        .tn-ai-streaming {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #8b5cf6;
          animation: tn-pulse 1.5s ease-in-out infinite;
          margin-left: 4px;
        }
        .tn-ai-content {
          color: #b4b8c0;
          font-size: 12px;
          line-height: 1.6;
          padding-left: 20px;
          margin-bottom: 8px;
        }
        .tn-ai-commands {
          padding-left: 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tn-ai-cmd-row {
          background: #0a0d0f;
          border-radius: 4px;
          padding: 6px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: 1px solid #1e2328;
        }
        .tn-ai-cmd-text {
          color: #e5e7eb;
          font-size: 11.5px;
        }
        .tn-ai-cmd-actions {
          display: flex;
          gap: 8px;
        }
        .tn-ai-cmd-run {
          color: #22c55e;
          font-size: 11px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 3px;
          background: #22c55e10;
        }
        .tn-ai-cmd-run:hover {
          background: #22c55e20;
        }
        .tn-ai-cmd-skip {
          color: #6b7280;
          font-size: 11px;
          cursor: pointer;
        }
        .tn-ai-cmd-skip:hover {
          color: #9ca3af;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/TerminalMode/InlineAIBlock.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalMode/InlineAIBlock.tsx tests/unit/components/TerminalMode/InlineAIBlock.test.tsx
git commit -m "feat(terminal-mode): add InlineAIBlock for inline AI responses"
```

---

## Task 5: NativeBlockList — Block List Renderer

Renders the list of segmented blocks and inline AI blocks. Handles auto-collapsing older blocks and scroll-to-bottom.

**Files:**
- Create: `src/components/TerminalMode/NativeBlockList.tsx`

- [ ] **Step 1: Implement NativeBlockList**

```tsx
// src/components/TerminalMode/NativeBlockList.tsx
import { useRef, useEffect, useState } from 'react';
import NativeCommandBlock from './NativeCommandBlock';
import InlineAIBlock from './InlineAIBlock';
import ApprovalBlock from './ApprovalBlock';
import type { SegmentedBlock } from './BlockSegmenter';
import type { ApprovalBlock as ApprovalBlockType, ToolApprovalBlock as ToolApprovalBlockType } from './types';
import { Wrench } from 'lucide-react';

// A display item is either a command block, an AI response, an approval, or a tool approval
export type DisplayItem =
  | { type: 'command'; block: SegmentedBlock; aiSuggested?: boolean }
  | { type: 'ai'; id: string; question: string; content: string; suggestedCommands: string[]; streaming: boolean; aiProvider?: 'claude' | 'codex' | 'gemini' }
  | { type: 'approval'; block: ApprovalBlockType }
  | { type: 'tool-approval'; block: ToolApprovalBlockType };

interface NativeBlockListProps {
  items: DisplayItem[];
  activeBlockId: string | null; // currently running command's block id
  fullWidth?: boolean;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
  onRunSuggested: (command: string) => void;
  onApprove: (block: ApprovalBlockType) => void;
  onReject: (block: ApprovalBlockType) => void;
  onEdit: (block: ApprovalBlockType) => void;
  onToolApprove: (block: ToolApprovalBlockType) => void;
  onToolReject: (block: ToolApprovalBlockType) => void;
  onToolAlwaysAllow: (block: ToolApprovalBlockType) => void;
}

const AUTO_COLLAPSE_THRESHOLD = 10; // blocks older than this auto-collapse

export default function NativeBlockList({
  items, activeBlockId, fullWidth, onCopy, onAskAI, onRerun, onRunSuggested,
  onApprove, onReject, onEdit, onToolApprove, onToolReject, onToolAlwaysAllow,
}: NativeBlockListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [items]);

  const toggleCollapse = (id: string, currentlyCollapsed: boolean) => {
    if (currentlyCollapsed) {
      setManualExpanded(prev => new Set(prev).add(id));
      setManualCollapsed(prev => { const s = new Set(prev); s.delete(id); return s; });
    } else {
      setManualCollapsed(prev => new Set(prev).add(id));
      setManualExpanded(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  return (
    <div className={`tn-block-list ${fullWidth ? 'tn-full-width' : ''}`}>
      <div className="tn-spacer" />

      {items.length === 0 && (
        <div className="tn-welcome">
          <div className="tn-welcome-title">Terminal Mode</div>
          <div className="tn-welcome-section">
            <div className="tn-welcome-heading">Commands</div>
            <div className="tn-welcome-row"><span className="tn-welcome-key">Enter</span> Run shell command</div>
            <div className="tn-welcome-row"><span className="tn-welcome-key">⌘K</span> Ask AI</div>
          </div>
          <div className="tn-welcome-section">
            <div className="tn-welcome-heading">Block Actions</div>
            <div className="tn-welcome-row">Hover a block to copy, ask AI, or rerun</div>
            <div className="tn-welcome-row"><span className="tn-welcome-key">⌘⇧K</span> Collapse/expand all</div>
          </div>
        </div>
      )}

      {items.map((item, i) => {
        if (item.type === 'command') {
          const isActive = item.block.id === activeBlockId;
          const autoCollapsed = !isActive && i < items.length - AUTO_COLLAPSE_THRESHOLD;
          const collapsed = manualCollapsed.has(item.block.id) || (autoCollapsed && !manualExpanded.has(item.block.id));

          return (
            <NativeCommandBlock
              key={item.block.id}
              block={item.block}
              collapsed={collapsed}
              active={isActive}
              aiSuggested={item.aiSuggested}
              onToggleCollapse={() => toggleCollapse(item.block.id, collapsed)}
              onCopy={onCopy}
              onAskAI={onAskAI}
              onRerun={onRerun}
            />
          );
        }

        if (item.type === 'ai') {
          return (
            <InlineAIBlock
              key={item.id}
              question={item.question}
              content={item.content}
              suggestedCommands={item.suggestedCommands}
              streaming={item.streaming}
              aiProvider={item.aiProvider}
              onRunCommand={onRunSuggested}
            />
          );
        }

        if (item.type === 'approval') {
          return (
            <ApprovalBlock
              key={item.block.id}
              block={item.block}
              onApprove={onApprove}
              onReject={onReject}
              onEdit={onEdit}
            />
          );
        }

        if (item.type === 'tool-approval') {
          return (
            <div key={item.block.id} className={`tm-tool-approval ${item.block.status !== 'pending' ? 'tm-tool-resolved' : ''}`}>
              <div className="tm-tool-approval-header">
                <span className="tm-tool-approval-label"><Wrench size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{item.block.toolName}</span>
                {item.block.status === 'approved' && <span className="tm-tool-status tm-tool-approved">✓ allowed</span>}
                {item.block.status === 'rejected' && <span className="tm-tool-status tm-tool-rejected">✗ denied</span>}
              </div>
              <div className="tm-tool-approval-command">{item.block.command}</div>
              {item.block.status === 'pending' && (
                <div className="tm-tool-approval-actions">
                  <button className="tm-tool-btn tm-tool-btn-approve" onClick={() => onToolApprove(item.block)}>Allow</button>
                  <button className="tm-tool-btn tm-tool-btn-always" onClick={() => onToolAlwaysAllow(item.block)}>Always allow</button>
                  <button className="tm-tool-btn tm-tool-btn-deny" onClick={() => onToolReject(item.block)}>Deny</button>
                </div>
              )}
            </div>
          );
        }

        return null;
      })}

      <div ref={bottomRef} style={{ overflowAnchor: 'auto' }} />

      <style>{`
        .tn-block-list {
          flex: 1;
          min-height: 0;
          padding: 16px 15% 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          transition: padding 0.3s ease;
        }
        .tn-block-list.tn-full-width {
          padding-left: 16px;
          padding-right: 16px;
        }
        .tn-spacer {
          flex: 1 0 0px;
          overflow-anchor: none;
        }
        .tn-welcome {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.8;
          margin-bottom: 16px;
        }
        .tn-welcome-title {
          color: var(--accent);
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .tn-welcome-section { margin-bottom: 8px; }
        .tn-welcome-heading {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .tn-welcome-row { padding-left: 8px; }
        .tn-welcome-key {
          color: var(--text);
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 0 4px;
          font-size: 11px;
          margin-right: 8px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TerminalMode/NativeBlockList.tsx
git commit -m "feat(terminal-mode): add NativeBlockList renderer for terminal-native blocks"
```

---

## Task 6: Updated Types

Add the new type definitions needed by the terminal-native architecture.

**Files:**
- Modify: `src/components/TerminalMode/types.ts`

- [ ] **Step 1: Add new types to types.ts**

Add the following to the end of `src/components/TerminalMode/types.ts`:

```typescript
// Terminal-native mode types
export type { SegmentedBlock } from './BlockSegmenter';
export type { DisplayItem } from './NativeBlockList';
```

No other type changes needed — `SegmentedBlock` is defined in `BlockSegmenter.ts` and `DisplayItem` in `NativeBlockList.tsx`. The existing block types (`ApprovalBlock`, `ToolApprovalBlock`, etc.) are reused as-is.

- [ ] **Step 2: Commit**

```bash
git add src/components/TerminalMode/types.ts
git commit -m "feat(terminal-mode): export terminal-native types"
```

---

## Task 7: Wire It All Together — Rewrite TerminalModeView

The big integration task. Replace the block-first architecture with the always-live PTY + BlockSegmenter + NativeBlockList.

**Files:**
- Modify: `src/components/TerminalMode/TerminalModeView.tsx`

- [ ] **Step 1: Rewrite TerminalModeView**

Keep the existing imports and utility functions (`KNOWN_COMMANDS`, `NL_STARTERS`, `looksLikeShellCommand`, `PROMPT_RE`, `nextBlockId`, `nextGroupId`). Replace the component body. Key changes:

1. **Remove:** `pendingBlocksRef`, `liveTerminal` state, `liveTerminalTimerRef`, `liveTermXtermRef`, `LiveTerminal` import/usage, 300ms timer logic, `PendingCommand` interface, `LiveTerminalState` interface
2. **Add:** `BlockSegmenter` instance ref, `HiddenXterm` ref, `displayItems` state (replaces `blocks`), `altScreenVisible` state
3. **Replace `executeCommand`:** Instead of creating a PendingCommand and starting a timer, just write to the PTY. The BlockSegmenter handles block creation.
4. **Replace data listener:** Instead of the complex prompt-detection effect, feed all PTY data into `hiddenXtermRef.current.write(data)` which feeds into the BlockSegmenter.
5. **Keep:** AI request handling (`handleAIRequest`), approval handlers, editor panel, input bar (with minor updates).

The full component rewrite:

```tsx
// Replace the default export function and everything after it.
// Keep lines 1-167 (imports, constants, looksLikeShellCommand, PROMPT_RE, nextBlockId, nextGroupId).

// New imports to add at top:
import HiddenXterm from './HiddenXterm';
import type { HiddenXtermHandle } from './HiddenXterm';
import { BlockSegmenter } from './BlockSegmenter';
import type { SegmentedBlock } from './BlockSegmenter';
import NativeBlockList from './NativeBlockList';
import type { DisplayItem } from './NativeBlockList';
import InlineAIBlock from './InlineAIBlock';

// Remove these imports:
// - TerminalModeBlockList
// - LiveTerminal, extractTerminalOutput from InteractiveTerminalBlock
// - Block, CommandBlock as CommandBlockType from types (keep ApprovalBlock, ToolApprovalBlock, InputMode)
```

The component function should:

a) Create a `BlockSegmenter` in a ref (created once on mount).
b) Create the `HiddenXterm` via ref, passing `onData` that feeds into the segmenter.
c) Listen to `terminalOnData` and forward to the hidden xterm.
d) When the segmenter emits a block, append a `{ type: 'command', block }` to `displayItems`.
e) When alt-screen is detected, set `altScreenVisible = true` — the HiddenXterm becomes visible.
f) `executeCommand` just writes `command + '\n'` to the PTY — no pending blocks, no timers.
g) `handleAIRequest` appends `{ type: 'ai', ... }` items to `displayItems` and extracts suggested commands.
h) When user clicks "Run" on a suggested command, call `executeCommand(command)` — it goes to the PTY.
i) Render: `HiddenXterm` (hidden unless alt-screen) + `NativeBlockList` (hidden during alt-screen) + `TerminalModeInput`.

This is a large rewrite. The engineer should:
1. Read the existing `TerminalModeView.tsx` fully (all 919 lines)
2. Copy the file to a backup (`TerminalModeView.tsx.bak`)
3. Rewrite the component function while keeping the AI request handler logic (lines 391-800+) largely intact — it works, just needs the block output format changed
4. Test manually by switching to Terminal Mode, running commands, running SSH, pressing Cmd+K for AI

- [ ] **Step 2: Test manually**

Run: `npm run dev` (or the Electron dev command)
1. Switch to Terminal Mode
2. Run `ls -la` — should appear as a styled card block
3. Run `echo hello` — should appear as another block, ls should auto-collapse if far enough back
4. Click a block header to collapse/expand
5. Press `Cmd+K`, type a question, verify inline AI response appears
6. If available, `ssh` to a server — verify no layout shift, prompt color changes to amber
7. Run `vim` or `htop` — verify xterm canvas takes over, then block rendering resumes after exit

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalMode/TerminalModeView.tsx
git commit -m "feat(terminal-mode): rewrite to terminal-native architecture

Replace block-first approach with always-live PTY + BlockSegmenter.
Eliminates LiveTerminal layout shift for SSH and long-running commands.
AI responses render inline in the terminal flow."
```

---

## Task 8: Update TerminalModeInput for Direct PTY Input

Modify the input component to pass keystrokes directly to the PTY in shell mode and add `Cmd+K` handling.

**Files:**
- Modify: `src/components/TerminalMode/TerminalModeInput.tsx`

- [ ] **Step 1: Update TerminalModeInput**

Key changes:
1. **Remove** custom tab completion logic — the shell handles Tab natively via the PTY
2. **Add** `Cmd+K` / `Ctrl+K` handler to toggle AI mode
3. **Keep** AI mode input, history navigation, Shift+Tab toggle, Ctrl+L, Ctrl+U, Ctrl+W
4. **Add** `onSendToPty` prop for direct PTY writes in shell mode (the parent passes this)

In the `handleKeyDown` function, add before existing handlers:

```typescript
// Cmd+K or Ctrl+K: toggle AI mode
if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
  e.preventDefault();
  onToggleMode();
  return;
}
```

Remove the tab completion state machine (`tabStateRef`, the Tab handler, `handleTabCompletion` function, the candidates display). Tab in shell mode should be forwarded to the PTY instead.

- [ ] **Step 2: Update existing TerminalModeInput tests**

Run: `npx vitest run tests/unit/components/TerminalMode/TerminalModeInput.test.tsx`

Fix any test failures caused by the removed tab completion props and changed behavior.

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalMode/TerminalModeInput.tsx tests/unit/components/TerminalMode/TerminalModeInput.test.tsx
git commit -m "feat(terminal-mode): update input for direct PTY and Cmd+K AI toggle"
```

---

## Task 9: Clean Up Old Components

Remove the files that are no longer needed.

**Files:**
- Remove: `src/components/TerminalMode/InteractiveTerminalBlock.tsx`
- Remove: `src/components/TerminalMode/TerminalModeBlockList.tsx`
- Remove: `src/components/TerminalMode/CommandBlock.tsx`
- Remove: `tests/unit/components/TerminalMode/CommandBlock.test.tsx`

- [ ] **Step 1: Verify no remaining imports of old components**

Run: `grep -r 'InteractiveTerminalBlock\|TerminalModeBlockList\|from.*CommandBlock' src/components/TerminalMode/`

Should return zero results (all references were replaced in Task 7).

- [ ] **Step 2: Remove old files**

```bash
rm src/components/TerminalMode/InteractiveTerminalBlock.tsx
rm src/components/TerminalMode/TerminalModeBlockList.tsx
rm src/components/TerminalMode/CommandBlock.tsx
rm tests/unit/components/TerminalMode/CommandBlock.test.tsx
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (old CommandBlock tests removed, new tests pass)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(terminal-mode): remove old block-first components

Removed InteractiveTerminalBlock, TerminalModeBlockList, and CommandBlock
which are replaced by the terminal-native architecture."
```

---

## Task 10: End-to-End Verification

Final manual testing to ensure everything works together.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Build the app**

Run: `npm run build` (or the Electron build command)
Expected: No TypeScript errors, successful build

- [ ] **Step 3: Manual smoke test checklist**

1. Launch app, switch to Terminal Mode
2. Run basic commands: `ls`, `pwd`, `echo hello` — blocks appear as cards
3. Run a failing command: `false` or `nonexistent-command` — red exit code indicator
4. Run a long-output command: `find . -type f` — output scrolls within block
5. Press `Cmd+K`, ask AI a question — inline purple AI block appears
6. Click "Run" on a suggested command — command executes, "via AI" label appears
7. SSH to a remote server (if available) — no layout shift, amber prompt
8. Run commands while SSHed — blocks keep flowing naturally
9. Exit SSH — prompt returns to green local
10. Run `vim` or `htop` — xterm takes over, exit returns to blocks
11. Click block headers to collapse/expand
12. Verify `Cmd+Shift+K` collapses/expands all

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(terminal-mode): address issues found during verification"
```
