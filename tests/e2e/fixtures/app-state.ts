import type { Page } from '@playwright/test';

export interface AppStateFixture {
  setWorkspaceBusy(id: string): Promise<void>;
  setWorkspaceDone(id: string): Promise<void>;
  setWorkspaceIdle(id: string): Promise<void>;
  clearWorkspaces(): Promise<void>;
  getOverallStatus(): Promise<'done' | 'busy' | 'busy-done' | null>;
  getState(): Promise<{ busyWorkspaces: string[]; completedWorkspaces: string[] }>;
}

async function bridgeCall(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  await page.waitForFunction(() => typeof (window as any).__saiTest !== 'undefined', { timeout: 5000 });
  return page.evaluate(
    ([m, a]) => (window as any).__saiTest[m as string](...(a as unknown[])),
    [method, args] as const,
  );
}

export function createAppState(page: Page): AppStateFixture {
  return {
    setWorkspaceBusy:   (id) => bridgeCall(page, 'setWorkspaceBusy', id)   as Promise<void>,
    setWorkspaceDone:   (id) => bridgeCall(page, 'setWorkspaceDone', id)   as Promise<void>,
    setWorkspaceIdle:   (id) => bridgeCall(page, 'setWorkspaceIdle', id)   as Promise<void>,
    clearWorkspaces:    ()   => bridgeCall(page, 'clearWorkspaces')         as Promise<void>,
    getOverallStatus:   ()   => bridgeCall(page, 'getOverallStatus')        as Promise<'done' | 'busy' | 'busy-done' | null>,
    getState:           ()   => bridgeCall(page, 'getState')                as Promise<{ busyWorkspaces: string[]; completedWorkspaces: string[] }>,
  };
}
