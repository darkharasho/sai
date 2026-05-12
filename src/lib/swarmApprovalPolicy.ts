import type { ApprovalPolicy } from '../types';

export const READ_TOOLS = new Set(['read_file', 'list_files', 'grep', 'glob', 'search']);

export function shouldRequireApproval(policy: ApprovalPolicy, toolName: string): boolean {
  if (policy === 'auto') return false;
  if (policy === 'always-ask') return true;
  return !READ_TOOLS.has(toolName);
}
