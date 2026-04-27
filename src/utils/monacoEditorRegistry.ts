import type * as monaco from 'monaco-editor';

/**
 * Tracks live Monaco editor instances by filePath so other parts of the app
 * (e.g. the Find & Replace sidebar) can dispatch edits to the right editor
 * and benefit from a single Ctrl+Z undo per file.
 */
const editorsByPath = new Map<string, monaco.editor.IStandaloneCodeEditor>();

export function registerMonacoEditor(filePath: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  editorsByPath.set(filePath, editor);
}

export function unregisterMonacoEditor(filePath: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  if (editorsByPath.get(filePath) === editor) {
    editorsByPath.delete(filePath);
  }
}

export function getMonacoEditorFor(filePath: string): monaco.editor.IStandaloneCodeEditor | undefined {
  return editorsByPath.get(filePath);
}
