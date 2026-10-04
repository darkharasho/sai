import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  McpActionResult, McpAuthResult, McpCapabilities, McpLiveSnapshot, McpRuntimePush, McpSource,
} from '../../types';

export const EMPTY_CAPS: McpCapabilities = {
  status: false, reconnect: false, toggle: false, authenticate: false, clearAuth: false, submitCallbackUrl: false,
};

const NO_API: McpActionResult = { ok: false, error: 'MCP controls unavailable' };

/** Live MCP state for one chat scope. `spawn` lets the call start/warm a
 *  session (MCP panel); the chat nudge passes false so mounting a chat never
 *  spins up a Claude process. `enabled: false` makes the hook inert: no IPC,
 *  no listeners. */
export function useMcpLive(
  projectPath: string | undefined,
  scope: string | undefined,
  opts: { spawn: boolean; enabled?: boolean },
) {
  const [snapshot, setSnapshot] = useState<McpLiveSnapshot | null>(null);
  const wantScope = scope ?? 'chat';
  const enabled = opts.enabled ?? true;
  const api = window.sai as any;

  // Bumped on key change/unmount (and `pushed` flips on a push), so a slower fetch can neither
  // install another scope's state nor clobber newer pushed servers/auth.
  const epoch = useRef(0);
  const pushed = useRef(false);
  /** Last snapshot, readable from the push listener without a state updater. */
  const latest = useRef<McpLiveSnapshot | null>(null);
  latest.current = snapshot;

  /** `factsOnly`: keep the current servers/auth and take only available +
   *  capabilities from the fetch (a push already carried newer servers). */
  const refresh = useCallback(async (factsOnly = false) => {
    if (!enabled || !projectPath) return;
    const fetcher = opts.spawn ? api.mcpStatus : api.mcpRuntimeStatus;
    if (typeof fetcher !== 'function') return;
    const startEpoch = epoch.current;
    const startPushed = pushed.current;
    try {
      const s = await fetcher(projectPath, scope);
      if (!s || typeof s !== 'object') return;
      if (epoch.current !== startEpoch) return;
      if (s.projectPath !== projectPath || s.scope !== wantScope) return;
      if (factsOnly || pushed.current !== startPushed) {
        // A push landed while we waited: keep its servers/auth, take the facts only a full snapshot carries.
        setSnapshot((prev) => (prev ? { ...prev, available: s.available, capabilities: s.capabilities } : prev));
      } else {
        setSnapshot(s);
      }
    } catch { /* leave last known */ }
  }, [enabled, projectPath, scope, wantScope, opts.spawn]);

  useEffect(() => {
    epoch.current++;
    pushed.current = false;
    setSnapshot(null);
    if (!enabled) return;
    void refresh();
    // A push is either per-scope (servers + auth) or a full snapshot. A
    // per-scope push keeps capabilities/available from the last full one —
    // unless that said "no session": then the push is the first sign of one
    // (an init frame), so re-fetch the facts only a full snapshot carries.
    const off = api.onMcpRuntimeStatus?.((p: McpRuntimePush | McpLiveSnapshot) => {
      if (!p || p.projectPath !== projectPath || p.scope !== wantScope) return;
      const full = 'capabilities' in p && !!p.capabilities;
      const sessionAppeared = !full && !latest.current?.available; // null too: the first fetch may predate the session
      pushed.current = true;
      setSnapshot((prev) => ({
        available: prev?.available ?? false,
        capabilities: prev?.capabilities ?? EMPTY_CAPS,
        ...p,
      }));
      if (sessionAppeared) void refresh(true);
    });
    return () => { epoch.current++; off?.(); };
  }, [enabled, projectPath, wantScope, refresh]);

  const call = <T,>(method: string, ...args: unknown[]): Promise<T> =>
    enabled && typeof api[method] === 'function' && projectPath
      ? api[method](projectPath, scope, ...args)
      : Promise.resolve(NO_API as T);

  return {
    snapshot,
    refresh: () => refresh(),
    reconnect: (name: string) => call<McpActionResult>('mcpReconnect', name),
    /** Persists by config `name`; live-toggles by `controlName` (the SDK's name).
     *  Without `spawn` (config-only) main only persists and flags sessions. */
    toggle: (name: string, on: boolean, source: McpSource, controlName: string = name) =>
      call<McpActionResult>('mcpToggle', name, on, source, controlName, opts.spawn),
    authenticate: (name: string) => call<McpAuthResult>('mcpAuthenticate', name),
    cancelAuth: (name: string) => call<void>('mcpAuthCancel', name),
    submitCallbackUrl: (name: string, url: string) => call<McpActionResult>('mcpSubmitCallbackUrl', name, url),
    signOut: (name: string) => call<McpActionResult>('mcpSignOut', name),
  };
}
