import type { CodexApprovalDecision, CodexApprovalResult } from '../../electron/services/codexBackend';
import type { SwarmApproval } from '../types';

export interface CodexAppServerApprovalBridge {
  codexAppServerApprove?: (
    projectPath: string,
    scope: string | undefined,
    requestHandle: string,
    decision: CodexApprovalDecision,
  ) => Promise<CodexApprovalResult>;
}

/** Build the only generic approve/deny decisions the Swarm card can safely offer. */
export function codexAppServerSwarmDecision(
  approval: Pick<SwarmApproval, 'provider' | 'requestHandle' | 'kind' | 'availableDecisions' | 'requestedPermissions'>,
  approved: boolean,
): CodexApprovalDecision | undefined {
  if (approval.provider !== 'codex' || !approval.requestHandle || !approval.kind) return undefined;
  if (approval.kind === 'permissions') {
    return { type: 'permissions', permissions: approved ? (approval.requestedPermissions ?? []) : [], scope: 'turn' };
  }
  const value = approved ? 'accept' : 'decline';
  if (!approval.availableDecisions?.includes(value)) return undefined;
  return { type: 'decision', value };
}

/**
 * Resolve an App Server approval without ever exposing or guessing a protocol
 * request ID. A false result deliberately leaves the Swarm card and IndexedDB
 * record untouched so stale requests remain visible rather than appearing done.
 */
export async function resolveCodexAppServerSwarmApproval(
  bridge: CodexAppServerApprovalBridge,
  approval: SwarmApproval,
  scope: string,
  approved: boolean,
): Promise<boolean> {
  const decision = codexAppServerSwarmDecision(approval, approved);
  if (!decision || !approval.requestHandle || !bridge.codexAppServerApprove) return false;
  const result = await bridge.codexAppServerApprove(approval.workspaceId, scope, approval.requestHandle, decision);
  return result.ok;
}
