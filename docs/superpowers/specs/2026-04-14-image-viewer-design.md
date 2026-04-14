# Image Viewer for Code Editor

## Overview

Add image preview support to SAI's code editor tabs. When a user opens an image file from the file explorer, the editor tab shows a visual preview instead of raw binary/text in Monaco. SVG files default to image preview with a toggle to view/edit the XML source.

## Supported Formats

PNG, JPG, JPEG, GIF, WebP, SVG

Detected by file extension, stored as a constant set `IMAGE_EXTENSIONS`.

## Architecture

### Render chain modification

CodePanel currently switches content rendering based on `viewMode` and file properties:

1. `viewMode === 'diff'` → `<DiffViewer>`
2. `viewMode === 'editor'` + `mdPreview` → `<MarkdownPreview>`
3. `viewMode === 'editor'` → `<MonacoEditor>`

A new branch is inserted before the MonacoEditor fallback:

4. `viewMode === 'editor'` + image extension → `<ImageViewer>` **(new)**

### Data flow changes in handleFileOpen (App.tsx)

When the file extension matches `IMAGE_EXTENSIONS`:

- Skip `fsReadFile` — no text content is needed for image preview
- Store the file in `openFiles` with `viewMode: 'editor'` and `content: undefined`
- The image is loaded in the browser via Electron's `file://` protocol URL built from the absolute path
- `diskMtime` is still fetched (for potential future reload-on-change)

When the extension does not match, behavior is unchanged.

### OpenFile type

No changes to the `OpenFile` interface. Image files use existing fields:
- `path`: absolute file path (used to build `file://` URL)
- `viewMode`: `'editor'`
- `content`: `undefined` for image preview mode

The ImageViewer component detects image files by checking the extension of `activeFile.path`.

## ImageViewer Component

**Location:** `src/components/CodePanel/ImageViewer.tsx`

### Props

```ts
interface ImageViewerProps {
  filePath: string;
  projectPath: string;
  onEditorSave?: (filePath: string, content: string) => Promise<void>;
  onEditorContentChange?: (filePath: string, content: string) => void;
  onEditorDirtyChange?: (filePath: string, dirty: boolean) => void;
  editorFontSize?: number;
  editorMinimap?: boolean;
}
```

The editor-related props are passed through for SVG source editing mode.

### Image Preview Mode (default)

- Full container with CSS checkerboard background to reveal transparency
- Image element centered horizontally and vertically
- `max-width: 100%; max-height: 100%` with `object-fit: contain` — scales down large images to fit, never scales up past natural size
- Bottom status bar showing:
  - Image dimensions (W × H pixels), read from the `<img>` element's `naturalWidth`/`naturalHeight` after load
  - File type label (e.g., "PNG", "SVG")

### SVG Source Toggle

For `.svg` files only, a toggle button appears in the top-right corner:

- **"View Source"** — switches to Monaco editor showing the SVG XML
  - On first toggle, reads SVG content via `window.sai.fsReadFile(filePath)`
  - Content is cached in component state for subsequent toggles
  - Monaco editor is fully functional: syntax highlighting, editing, save (Ctrl+S)
  - Dirty state propagated through `onEditorDirtyChange`
- **"Preview"** — switches back to image preview
  - If the SVG was edited and saved, the preview reloads by appending a cache-busting query param to the `file://` URL

### State

```ts
const [svgSourceMode, setSvgSourceMode] = useState(false);
const [svgContent, setSvgContent] = useState<string | null>(null);
const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
```

## File Explorer Changes

**Location:** `src/components/FileExplorer/FileExplorerSidebar.tsx`

Add image file extensions to the icon mapping. Image files get the Lucide `Image` icon with a distinct color (e.g., `#a78bfa` purple or similar) to visually distinguish them from code files.

## Shared Utility

**Location:** `src/utils/imageFiles.ts`

```ts
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}
```

Imported by App.tsx, CodePanel.tsx, and FileExplorerSidebar.tsx.

## CodePanel Integration

**Location:** `src/components/CodePanel/CodePanel.tsx`

Import `isImageFile` from shared utility. Modify the content rendering conditional chain to insert the ImageViewer branch before the MonacoEditor fallback.

## handleFileOpen Changes

**Location:** `src/App.tsx`

Import `isImageFile` from shared utility. Modify `handleFileOpen` to detect image files:

```ts

if (isImage) {
  // Skip fsReadFile — just open the tab with path only
  const { mtime } = await window.sai.fsMtime(filePath);
  updateWorkspace(activeProjectPath, ws => {
    const exists = ws.openFiles.some(f => f.path === filePath);
    return {
      ...ws,
      openFiles: exists
        ? ws.openFiles
        : [...ws.openFiles, { path: filePath, viewMode: 'editor', diskMtime: mtime }],
      activeFilePath: filePath,
    };
  });
} else {
  // existing text file logic unchanged
}
```

## Testing

- Unit tests for `isImageFile` utility
- Unit tests for ImageViewer component rendering (image load, dimensions display, SVG toggle)
- Manual testing: open each supported format from file explorer, verify preview renders
- Manual testing: SVG toggle between preview and source, edit and save, verify preview updates
- Manual testing: verify non-image files still open normally in Monaco

## Out of Scope

- Zoom/pan controls
- Image editing
- Side-by-side image comparison
- Drag-and-drop image files
- Image format conversion
- Thumbnail previews in file explorer
