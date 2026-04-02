# Markdown Preview Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle that renders `.md` files as formatted markdown in the editor pane.

**Architecture:** Add `mdPreview` boolean to `OpenFile`. A new `MarkdownPreview` component renders markdown using the existing `react-markdown` + `remark-gfm` + `rehype-highlight` stack. `CodePanel` conditionally renders either Monaco or the preview. Toggle via status bar button (`.md` files only) or `Ctrl+Shift+M`.

**Tech Stack:** React, react-markdown, remark-gfm, rehype-highlight, highlight.js, lucide-react

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `mdPreview?: boolean` to `OpenFile` |
| `src/components/CodePanel/MarkdownPreview.tsx` | Create | Rendered markdown view with status bar |
| `src/components/FileExplorer/MonacoEditor.tsx` | Modify | Add "Preview" toggle button to status bar for `.md` files |
| `src/components/CodePanel/CodePanel.tsx` | Modify | Conditionally render `MarkdownPreview` when `mdPreview` is true |
| `src/App.tsx` | Modify | Add `handleToggleMdPreview`, `Ctrl+Shift+M` shortcut, pass props |
| `tests/unit/components/CodePanel/MarkdownPreview.test.tsx` | Create | Tests for the preview component |
| `tests/unit/components/CodePanel/CodePanel.test.tsx` | Modify | Add tests for preview rendering branch |

---

### Task 1: Add `mdPreview` to OpenFile type

**Files:**
- Modify: `src/types.ts:42-54`

- [ ] **Step 1: Add the field**

In `src/types.ts`, add `mdPreview?: boolean` to the `OpenFile` interface, after the `pendingLine` field:

```typescript
export interface OpenFile {
  path: string;
  viewMode: 'diff' | 'editor';
  // diff mode fields
  file?: GitFile;
  diffMode?: 'unified' | 'split';
  // editor mode fields
  content?: string;
  savedContent?: string;
  isDirty?: boolean;
  diskMtime?: number;
  pendingLine?: number;
  mdPreview?: boolean;
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No new errors (the field is optional so existing code is unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add mdPreview field to OpenFile"
```

---

### Task 2: Create MarkdownPreview component

**Files:**
- Create: `src/components/CodePanel/MarkdownPreview.tsx`
- Create: `tests/unit/components/CodePanel/MarkdownPreview.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/CodePanel/MarkdownPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock highlight.js CSS import
vi.mock('highlight.js/styles/monokai.css', () => ({}));

import MarkdownPreview from '../../../../src/components/CodePanel/MarkdownPreview';

describe('MarkdownPreview', () => {
  const defaultProps = {
    content: '# Hello World\n\nSome **bold** text.',
    onTogglePreview: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders markdown content as HTML', () => {
    render(<MarkdownPreview {...defaultProps} />);
    expect(screen.getByText('Hello World')).toBeTruthy();
    expect(screen.getByText(/bold/)).toBeTruthy();
  });

  it('renders a status bar with preview label', () => {
    const { container } = render(<MarkdownPreview {...defaultProps} />);
    expect(container.textContent).toContain('markdown');
    expect(container.textContent).toContain('preview');
  });

  it('renders an Editor toggle button in the status bar', () => {
    render(<MarkdownPreview {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /editor/i });
    expect(btn).toBeTruthy();
  });

  it('calls onTogglePreview when Editor button is clicked', () => {
    const onToggle = vi.fn();
    render(<MarkdownPreview {...defaultProps} onTogglePreview={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /editor/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders code blocks with syntax highlighting', () => {
    const content = '```js\nconsole.log("hi")\n```';
    const { container } = render(
      <MarkdownPreview {...defaultProps} content={content} />
    );
    // rehype-highlight adds hljs classes to code blocks
    const codeEl = container.querySelector('pre code');
    expect(codeEl).toBeTruthy();
  });

  it('renders GFM tables', () => {
    const content = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(
      <MarkdownPreview {...defaultProps} content={content} />
    );
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/CodePanel/MarkdownPreview.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the MarkdownPreview component**

Create `src/components/CodePanel/MarkdownPreview.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/monokai.css';
import { Eye } from 'lucide-react';

interface MarkdownPreviewProps {
  content: string;
  onTogglePreview: () => void;
}

export default function MarkdownPreview({ content, onTogglePreview }: MarkdownPreviewProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="md-preview-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </div>

      {/* Status Bar */}
      <div className="monaco-statusbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>markdown</span>
          <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>preview</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>UTF-8</span>
          <button
            className="md-preview-toggle"
            onClick={onTogglePreview}
            title="Switch to editor (Ctrl+Shift+M)"
            aria-label="Editor"
          >
            <Eye size={12} />
            Editor
          </button>
        </div>
      </div>

      <style>{`
        .md-preview-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px 32px;
          color: var(--text);
          line-height: 1.6;
          font-size: 14px;
          background: var(--bg-primary);
        }
        .md-preview-body p { margin: 0 0 8px 0; }
        .md-preview-body p:last-child { margin-bottom: 0; }
        .md-preview-body h1, .md-preview-body h2, .md-preview-body h3,
        .md-preview-body h4, .md-preview-body h5, .md-preview-body h6 {
          color: var(--text);
          margin: 16px 0 8px 0;
        }
        .md-preview-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
        .md-preview-body h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
        .md-preview-body h3 { font-size: 1.2em; }
        .md-preview-body code {
          background: var(--bg-hover);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
          border: 1px solid var(--border);
        }
        .md-preview-body pre code { background: none; padding: 0; border: none; }
        .md-preview-body pre {
          background: var(--bg-secondary);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          margin: 8px 0;
        }
        .md-preview-body a { color: var(--accent); text-decoration: underline; }
        .md-preview-body a:hover { opacity: 0.8; }
        .md-preview-body table {
          border-collapse: collapse;
          width: 100%;
          margin: 8px 0;
          font-size: 13px;
        }
        .md-preview-body th,
        .md-preview-body td {
          border: 1px solid var(--border);
          padding: 6px 12px;
          text-align: left;
        }
        .md-preview-body th {
          background: var(--bg-secondary);
          font-weight: 600;
          color: var(--text);
        }
        .md-preview-body td { color: var(--text-secondary); }
        .md-preview-body tr:hover td { background: var(--bg-secondary); }
        .md-preview-body ul, .md-preview-body ol { padding-left: 24px; margin: 4px 0 8px 0; }
        .md-preview-body li { margin: 2px 0; }
        .md-preview-body blockquote {
          border-left: 3px solid var(--accent);
          margin: 8px 0;
          padding: 4px 12px;
          color: var(--text-muted);
        }
        .md-preview-body img { max-width: 100%; border-radius: 6px; }
        .md-preview-body hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
        .md-preview-body pre code.hljs.language-diff .hljs-addition {
          color: var(--text);
          background: rgba(72, 100, 40, 0.35);
          display: inline-block;
          width: 100%;
        }
        .md-preview-body pre code.hljs.language-diff .hljs-deletion {
          color: var(--text);
          background: rgba(180, 60, 40, 0.25);
          display: inline-block;
          width: 100%;
        }
        .md-preview-toggle {
          background: rgba(199,145,12,0.15);
          border: 1px solid rgba(199,145,12,0.4);
          border-radius: 3px;
          color: var(--accent);
          font-size: 11px;
          padding: 1px 8px;
          cursor: pointer;
          font-family: 'JetBrains Mono', monospace;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .md-preview-toggle:hover {
          background: rgba(199,145,12,0.25);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/CodePanel/MarkdownPreview.test.tsx`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CodePanel/MarkdownPreview.tsx tests/unit/components/CodePanel/MarkdownPreview.test.tsx
git commit -m "feat: add MarkdownPreview component with tests"
```

---

### Task 3: Add Preview toggle button to MonacoEditor status bar

**Files:**
- Modify: `src/components/FileExplorer/MonacoEditor.tsx:70-80,174-210`

- [ ] **Step 1: Add `onTogglePreview` prop**

In `MonacoEditor.tsx`, add the new optional prop to the interface (line 70-80):

```typescript
interface MonacoEditorProps {
  filePath: string;
  content: string;
  fontSize?: number;
  minimap?: boolean;
  initialLine?: number;
  onSave: (filePath: string, content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onContentChange?: (filePath: string, content: string) => void;
  onLineRevealed?: () => void;
  onTogglePreview?: () => void;
}
```

Update the destructured props on line 82:

```typescript
export default function MonacoEditor({ filePath, content, fontSize = 13, minimap = true, initialLine, onSave, onDirtyChange, onContentChange, onLineRevealed, onTogglePreview }: MonacoEditorProps) {
```

- [ ] **Step 2: Add the Preview button to the status bar**

In the status bar JSX (around line 178-187), add a Preview button after UTF-8, only when the language is `markdown`:

Replace the status bar section:

```tsx
      {/* Status Bar */}
      <div className="monaco-statusbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {dirty && <span className="monaco-dirty-dot" />}
          <span>{language}</span>
          {saveError && <span style={{ color: 'var(--red)' }}>Save failed</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
          <span>UTF-8</span>
          {language === 'markdown' && onTogglePreview && (
            <button
              className="md-editor-preview-btn"
              onClick={onTogglePreview}
              title="Preview markdown (Ctrl+Shift+M)"
              aria-label="Preview"
            >
              Preview
            </button>
          )}
        </div>
      </div>
```

- [ ] **Step 3: Add the button CSS**

Add to the existing `<style>` block in MonacoEditor (after the `.monaco-dirty-dot` rule):

```css
.md-editor-preview-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 11px;
  padding: 1px 8px;
  cursor: pointer;
  font-family: 'JetBrains Mono', monospace;
}
.md-editor-preview-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
```

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileExplorer/MonacoEditor.tsx
git commit -m "feat: add Preview toggle button to MonacoEditor status bar"
```

---

### Task 4: Wire up CodePanel to render MarkdownPreview

**Files:**
- Modify: `src/components/CodePanel/CodePanel.tsx:1-333`
- Modify: `tests/unit/components/CodePanel/CodePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to the end of the `describe('CodePanel', ...)` block in `tests/unit/components/CodePanel/CodePanel.test.tsx`:

```tsx
  it('renders MarkdownPreview when mdPreview is true for a .md file', () => {
    const mdFile = makeOpenFile({
      path: '/project/README.md',
      content: '# Hello\n\nWorld',
      mdPreview: true,
    });
    const { container } = render(
      <CodePanel
        {...defaultProps}
        openFiles={[mdFile]}
        activeFilePath="/project/README.md"
        onToggleMdPreview={vi.fn()}
      />
    );
    // MarkdownPreview renders the content as HTML, not raw markdown
    expect(container.textContent).toContain('Hello');
    // Should have the preview status bar with "Editor" button
    const editorBtn = container.querySelector('[aria-label="Editor"]');
    expect(editorBtn).toBeTruthy();
  });

  it('renders MonacoEditor when mdPreview is false for a .md file', () => {
    const mdFile = makeOpenFile({
      path: '/project/README.md',
      content: '# Hello\n\nWorld',
      mdPreview: false,
    });
    const { container } = render(
      <CodePanel
        {...defaultProps}
        openFiles={[mdFile]}
        activeFilePath="/project/README.md"
        onToggleMdPreview={vi.fn()}
      />
    );
    // Should NOT have the preview Editor button
    const editorBtn = container.querySelector('[aria-label="Editor"]');
    expect(editorBtn).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/CodePanel/CodePanel.test.tsx`
Expected: FAIL — `onToggleMdPreview` is not a known prop.

- [ ] **Step 3: Update CodePanel to support preview rendering**

In `src/components/CodePanel/CodePanel.tsx`:

Add the import at the top (after line 5):

```typescript
import MarkdownPreview from './MarkdownPreview';
```

Add `onToggleMdPreview` to the props interface (after `onLineRevealed`):

```typescript
  onToggleMdPreview?: (path: string) => void;
```

Add it to the destructured props (after `onLineRevealed`):

```typescript
  onToggleMdPreview,
```

Replace the content rendering section (lines 309-330) with:

```tsx
      {/* Content */}
      {isDiff && activeFile.file ? (
        <DiffViewer
          projectPath={projectPath}
          filePath={activeFile.file.path}
          staged={activeFile.file.staged}
          mode={activeFile.diffMode ?? 'unified'}
        />
      ) : activeFile.viewMode === 'editor' && activeFile.mdPreview && activeFile.content !== undefined ? (
        <MarkdownPreview
          content={activeFile.content}
          onTogglePreview={() => onToggleMdPreview?.(activeFile.path)}
        />
      ) : activeFile.viewMode === 'editor' && activeFile.content !== undefined ? (
        <MonacoEditor
          key={activeFile.path}
          filePath={activeFile.path}
          content={activeFile.content}
          fontSize={editorFontSize}
          minimap={editorMinimap}
          initialLine={activeFile.pendingLine}
          onSave={onEditorSave}
          onContentChange={onEditorContentChange}
          onDirtyChange={onEditorDirtyChange ? (dirty) => onEditorDirtyChange(activeFile.path, dirty) : undefined}
          onLineRevealed={onLineRevealed ? () => onLineRevealed(activeFile.path) : undefined}
          onTogglePreview={onToggleMdPreview ? () => onToggleMdPreview(activeFile.path) : undefined}
        />
      ) : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/CodePanel/CodePanel.test.tsx`
Expected: All tests PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/CodePanel/CodePanel.tsx tests/unit/components/CodePanel/CodePanel.test.tsx
git commit -m "feat: wire CodePanel to render MarkdownPreview for .md files"
```

---

### Task 5: Add toggle handler and keyboard shortcut in App.tsx

**Files:**
- Modify: `src/App.tsx:601-607,1021-1046`

- [ ] **Step 1: Add `handleToggleMdPreview` callback**

In `src/App.tsx`, after the `handleDiffModeChange` callback (around line 607), add:

```typescript
  const handleToggleMdPreview = useCallback((path: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f =>
        f.path === path ? { ...f, mdPreview: !f.mdPreview } : f
      ),
    }));
  }, [activeProjectPath, updateWorkspace]);
```

- [ ] **Step 2: Add `Ctrl+Shift+M` keyboard shortcut**

Find the existing `useEffect` that handles keyboard shortcuts in App.tsx (there's one in CodePanel for Escape — we need a global one in App). Add a new `useEffect` after the `handleToggleMdPreview` definition:

```typescript
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        if (!activeProjectPath) return;
        const ws = workspaces.get(activeProjectPath);
        const activePath = ws?.activeFilePath;
        if (activePath && activePath.endsWith('.md')) {
          handleToggleMdPreview(activePath);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeProjectPath, workspaces, handleToggleMdPreview]);
```

- [ ] **Step 3: Pass `onToggleMdPreview` to CodePanel**

In the `<CodePanel>` JSX (around line 1021), add the new prop:

```tsx
              <CodePanel
                openFiles={openFiles}
                activeFilePath={activeFilePath}
                projectPath={projectPath}
                editorFontSize={editorFontSize}
                editorMinimap={editorMinimap}
                onActivate={(path: string) => {
                  if (activeProjectPath) {
                    updateWorkspace(activeProjectPath, ws => ({ ...ws, activeFilePath: path }));
                  }
                }}
                onClose={handleFileClose}
                onCloseAll={handleCloseAllFiles}
                onDiffModeChange={handleDiffModeChange}
                onEditorSave={handleEditorSave}
                onEditorContentChange={handleEditorContentChange}
                onEditorDirtyChange={handleEditorDirtyChange}
                externallyModified={externallyModified}
                onReloadFile={handleReloadFile}
                onKeepMyEdits={handleKeepMyEdits}
                onToggleMdPreview={handleToggleMdPreview}
                onLineRevealed={(path: string) => {
```

- [ ] **Step 4: Verify no type errors and existing tests still pass**

Run: `npx tsc --noEmit && npx vitest run tests/unit/components/`
Expected: No type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add markdown preview toggle handler and Ctrl+Shift+M shortcut"
```

---

### Task 6: Manual smoke test

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify editor mode**

Open any `.md` file (e.g., `README.md`). Confirm:
- The file opens in Monaco as raw markdown
- A "Preview" button appears in the status bar (right side, after UTF-8)
- Non-`.md` files do NOT show the Preview button

- [ ] **Step 3: Verify preview toggle**

Click the "Preview" button. Confirm:
- The editor is replaced by rendered markdown
- Headings, bold, code blocks, lists, tables render correctly
- The status bar shows "markdown preview" on the left
- An accent-colored "Editor" button appears on the right
- Clicking "Editor" returns to Monaco

- [ ] **Step 4: Verify keyboard shortcut**

With a `.md` file open in editor mode, press `Ctrl+Shift+M`. Confirm:
- Toggles to preview
- Press again: toggles back to editor

- [ ] **Step 5: Verify tab switching preserves state**

Open two `.md` files. Toggle one to preview. Switch tabs and back. Confirm:
- The preview state is preserved per file

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```
