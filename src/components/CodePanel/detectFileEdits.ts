// Pure extractors over RAW Claude CLI message content blocks (not the app's assembled
// ToolCall objects). An edit's path comes from an assistant `tool_use` block; its
// completion comes from a later user `tool_result` block. The App handler correlates them.

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

function joinPath(root: string, p: string): string {
  if (!root) return p;
  return root.replace(/[/\\]+$/, '') + '/' + p.replace(/^[/\\]+/, '');
}

/** Edit tool_use blocks → { id, absolutePath }. Non-array content yields []. */
export function extractEditToolUses(content: unknown, projectRoot: string): { id: string; path: string }[] {
  if (!Array.isArray(content)) return [];
  const out: { id: string; path: string }[] = [];
  for (const block of content) {
    if (!block || block.type !== 'tool_use' || !EDIT_TOOLS.has(block.name)) continue;
    const input = block.input || {};
    const raw = typeof input.file_path === 'string' ? input.file_path
      : typeof input.notebook_path === 'string' ? input.notebook_path
      : null;
    if (!raw || typeof block.id !== 'string') continue;
    out.push({ id: block.id, path: isAbsolute(raw) ? raw : joinPath(projectRoot, raw) });
  }
  return out;
}

/** tool_use_ids of non-error tool_result blocks. Non-array content yields []. */
export function successfulToolResultIds(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (!block || block.type !== 'tool_result' || block.is_error === true) continue;
    if (typeof block.tool_use_id === 'string') ids.push(block.tool_use_id);
  }
  return ids;
}
