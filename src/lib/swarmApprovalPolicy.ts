import type { ApprovalPolicy } from '../types';
import { isReadTool } from './swarmToolTaxonomy';

export function shouldRequireApproval(policy: ApprovalPolicy, toolName: string): boolean {
  if (policy === 'auto') return false;
  if (policy === 'always-ask') return true;
  // auto-read: auto-approve reads, pause on anything that isn't a known read.
  return !isReadTool(toolName);
}
