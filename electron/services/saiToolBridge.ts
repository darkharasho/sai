/**
 * Single source of truth for executing a SAI chat tool against the renderer.
 *
 * The real dispatch (the renderer IPC round-trip) is defined in electron/main.ts
 * where the BrowserWindow / pending-call map live. It is registered here so the
 * SDK backend (electron/services/claudeBackend/), which must not import main.ts,
 * can reach the exact same round-trip used by the socket MCP server in CLI mode.
 */
export interface SaiToolRequest {
  tool: string;
  input: unknown;
  workspace: string;
}

export type SaiToolDispatch = (req: SaiToolRequest) => Promise<unknown>;

let dispatch: SaiToolDispatch | null = null;

export function setSaiToolDispatch(fn: SaiToolDispatch | null): void {
  dispatch = fn;
}

export function getSaiToolDispatch(): SaiToolDispatch | null {
  return dispatch;
}
