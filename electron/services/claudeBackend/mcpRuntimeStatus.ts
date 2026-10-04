/**
 * mcpRuntimeStatus.ts — per-scope record of live MCP server state for the MCP
 * sidebar and the chat sign-in nudge. Seeded by the SDK's `system/init` frame
 * (names + status only, merged) and replaced wholesale by `mcpServerStatus()`
 * control calls (full entries). Also holds in-flight OAuth sign-in state.
 * SDK backend only — the CLI path never reports connection state.
 */
import type { McpAuthState, McpLiveServer, McpLiveStatus, McpRuntimePush } from '../../../src/types';

const KNOWN: ReadonlySet<string> = new Set(['connected', 'failed', 'needs-auth', 'pending', 'disabled']);
const servers = new Map<string, Map<string, McpLiveServer>>();
const auth = new Map<string, Map<string, McpAuthState>>();
let initFrameListener: ((projectPath: string, scope: string) => void) | null = null;

export const normalizeScope = (scope?: string): string => scope ?? 'chat';
const keyOf = (projectPath: string, scope?: string) => `${projectPath} ${normalizeScope(scope)}`;
const normalizeStatus = (s: unknown): McpLiveStatus =>
  typeof s === 'string' && KNOWN.has(s) ? (s as McpLiveStatus) : 'unknown';

function bucket<T>(map: Map<string, Map<string, T>>, key: string): Map<string, T> {
  let b = map.get(key);
  if (!b) { b = new Map(); map.set(key, b); }
  return b;
}

function toLive(raw: any): McpLiveServer | null {
  if (!raw || typeof raw.name !== 'string' || !raw.name) return null;
  const out: McpLiveServer = { name: raw.name, status: normalizeStatus(raw.status) };
  if (typeof raw.error === 'string' && raw.error) out.error = raw.error;
  if (typeof raw.scope === 'string') out.scope = raw.scope;
  if (raw.serverInfo && typeof raw.serverInfo.name === 'string') {
    out.serverInfo = { name: raw.serverInfo.name, version: String(raw.serverInfo.version ?? '') };
  }
  if (Array.isArray(raw.tools)) {
    out.tools = raw.tools
      .filter((t: any) => t && typeof t.name === 'string')
      .map((t: any) => (typeof t.description === 'string' ? { name: t.name, description: t.description } : { name: t.name }));
  }
  if (raw.config && typeof raw.config === 'object') {
    // Only type + url ever leave main — headers/env may hold secrets.
    const c: { type?: string; url?: string } = {};
    if (typeof raw.config.type === 'string') c.type = raw.config.type;
    if (typeof raw.config.url === 'string') c.url = raw.config.url;
    out.config = c;
  }
  return out;
}

/** Init-frame report: names + statuses only. Merges into the scope's entries;
 *  a server whose status changed loses its stale tools/serverInfo/error. */
export function recordMcpRuntimeStatus(
  projectPath: string,
  scope: string | undefined,
  reported: Array<{ name?: string; status?: string } | null>,
  _plugins?: Array<{ name?: string; path?: string }>,
): void {
  const b = bucket(servers, keyOf(projectPath, scope));
  for (const s of reported) {
    if (!s || typeof s.name !== 'string' || !s.name) continue;
    const status = normalizeStatus(s.status);
    const prev = b.get(s.name);
    b.set(s.name, prev && prev.status === status ? { ...prev } : { name: s.name, status });
  }
}

/** Authoritative full report from `mcpServerStatus()`. */
export function replaceMcpRuntimeStatus(projectPath: string, scope: string | undefined, reported: unknown[]): void {
  const b = new Map<string, McpLiveServer>();
  for (const raw of reported) {
    const live = toLive(raw);
    if (live) b.set(live.name, live);
  }
  servers.set(keyOf(projectPath, scope), b);
}

export function setMcpAuthState(projectPath: string, scope: string | undefined, name: string, state: McpAuthState | null): void {
  const b = bucket(auth, keyOf(projectPath, scope));
  if (state) b.set(name, state); else b.delete(name);
}

/** A browser sign-in is in flight for the scope: the CLI's OAuth callback
 *  listener lives in that session, so it must not be torn down. */
export function isMcpSignInWaiting(projectPath: string, scope?: string): boolean {
  for (const s of auth.get(keyOf(projectPath, scope))?.values() ?? []) if (s.phase === 'waiting') return true;
  return false;
}

/** mcp.ts registers this so each init-frame report starts the control's
 *  pending watch — the SDK backend never imports mcpControl. */
export function setMcpInitFrameListener(cb: ((projectPath: string, scope: string) => void) | null): void {
  initFrameListener = cb;
}

/** Called by the SDK backend after recording an init-frame report. */
export function notifyMcpInitFrame(projectPath: string, scope?: string): void {
  try { initFrameListener?.(projectPath, normalizeScope(scope)); } catch { /* listener bugs never break the drain */ }
}

export function getMcpRuntimeStatus(projectPath: string, scope?: string): McpRuntimePush {
  const key = keyOf(projectPath, scope);
  return {
    projectPath,
    scope: normalizeScope(scope),
    servers: Object.fromEntries(servers.get(key) ?? []),
    auth: Object.fromEntries(auth.get(key) ?? []),
  };
}

export function __resetMcpRuntimeStatusForTests(): void {
  servers.clear();
  auth.clear();
}
