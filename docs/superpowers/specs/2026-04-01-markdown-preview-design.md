# Markdown Preview Toggle

## Overview

Add a toggle to the editor that renders `.md` files as formatted markdown. Users can switch between raw editing (Monaco) and a read-only rendered preview. The preview reuses the existing `react-markdown` infrastructure from chat messages.

## Motivation

Markdown files are common in any project (READMEs, docs, changelogs). Currently they open as plain text in Monaco with syntax highlighting but no way to see the rendered output. A preview toggle lets users verify formatting without leaving the editor.

## Design Decisions

- **Full replacement, not split pane.** Preview replaces the editor entirely. Simpler to implement, avoids layout complexity. Split pane can be added later if needed.
- **Read-only preview.** No editing in preview mode. All editing happens in Monaco.
- **Reuse chat markdown styles.** The chat already renders markdown with `react-markdown` + `remark-gfm` + `rehype-highlight` and has battle-tested CSS. The preview will reuse these styles directly rather than creating new ones.
- **Toggle in status bar.** The button lives in the MonacoEditor status bar (right side), only visible for `.md` files. Consistent with the existing status bar pattern.
- **Keyboard shortcut.** `Ctrl+Shift+M` toggles between editor and preview.

## Components

### 1. `types.ts` — OpenFile change

Add `mdPreview?: boolean` to the `OpenFile` interface. When `true`, the file renders in preview mode instead of Monaco.

### 2. `MarkdownPreview.tsx` — New component

Location: `src/components/CodePanel/MarkdownPreview.tsx`

Props:
- `content: string` — the markdown content to render (latest, including unsaved edits)
- `onTogglePreview: () => void` — callback to switch back to editor

Renders:
- Scrollable container with rendered markdown (using `ReactMarkdown`, `remarkGfm`, `rehypeHighlight`)
- Status bar at the bottom matching MonacoEditor's status bar style:
  - Left: "markdown" + "preview" label
  - Right: "UTF-8" + "Editor" toggle button (accent-highlighted)

CSS: Reuses `.chat-msg-body` styles from ChatMessage.tsx. These styles will be extracted to a shared location or duplicated inline in the component (they're stable and not large).

### 3. `MonacoEditor.tsx` — Status bar toggle button

For `.md` files only, add a "Preview" button to the right side of the existing status bar (after "UTF-8"). The button:
- Has a subtle border, matches status bar font
- Calls a new `onTogglePreview` callback prop
- Only renders when the file language is `markdown`

New prop: `onTogglePreview?: () => void`

### 4. `CodePanel.tsx` — Conditional rendering

In the content area, add a third branch: when `activeFile.mdPreview` is `true` and the file is a `.md` file, render `MarkdownPreview` instead of `MonacoEditor`. Pass the file's current content (which may include unsaved edits).

### 5. `App.tsx` — State management and keyboard shortcut

- Add a `handleToggleMdPreview(path: string)` function that toggles `mdPreview` on the target OpenFile.
- Register a global `Ctrl+Shift+M` keyboard handler that calls this for the active file (only if it's a `.md` file).
- Pass `onToggleMdPreview` down through CodePanel to MonacoEditor.

## Data Flow

```
User clicks "Preview" in status bar (or Ctrl+Shift+M)
  -> App.handleToggleMdPreview(activeFilePath)
  -> Sets openFile.mdPreview = true
  -> CodePanel re-renders
  -> Renders MarkdownPreview instead of MonacoEditor
  -> MarkdownPreview receives current content (including unsaved edits)

User clicks "Editor" in preview status bar (or Ctrl+Shift+M again)
  -> App.handleToggleMdPreview(activeFilePath)
  -> Sets openFile.mdPreview = false
  -> CodePanel re-renders
  -> Renders MonacoEditor with the file content
```

## Edge Cases

- **Unsaved edits:** Preview always shows the latest in-memory content, not the saved-to-disk version. This means unsaved bold/heading changes are immediately visible in preview.
- **External file changes while in preview:** The existing external-change banner still works. If the user reloads, the preview updates with new content.
- **Switching tabs:** Each file's `mdPreview` state is independent. Switching to another tab and back preserves the preview/editor state.
- **Non-.md files:** The toggle button and shortcut are no-ops for non-markdown files.

## Testing

- Toggle button appears only for `.md` files, not for `.ts`, `.js`, etc.
- Clicking toggle switches between editor and preview.
- `Ctrl+Shift+M` shortcut works.
- Preview renders headings, bold, lists, code blocks, tables, links.
- Unsaved edits are visible in preview.
- Switching tabs preserves preview state per file.
- Toggle button style changes between "Preview" (inactive) and "Editor" (active/highlighted).
