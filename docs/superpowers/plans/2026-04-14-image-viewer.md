# Image Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image preview support to editor tabs so users see images instead of raw binary when opening image files.

**Architecture:** New `ImageViewer` component renders in CodePanel's existing conditional chain. A new IPC handler (`fs:readFileBase64`) reads image files as data URLs since `file://` protocol is blocked by Electron's `contextIsolation`. `handleFileOpen` detects image extensions and skips text content loading.

**Tech Stack:** React 19, Electron 36, Monaco Editor, Vitest, lucide-react

**Spec:** `docs/superpowers/specs/2026-04-14-image-viewer-design.md`

---

### Task 1: Shared `isImageFile` Utility

**Files:**
- Create: `src/utils/imageFiles.ts`
- Create: `tests/unit/utils/imageFiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/utils/imageFiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isImageFile } from '../../../src/utils/imageFiles';

describe('isImageFile', () => {
  it('returns true for .png files', () => {
    expect(isImageFile('/path/to/image.png')).toBe(true);
  });

  it('returns true for .jpg files', () => {
    expect(isImageFile('/path/to/photo.jpg')).toBe(true);
  });

  it('returns true for .jpeg files', () => {
    expect(isImageFile('/path/to/photo.jpeg')).toBe(true);
  });

  it('returns true for .gif files', () => {
    expect(isImageFile('/path/to/anim.gif')).toBe(true);
  });

  it('returns true for .webp files', () => {
    expect(isImageFile('/path/to/photo.webp')).toBe(true);
  });

  it('returns true for .svg files', () => {
    expect(isImageFile('/path/to/icon.svg')).toBe(true);
  });

  it('returns false for .ts files', () => {
    expect(isImageFile('/path/to/code.ts')).toBe(false);
  });

  it('returns false for .json files', () => {
    expect(isImageFile('/path/to/data.json')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isImageFile('/path/to/IMAGE.PNG')).toBe(true);
    expect(isImageFile('/path/to/photo.JPG')).toBe(true);
  });

  it('returns false for files with no extension', () => {
    expect(isImageFile('/path/to/Makefile')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/utils/imageFiles.test.ts`
Expected: FAIL — module `../../../src/utils/imageFiles` not found

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/imageFiles.ts`:

```ts
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function isSvgFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.svg');
}

export function getImageType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toUpperCase();
  return ext === 'JPG' ? 'JPEG' : ext;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/utils/imageFiles.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/imageFiles.ts tests/unit/utils/imageFiles.test.ts
git commit -m "feat: add isImageFile utility for image extension detection"
```

---

### Task 2: IPC Handler for Base64 Image Reading

**Files:**
- Modify: `electron/services/fs.ts:38` (add new handler after `fs:readFile`)
- Modify: `electron/preload.ts:68` (expose new method)
- Modify: `tests/helpers/ipc-mock.ts:65` (add mock)

- [ ] **Step 1: Add `fs:readFileBase64` IPC handler**

In `electron/services/fs.ts`, add after the existing `fs:readFile` handler (line 40):

```ts
  ipcMain.handle('fs:readFileBase64', async (_event, filePath: string) => {
    const buffer = await fs.promises.readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    };
    const mime = mimeTypes[ext] || 'application/octet-stream';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  });
```

- [ ] **Step 2: Expose in preload**

In `electron/preload.ts`, add after the `fsReadFile` line (line 68):

```ts
  fsReadFileBase64: (filePath: string) => ipcRenderer.invoke('fs:readFileBase64', filePath),
```

- [ ] **Step 3: Add to mock**

In `tests/helpers/ipc-mock.ts`, add `fsReadFileBase64` to the `MockSai` interface after `fsReadFile` (line 65):

```ts
  fsReadFileBase64: ReturnType<typeof vi.fn>;
```

And in the `createMockSai()` function after the `fsReadFile` mock (line 187):

```ts
    fsReadFileBase64: vi.fn().mockResolvedValue('data:image/png;base64,'),
```

- [ ] **Step 4: Commit**

```bash
git add electron/services/fs.ts electron/preload.ts tests/helpers/ipc-mock.ts
git commit -m "feat: add fs:readFileBase64 IPC handler for image loading"
```

---

### Task 3: ImageViewer Component

**Files:**
- Create: `src/components/CodePanel/ImageViewer.tsx`
- Create: `tests/unit/components/CodePanel/ImageViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/CodePanel/ImageViewer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai } from '../../../helpers/ipc-mock';

// Mock monaco-editor (same pattern as CodePanel.test.tsx)
vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn().mockReturnValue({
      dispose: vi.fn(),
      getValue: vi.fn().mockReturnValue(''),
      setValue: vi.fn(),
      onDidChangeModelContent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidChangeCursorPosition: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      addCommand: vi.fn(),
      getModel: vi.fn().mockReturnValue({ uri: { toString: () => 'file:///test' } }),
      updateOptions: vi.fn(),
      layout: vi.fn(),
      focus: vi.fn(),
    }),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    createModel: vi.fn().mockReturnValue({
      dispose: vi.fn(),
      uri: { toString: () => 'file:///test' },
    }),
    getModel: vi.fn().mockReturnValue(null),
    Uri: { parse: vi.fn().mockReturnValue({ toString: () => 'file:///test' }) },
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
  Uri: { parse: vi.fn().mockReturnValue({ toString: () => 'file:///test' }) },
}));
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

// Mock highlight themes
vi.mock('../../src/themes', () => ({
  getActiveHighlightTheme: vi.fn().mockReturnValue('monokai'),
  buildMonacoThemeData: vi.fn().mockReturnValue({ base: 'vs-dark', inherit: true, rules: [], colors: {} }),
}));

import ImageViewer from '../../../src/components/CodePanel/ImageViewer';

describe('ImageViewer', () => {
  let mockSai: ReturnType<typeof installMockSai>;

  beforeEach(() => {
    mockSai = installMockSai();
    mockSai.fsReadFileBase64.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
  });

  it('renders an image element', async () => {
    render(<ImageViewer filePath="/project/logo.png" projectPath="/project" />);
    await waitFor(() => {
      expect(mockSai.fsReadFileBase64).toHaveBeenCalledWith('/project/logo.png');
    });
  });

  it('shows file type label', async () => {
    render(<ImageViewer filePath="/project/logo.png" projectPath="/project" />);
    await waitFor(() => {
      expect(screen.getByText('PNG')).toBeTruthy();
    });
  });

  it('shows View Source button for SVG files', async () => {
    mockSai.fsReadFileBase64.mockResolvedValue('data:image/svg+xml;base64,PHN2Zz4=');
    render(<ImageViewer filePath="/project/icon.svg" projectPath="/project" />);
    await waitFor(() => {
      expect(screen.getByText('View Source')).toBeTruthy();
    });
  });

  it('does not show View Source button for non-SVG files', async () => {
    render(<ImageViewer filePath="/project/logo.png" projectPath="/project" />);
    await waitFor(() => {
      expect(mockSai.fsReadFileBase64).toHaveBeenCalled();
    });
    expect(screen.queryByText('View Source')).toBeNull();
  });

  it('toggles to source view when View Source is clicked', async () => {
    mockSai.fsReadFileBase64.mockResolvedValue('data:image/svg+xml;base64,PHN2Zz4=');
    mockSai.fsReadFile.mockResolvedValue('<svg></svg>');
    render(
      <ImageViewer
        filePath="/project/icon.svg"
        projectPath="/project"
        onEditorSave={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('View Source')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('View Source'));
    await waitFor(() => {
      expect(mockSai.fsReadFile).toHaveBeenCalledWith('/project/icon.svg');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/CodePanel/ImageViewer.test.tsx`
Expected: FAIL — module `ImageViewer` not found

- [ ] **Step 3: Write the ImageViewer component**

Create `src/components/CodePanel/ImageViewer.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { isSvgFile, getImageType } from '../../utils/imageFiles';
import MonacoEditor from '../FileExplorer/MonacoEditor';

interface ImageViewerProps {
  filePath: string;
  projectPath: string;
  onEditorSave?: (filePath: string, content: string) => Promise<void>;
  onEditorContentChange?: (filePath: string, content: string) => void;
  onEditorDirtyChange?: (filePath: string, dirty: boolean) => void;
  editorFontSize?: number;
  editorMinimap?: boolean;
}

export default function ImageViewer({
  filePath,
  projectPath,
  onEditorSave,
  onEditorContentChange,
  onEditorDirtyChange,
  editorFontSize = 13,
  editorMinimap = true,
}: ImageViewerProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [svgSourceMode, setSvgSourceMode] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [cacheKey, setCacheKey] = useState(0);

  const isSvg = isSvgFile(filePath);
  const imageType = getImageType(filePath);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setDimensions(null);
    setSvgSourceMode(false);
    setSvgContent(null);
    setCacheKey(0);

    window.sai.fsReadFileBase64(filePath).then((url: string) => {
      if (!cancelled) setDataUrl(url);
    });

    return () => { cancelled = true; };
  }, [filePath]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  const handleToggleSource = useCallback(async () => {
    if (!svgSourceMode && svgContent === null) {
      const content = await window.sai.fsReadFile(filePath) as string;
      setSvgContent(content);
    }
    setSvgSourceMode(prev => !prev);
  }, [filePath, svgSourceMode, svgContent]);

  const handleSvgSave = useCallback(async (fp: string, content: string) => {
    if (onEditorSave) await onEditorSave(fp, content);
    setSvgContent(content);
    setCacheKey(prev => prev + 1);
  }, [onEditorSave]);

  if (svgSourceMode && svgContent !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <button
          onClick={handleToggleSource}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
            padding: '4px 10px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          Preview
        </button>
        <MonacoEditor
          key={filePath + '-svg-source'}
          filePath={filePath}
          content={svgContent}
          fontSize={editorFontSize}
          minimap={editorMinimap}
          projectPath={projectPath}
          onSave={handleSvgSave}
          onContentChange={onEditorContentChange}
          onDirtyChange={onEditorDirtyChange ? (dirty) => onEditorDirtyChange(filePath, dirty) : undefined}
        />
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Checkerboard background + centered image */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: `
          linear-gradient(45deg, #1e1e1e 25%, transparent 25%),
          linear-gradient(-45deg, #1e1e1e 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #1e1e1e 75%),
          linear-gradient(-45deg, transparent 75%, #1e1e1e 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        backgroundColor: '#181818',
        padding: 24,
      }}>
        {dataUrl ? (
          <img
            src={dataUrl + (cacheKey > 0 ? `#${cacheKey}` : '')}
            alt={filePath.split('/').pop() ?? ''}
            onLoad={handleImageLoad}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</span>
        )}
      </div>

      {/* SVG toggle button */}
      {isSvg && (
        <button
          onClick={handleToggleSource}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '4px 10px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          View Source
        </button>
      )}

      {/* Status bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)',
        flexShrink: 0,
      }}>
        <span>{dimensions ? `${dimensions.w} × ${dimensions.h}` : '–'}</span>
        <span>{imageType}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/CodePanel/ImageViewer.test.tsx`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/CodePanel/ImageViewer.tsx tests/unit/components/CodePanel/ImageViewer.test.tsx
git commit -m "feat: add ImageViewer component with SVG source toggle"
```

---

### Task 4: CodePanel Integration

**Files:**
- Modify: `src/components/CodePanel/CodePanel.tsx:1-7,312-341`

- [ ] **Step 1: Add imports**

At the top of `src/components/CodePanel/CodePanel.tsx`, add after the existing imports (line 6):

```ts
import ImageViewer from './ImageViewer';
import { isImageFile } from '../../utils/imageFiles';
```

- [ ] **Step 2: Insert ImageViewer branch in render chain**

In `CodePanel.tsx`, modify the content rendering section (lines 312-341). Replace:

```tsx
      {/* Content */}
      {isDiff && activeFile.file ? (
        <DiffViewer
          projectPath={projectPath}
          filePath={activeFile.file.path}
          staged={activeFile.file.staged}
          mode={activeFile.diffMode ?? 'unified'}
          minimap={editorMinimap}
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
          projectPath={projectPath}
          initialLine={activeFile.pendingLine}
          onSave={onEditorSave}
          onContentChange={onEditorContentChange}
          onDirtyChange={onEditorDirtyChange ? (dirty) => onEditorDirtyChange(activeFile.path, dirty) : undefined}
          onLineRevealed={onLineRevealed ? () => onLineRevealed(activeFile.path) : undefined}
          onTogglePreview={onToggleMdPreview ? () => onToggleMdPreview(activeFile.path) : undefined}
        />
      ) : null}
```

With:

```tsx
      {/* Content */}
      {isDiff && activeFile.file ? (
        <DiffViewer
          projectPath={projectPath}
          filePath={activeFile.file.path}
          staged={activeFile.file.staged}
          mode={activeFile.diffMode ?? 'unified'}
          minimap={editorMinimap}
        />
      ) : activeFile.viewMode === 'editor' && activeFile.mdPreview && activeFile.content !== undefined ? (
        <MarkdownPreview
          content={activeFile.content}
          onTogglePreview={() => onToggleMdPreview?.(activeFile.path)}
        />
      ) : activeFile.viewMode === 'editor' && isImageFile(activeFile.path) ? (
        <ImageViewer
          key={activeFile.path}
          filePath={activeFile.path}
          projectPath={projectPath}
          onEditorSave={onEditorSave}
          onEditorContentChange={onEditorContentChange}
          onEditorDirtyChange={onEditorDirtyChange}
          editorFontSize={editorFontSize}
          editorMinimap={editorMinimap}
        />
      ) : activeFile.viewMode === 'editor' && activeFile.content !== undefined ? (
        <MonacoEditor
          key={activeFile.path}
          filePath={activeFile.path}
          content={activeFile.content}
          fontSize={editorFontSize}
          minimap={editorMinimap}
          projectPath={projectPath}
          initialLine={activeFile.pendingLine}
          onSave={onEditorSave}
          onContentChange={onEditorContentChange}
          onDirtyChange={onEditorDirtyChange ? (dirty) => onEditorDirtyChange(activeFile.path, dirty) : undefined}
          onLineRevealed={onLineRevealed ? () => onLineRevealed(activeFile.path) : undefined}
          onTogglePreview={onToggleMdPreview ? () => onToggleMdPreview(activeFile.path) : undefined}
        />
      ) : null}
```

- [ ] **Step 3: Run existing CodePanel tests to verify no regression**

Run: `npx vitest run tests/unit/components/CodePanel/CodePanel.test.tsx`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/CodePanel/CodePanel.tsx
git commit -m "feat: integrate ImageViewer into CodePanel render chain"
```

---

### Task 5: handleFileOpen Changes

**Files:**
- Modify: `src/App.tsx:907-937`

- [ ] **Step 1: Add import**

At the top of `src/App.tsx`, add the import (find a suitable location among the existing imports):

```ts
import { isImageFile } from './utils/imageFiles';
```

- [ ] **Step 2: Modify handleFileOpen to detect images**

Replace the `handleFileOpen` callback (lines 907-937):

```ts
  const handleFileOpen = useCallback(async (filePath: string, line?: number) => {
    if (!activeProjectPath) return;
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(activeProjectPath, ws => {
        const exists = ws.openFiles.some(f => f.path === filePath);
        return {
          ...ws,
          openFiles: exists
            ? ws.openFiles.map(f => f.path === filePath ? { ...f, pendingLine: line } : f)
            : [...ws.openFiles, { path: filePath, viewMode: 'editor', content, savedContent: content, diskMtime: mtime, pendingLine: line }],
          activeFilePath: filePath,
        };
      });
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        if (focusedChat && prev.includes('chat')) {
          setSplitRatio(0.66);
          return ['chat', 'editor'];
        }
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, [activeProjectPath, updateWorkspace, focusedChat]);
```

With:

```ts
  const handleFileOpen = useCallback(async (filePath: string, line?: number) => {
    if (!activeProjectPath) return;
    try {
      if (isImageFile(filePath)) {
        const { mtime } = await window.sai.fsMtime(filePath) as { mtime: number };
        updateWorkspace(activeProjectPath, ws => {
          const exists = ws.openFiles.some(f => f.path === filePath);
          return {
            ...ws,
            openFiles: exists
              ? ws.openFiles
              : [...ws.openFiles, { path: filePath, viewMode: 'editor' as const, diskMtime: mtime }],
            activeFilePath: filePath,
          };
        });
      } else {
        const [content, { mtime }] = await Promise.all([
          window.sai.fsReadFile(filePath) as Promise<string>,
          window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
        ]);
        updateWorkspace(activeProjectPath, ws => {
          const exists = ws.openFiles.some(f => f.path === filePath);
          return {
            ...ws,
            openFiles: exists
              ? ws.openFiles.map(f => f.path === filePath ? { ...f, pendingLine: line } : f)
              : [...ws.openFiles, { path: filePath, viewMode: 'editor', content, savedContent: content, diskMtime: mtime, pendingLine: line }],
            activeFilePath: filePath,
          };
        });
      }
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        if (focusedChat && prev.includes('chat')) {
          setSplitRatio(0.66);
          return ['chat', 'editor'];
        }
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, [activeProjectPath, updateWorkspace, focusedChat]);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: skip text content loading for image files in handleFileOpen"
```

---

### Task 6: File Explorer Icon for Images

**Files:**
- Modify: `src/components/FileExplorer/FileExplorerSidebar.tsx:2,6-34`

- [ ] **Step 1: Add Image icon import**

In `FileExplorerSidebar.tsx`, modify the lucide-react import (line 2):

Replace:
```ts
import { Folder, FolderOpen, FileText, FileCode2, ChevronRight, ChevronDown, FilePlus, FolderPlus } from 'lucide-react';
```

With:
```ts
import { Folder, FolderOpen, FileText, FileCode2, Image, ChevronRight, ChevronDown, FilePlus, FolderPlus } from 'lucide-react';
```

- [ ] **Step 2: Add image extensions and colors**

Add the image extensions set and colors. Modify the `EXT_COLORS` object (after line 10) to add image extension colors:

After the existing `EXT_COLORS` entries (line 26), add:

```ts
  '.png': 'var(--purple)', '.jpg': 'var(--purple)', '.jpeg': 'var(--purple)',
  '.gif': 'var(--purple)', '.webp': 'var(--purple)', '.svg': 'var(--purple)',
```

- [ ] **Step 3: Add image extension set and update getFileIcon**

Add an `IMAGE_EXTENSIONS` set after `CODE_EXTENSIONS` (after line 10):

```ts
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
]);
```

Update the `getFileIcon` function (lines 29-34):

Replace:
```ts
function getFileIcon(name: string): { icon: typeof FileCode2; color: string } {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  const color = EXT_COLORS[ext] || 'var(--text-muted)';
  if (CODE_EXTENSIONS.has(ext)) return { icon: FileCode2, color };
  return { icon: FileText, color };
}
```

With:
```ts
function getFileIcon(name: string): { icon: typeof FileCode2; color: string } {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  const color = EXT_COLORS[ext] || 'var(--text-muted)';
  if (CODE_EXTENSIONS.has(ext)) return { icon: FileCode2, color };
  if (IMAGE_EXTENSIONS.has(ext)) return { icon: Image, color };
  return { icon: FileText, color };
}
```

- [ ] **Step 4: Run existing file explorer tests**

Run: `npx vitest run tests/unit/components/FileExplorer/FileExplorer.test.tsx`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/FileExplorer/FileExplorerSidebar.tsx
git commit -m "feat: add image file icon in file explorer sidebar"
```

---

### Task 7: Manual Testing & Polish

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Test image preview**

Open a project that contains image files. In the file explorer, click on:
- A `.png` file → should show centered preview with checkerboard background, dimensions in status bar, "PNG" label
- A `.jpg` file → same behavior, "JPEG" label
- A `.gif` file → same behavior, should animate if the GIF is animated
- A `.webp` file → same behavior
- A `.svg` file → should show preview with "View Source" button

Verify:
- Image is centered and scales down to fit (doesn't overflow)
- Checkerboard pattern visible behind transparent areas
- Dimensions update after image loads
- Tab appears in tab bar with file name, closeable via X or middle-click

- [ ] **Step 3: Test SVG source toggle**

Click "View Source" on an SVG file:
- Monaco editor appears with XML syntax highlighting
- "Preview" button appears top-right
- Edit the SVG, press Ctrl+S to save
- Click "Preview" — image should reflect saved changes
- Dirty dot should appear in tab when SVG source is modified

- [ ] **Step 4: Test non-image files still work**

Open a `.ts`, `.json`, `.md` file — should open in Monaco as before.

- [ ] **Step 5: Test image icon in file explorer**

Image files should show the Image icon (mountain/landscape icon) in purple instead of the generic FileText icon.

- [ ] **Step 6: Final commit if any polish needed**

```bash
git add -A
git commit -m "fix: polish image viewer after manual testing"
```

Only commit this if changes were needed during manual testing.
