// PWA-faithful presenter — mirrors src/renderer-remote/chat/ToolCard.tsx's
// summarize() function. Returns a label (one-line monospace string shown in
// the card header) and an optional body (multi-line pre-formatted content
// rendered inside the expanded card).
export interface ToolSummary {
  label: string;
  body?: string;
  language?: 'bash' | 'diff' | 'json' | string;
}

export function summarizeTool(name: string | undefined, input: unknown): ToolSummary {
  if (!input || typeof input !== 'object') return { label: '' };
  const lower = (name ?? '').toLowerCase();
  const i = input as Record<string, unknown>;

  // Bash / terminal
  if (lower === 'bash' || typeof i.command === 'string') {
    const cmd = typeof i.command === 'string' ? i.command : '';
    return { label: cmd, body: cmd, language: 'bash' };
  }
  // Edit — show a diff-style body
  if (typeof i.file_path === 'string' && i.old_string != null) {
    const oldLines = String(i.old_string ?? '').split('\n').map((l) => `- ${l}`).join('\n');
    const newLines = String(i.new_string ?? '').split('\n').map((l) => `+ ${l}`).join('\n');
    return { label: String(i.file_path), body: `${oldLines}\n${newLines}`, language: 'diff' };
  }
  // Write
  if (typeof i.file_path === 'string' && typeof i.content === 'string') {
    return { label: String(i.file_path), body: String(i.content) };
  }
  // Read / single-file ops
  if (typeof i.file_path === 'string') {
    return { label: String(i.file_path) };
  }
  // Grep / Glob
  if (typeof i.pattern === 'string') {
    return { label: `${lower.includes('glob') ? 'glob' : 'grep'}: ${String(i.pattern)}` };
  }
  // WebFetch / WebSearch
  if (typeof i.url === 'string') return { label: String(i.url) };
  if (typeof i.query === 'string') return { label: String(i.query) };
  // TodoWrite
  if (Array.isArray(i.todos)) return { label: `${(i.todos as unknown[]).length} todos` };
  // AskUserQuestion (rendered as a custom view by ToolCard for now we keep label)
  if (name === 'AskUserQuestion') {
    const answers = i.answers;
    const answered = answers && typeof answers === 'object' && Object.keys(answers as object).length > 0;
    return { label: answered ? 'Answered' : 'Waiting for answer…' };
  }
  // Fallback: a small one-line preview of the keys
  const keys = Object.keys(i).slice(0, 3);
  return { label: keys.length ? keys.join(', ') : '' };
}

// Legacy shim — older callers (ApprovalCard) still want a simple
// `{ label, summary }` shape. Map the rich summary back to that.
export function presentTool(toolName?: string, input?: unknown): { label: string; summary: string } {
  const s = summarizeTool(toolName, input);
  const fallbackLabel = toolName ?? 'Tool';
  return { label: fallbackLabel, summary: s.label };
}
