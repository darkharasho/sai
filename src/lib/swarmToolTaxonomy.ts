/**
 * Single source of truth for classifying provider tool-call names as read-only
 * vs writing. Matches the real capitalized names the Claude provider emits in
 * `approval_needed` events (Read, Edit, Bash, …) AND the legacy snake_case
 * aliases that older code/providers used. Matching is case-insensitive.
 *
 * Consumed by:
 *  - swarmApprovalPolicy.shouldRequireApproval (auto-read auto-approves reads)
 *  - swarmScheduler.isWriteTool (materialize a worktree before the first write)
 *  - ApprovalTray (the "approve all reads" affordance)
 */
export type ToolClass = 'read' | 'write' | 'other';

// All entries are lowercase; lookups lowercase the input.
const READ_NAMES = new Set<string>([
  // real provider names
  'read', 'grep', 'glob', 'ls', 'webfetch', 'websearch', 'notebookread', 'todoread',
  // legacy aliases
  'read_file', 'list_files', 'search', 'view', 'cat',
]);

const WRITE_NAMES = new Set<string>([
  // real provider names
  'edit', 'multiedit', 'write', 'notebookedit', 'bash',
  // legacy aliases
  'edit_file', 'write_file', 'apply_patch', 'str_replace', 'create_file',
]);

export function classifyTool(name: string): ToolClass {
  if (!name || typeof name !== 'string') return 'other';
  const n = name.toLowerCase();
  if (READ_NAMES.has(n)) return 'read';
  if (WRITE_NAMES.has(n)) return 'write';
  return 'other';
}

export function isReadTool(name: string): boolean {
  return classifyTool(name) === 'read';
}

export function isWriteTool(name: string): boolean {
  return classifyTool(name) === 'write';
}
