/**
 * mcpControl.ts — MCP control surface over a scope's live SDK Query.
 *
 * Typed SDK methods: mcpServerStatus, reconnectMcpServer, toggleMcpServer.
 * Untyped-but-present (sdk.mjs; request types in SDKControlRequestInner):
 * mcpAuthenticate, mcpClearAuth, mcpSubmitOAuthCallbackUrl — feature-detected,
 * so a future SDK that drops them degrades to "sign in from a terminal".
 *
 * OAuth: mcp_authenticate returns an authUrl and the CLI runs its own localhost
 * callback listener, then reconnects the server in the same session. The CLI
 * does not open a browser — we do — and there is no completion event, so we
 * poll mcpServerStatus() until connected / failed / timeout.
 *
 * `pending` is a transient init-frame status the SDK never re-reports, so
 * watchPending() polls the existing query until it settles. Config edits apply
 * by resume-respawn (applyConfig → markMcpStale), never setMcpServers — that
 * replaces ALL dynamic servers, including SAI's in-process ones.
 */
import type { McpActionResult, McpAuthResult, McpCapabilities, McpLiveSnapshot } from '../../../src/types';
import { getMcpRuntimeStatus, normalizeScope, replaceMcpRuntimeStatus, setMcpAuthState } from './mcpRuntimeStatus';

export interface McpControlQuery {
  mcpServerStatus?: () => Promise<unknown[]>;
  reconnectMcpServer?: (name: string) => Promise<unknown>;
  toggleMcpServer?: (name: string, enabled: boolean) => Promise<unknown>;
  mcpAuthenticate?: (name: string, redirectUri?: string) => Promise<unknown>;
  mcpClearAuth?: (name: string) => Promise<unknown>;
  mcpSubmitOAuthCallbackUrl?: (name: string, callbackUrl: string) => Promise<unknown>;
}

export interface McpControlDeps {
  getQuery: (projectPath: string, scope: string | undefined, create: boolean) => McpControlQuery | null;
  openExternal: (url: string) => void;
  push: (snapshot: McpLiveSnapshot) => void;
  /** Flag every live session's MCP config stale (SdkBackend.markMcpStale).
   *  `restart: false` keeps the scope's idle session alive (sign-in running). */
  markMcpStale?: (projectPath: string, scope: string | undefined, opts: { restart: boolean }) => void;
  pollMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

export type McpControl = ReturnType<typeof createMcpControl>;

const NO_SESSION = 'Live status unavailable — no Claude session';
const NO_AUTH = 'This Claude runtime does not support in-app sign-in';
/** How long watchPending() waits for `pending` servers to settle. */
const PENDING_WATCH_MS = 30_000;
const fn = <K extends keyof McpControlQuery>(q: McpControlQuery | null, k: K): q is McpControlQuery & Required<Pick<McpControlQuery, K>> =>
  typeof q?.[k] === 'function';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Unknown error';
/** Control responses may arrive raw or wrapped in `{ response }`. */
const unwrap = (r: any) => (r && typeof r === 'object' && r.response && typeof r.response === 'object' ? r.response : r);
const anyPending = (servers: McpLiveSnapshot['servers']) => Object.values(servers).some((s) => s.status === 'pending');

export function capabilitiesOf(q: McpControlQuery | null): McpCapabilities {
  return {
    status: fn(q, 'mcpServerStatus'),
    reconnect: fn(q, 'reconnectMcpServer'),
    toggle: fn(q, 'toggleMcpServer'),
    authenticate: fn(q, 'mcpAuthenticate'),
    clearAuth: fn(q, 'mcpClearAuth'),
    submitCallbackUrl: fn(q, 'mcpSubmitOAuthCallbackUrl'),
  };
}

export function createMcpControl(deps: McpControlDeps) {
  const pollMs = deps.pollMs ?? 2000;
  const timeoutMs = deps.timeoutMs ?? 300_000;
  const now = deps.now ?? Date.now;
  const pollers = new Map<string, ReturnType<typeof setInterval>>();
  const pendingWatchers = new Map<string, ReturnType<typeof setInterval>>();
  const pollKey = (p: string, s: string | undefined, n: string) => `${p} ${normalizeScope(s)} ${n}`;
  const scopeKey = (p: string, s: string | undefined) => `${p} ${normalizeScope(s)}`;

  const snapshotOf = (projectPath: string, scope: string | undefined, q: McpControlQuery | null): McpLiveSnapshot => ({
    ...getMcpRuntimeStatus(projectPath, scope),
    available: q !== null,
    capabilities: capabilitiesOf(q),
  });

  async function refresh(projectPath: string, scope: string | undefined, create: boolean): Promise<McpLiveSnapshot> {
    const q = deps.getQuery(projectPath, scope, create);
    if (fn(q, 'mcpServerStatus')) {
      try { replaceMcpRuntimeStatus(projectPath, scope, await q.mcpServerStatus()); } catch { /* query died — keep last known */ }
    }
    const snap = snapshotOf(projectPath, scope, q);
    deps.push(snap);
    return snap;
  }

  async function run(
    projectPath: string, scope: string | undefined, method: keyof McpControlQuery, call: (q: McpControlQuery) => Promise<unknown>,
  ): Promise<McpActionResult> {
    const q = deps.getQuery(projectPath, scope, true);
    if (!q) return { ok: false, error: NO_SESSION };
    if (!fn(q, method)) return { ok: false, error: `This Claude runtime does not support ${method}` };
    try {
      await call(q);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    } finally {
      await refresh(projectPath, scope, false);
    }
  }

  function stopPoll(projectPath: string, scope: string | undefined, name: string) {
    const k = pollKey(projectPath, scope, name);
    const t = pollers.get(k);
    if (t) { clearInterval(t); pollers.delete(k); }
  }

  function startPoll(projectPath: string, scope: string | undefined, name: string) {
    stopPoll(projectPath, scope, name);
    const startedAt = now();
    const k = pollKey(projectPath, scope, name);
    let inFlight = false;
    const finish = () => {
      stopPoll(projectPath, scope, name);
      deps.push(snapshotOf(projectPath, scope, deps.getQuery(projectPath, scope, false)));
    };
    const handle = setInterval(async () => {
      if (pollers.get(k) !== handle) return;
      // Checked before awaiting: a status call that never answers must not
      // hold the sign-in in `waiting` past the cap.
      if (now() - startedAt > timeoutMs) {
        const prev = getMcpRuntimeStatus(projectPath, scope).auth[name];
        setMcpAuthState(projectPath, scope, name, { phase: 'timeout', authUrl: prev?.authUrl });
        finish();
        return;
      }
      if (inFlight) return; // previous tick's status call still pending — never stack them
      inFlight = true;
      let snap: McpLiveSnapshot;
      try { snap = await refresh(projectPath, scope, false); } finally { inFlight = false; }
      // Cancelled or replaced (a second authenticate()) while status was in
      // flight — this tick's window is stale and must not end the new poller.
      if (pollers.get(k) !== handle) return;
      const s = snap.servers[name];
      if (s?.status === 'connected') { setMcpAuthState(projectPath, scope, name, null); finish(); }
      else if (s?.status === 'failed') { setMcpAuthState(projectPath, scope, name, { phase: 'error', error: s.error ?? 'Sign-in failed' }); finish(); }
    }, pollMs);
    pollers.set(k, handle);
  }

  /** Poll the scope's EXISTING query (never creates one) while any server is
   *  `pending`; push each change; stop when none pending, the query is gone,
   *  or after PENDING_WATCH_MS. One watcher per scope. */
  function watchPending(projectPath: string, scope?: string): void {
    const k = scopeKey(projectPath, scope);
    if (pendingWatchers.has(k)) return;
    if (!anyPending(getMcpRuntimeStatus(projectPath, scope).servers)) return;
    const startedAt = now();
    let inFlight = false;
    const stop = () => { clearInterval(handle); if (pendingWatchers.get(k) === handle) pendingWatchers.delete(k); };
    const handle = setInterval(async () => {
      if (pendingWatchers.get(k) !== handle) return;
      if (now() - startedAt > PENDING_WATCH_MS) { stop(); return; } // before awaiting — a hung status can't extend the cap
      if (inFlight) return;
      const q = deps.getQuery(projectPath, scope, false);
      if (!fn(q, 'mcpServerStatus')) { stop(); return; }
      const before = JSON.stringify(getMcpRuntimeStatus(projectPath, scope).servers);
      inFlight = true;
      try { replaceMcpRuntimeStatus(projectPath, scope, await q.mcpServerStatus()); } catch { /* query died — keep last known */ } finally { inFlight = false; }
      if (pendingWatchers.get(k) !== handle) return; // disposed while awaiting
      const snap = snapshotOf(projectPath, scope, q);
      if (JSON.stringify(snap.servers) !== before) deps.push(snap);
      if (!anyPending(snap.servers)) stop();
    }, pollMs);
    pendingWatchers.set(k, handle);
  }

  return {
    peek(projectPath: string, scope?: string): McpLiveSnapshot {
      return snapshotOf(projectPath, scope, deps.getQuery(projectPath, scope, false));
    },

    status(projectPath: string, scope?: string) { return refresh(projectPath, scope, true); },

    watchPending,

    /** A server config was added/edited/removed/enabled: every session picks
     *  it up by resume-respawn (the panel's own scope right away when idle,
     *  others on their next idle send), then the panel scope is re-read. A
     *  sign-in in progress pins the panel scope: the CLI's OAuth callback
     *  listener lives in that session, so it is left stale, not restarted. */
    async applyConfig(projectPath: string, scope?: string): Promise<McpLiveSnapshot> {
      const prefix = `${scopeKey(projectPath, scope)} `;
      const signingIn = [...pollers.keys()].some((k) => k.startsWith(prefix));
      deps.markMcpStale?.(projectPath, scope, { restart: !signingIn });
      const snap = await refresh(projectPath, scope, true);
      watchPending(projectPath, scope);
      return snap;
    },

    reconnect(projectPath: string, scope: string | undefined, name: string) {
      return run(projectPath, scope, 'reconnectMcpServer', (q) => q.reconnectMcpServer!(name));
    },

    toggle(projectPath: string, scope: string | undefined, name: string, enabled: boolean) {
      return run(projectPath, scope, 'toggleMcpServer', (q) => q.toggleMcpServer!(name, enabled));
    },

    signOut(projectPath: string, scope: string | undefined, name: string) {
      return run(projectPath, scope, 'mcpClearAuth', (q) => q.mcpClearAuth!(name));
    },

    async submitCallbackUrl(projectPath: string, scope: string | undefined, name: string, url: string): Promise<McpActionResult> {
      let parsed: URL;
      try { parsed = new URL(url.trim()); } catch { return { ok: false, error: 'Not a valid URL' }; }
      if (!parsed.searchParams.has('code') && !parsed.searchParams.has('error')) {
        return { ok: false, error: 'That URL has no "code" or "error" parameter — copy the full address from the browser after approving' };
      }
      return run(projectPath, scope, 'mcpSubmitOAuthCallbackUrl', (q) => q.mcpSubmitOAuthCallbackUrl!(name, parsed.toString()));
    },

    async authenticate(projectPath: string, scope: string | undefined, name: string): Promise<McpAuthResult> {
      const q = deps.getQuery(projectPath, scope, true);
      if (!q) return { ok: false, error: NO_SESSION };
      if (!fn(q, 'mcpAuthenticate')) return { ok: false, error: NO_AUTH };
      let res: any;
      try {
        res = unwrap(await q.mcpAuthenticate(name));
      } catch (e) {
        const error = errMsg(e);
        setMcpAuthState(projectPath, scope, name, { phase: 'error', error });
        await refresh(projectPath, scope, false);
        return { ok: false, error };
      }
      if (!res?.requiresUserAction) {
        setMcpAuthState(projectPath, scope, name, null);
        if (fn(q, 'reconnectMcpServer')) { try { await q.reconnectMcpServer(name); } catch { /* status shows it */ } }
        await refresh(projectPath, scope, false);
        return { ok: true, state: 'already-authorized' };
      }
      if (typeof res.authUrl !== 'string' || !res.authUrl) {
        const error = 'Sign-in did not return a login URL';
        setMcpAuthState(projectPath, scope, name, { phase: 'error', error });
        await refresh(projectPath, scope, false);
        return { ok: false, error };
      }
      setMcpAuthState(projectPath, scope, name, { phase: 'waiting', authUrl: res.authUrl });
      deps.openExternal(res.authUrl);
      startPoll(projectPath, scope, name);
      await refresh(projectPath, scope, false);
      return { ok: true, state: 'awaiting-browser', authUrl: res.authUrl };
    },

    cancelAuth(projectPath: string, scope: string | undefined, name: string): void {
      stopPoll(projectPath, scope, name);
      setMcpAuthState(projectPath, scope, name, null);
      deps.push(snapshotOf(projectPath, scope, deps.getQuery(projectPath, scope, false)));
    },

    dispose(): void {
      for (const t of pollers.values()) clearInterval(t);
      pollers.clear();
      for (const t of pendingWatchers.values()) clearInterval(t);
      pendingWatchers.clear();
    },
  };
}
