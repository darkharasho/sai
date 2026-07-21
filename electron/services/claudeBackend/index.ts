import { readSaiSetting } from '../claude';
import { CliBackend } from './cliBackend';
import { SdkBackend } from './sdkBackend';
import { buildSaiChatMcpServer } from './saiMcpServer';
import { buildSwarmMcpServer } from './swarmMcpServer';
import { getSaiToolDispatch } from '../saiToolBridge';
import { registerWorkspaceBackendHooks } from '../workspace';
import type { ClaudeBackend } from './types';
export * from './types';

export function getClaudeBackendSetting(): 'cli' | 'sdk' {
  // SDK is the default (full cutover 2026-07-04); 'cli' is the explicit
  // opt-out escape hatch while the legacy path still exists.
  return readSaiSetting('claudeBackend') === 'cli' ? 'cli' : 'sdk';
}

let active: ClaudeBackend | null = null;

export function getClaudeBackend(): ClaudeBackend {
  if (active) return active;
  const which = getClaudeBackendSetting();
  if (which === 'sdk') {
    const sdk = new SdkBackend({
      buildChatMcpServer: (workspace: string) => {
        const dispatch = getSaiToolDispatch();
        if (!dispatch) return undefined; // main.ts hasn't registered the round-trip yet
        return buildSaiChatMcpServer({ workspace, dispatch });
      },
      buildSwarmMcpServer: (workspace: string) => {
        const dispatch = getSaiToolDispatch();
        if (!dispatch) return undefined;
        return buildSwarmMcpServer({ workspace, dispatch });
      },
    });
    // SDK sessions live outside the workspace registry — wire suspend/quiescence
    // through so the dropdown's Suspend/Close and the auto-suspend timer see them.
    active = sdk;
    registerWorkspaceBackendHooks('claude', {
      suspend: (projectPath) => {
        const current = active as (ClaudeBackend & { suspendWorkspace?: (path: string) => void }) | null;
        current?.suspendWorkspace?.(projectPath);
      },
      isBusy: (projectPath) => {
        const current = active as (ClaudeBackend & { isWorkspaceBusy?: (path: string) => boolean }) | null;
        return current?.isWorkspaceBusy?.(projectPath) ?? false;
      },
    });
  } else {
    active = new CliBackend();
  }
  return active;
}

/** Test-only seam to inject a stub or reset the cached backend. */
export function __setClaudeBackendForTests(b: ClaudeBackend | null): void { active = b; }
