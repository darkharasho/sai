# MCP Panel Redesign + In-App OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the MCP sidebar into a working control surface — live status, grouped list, needs-attention section, working reconnect/toggle/edit/remove, in-app OAuth sign-in — plus a chat nudge for servers needing sign-in.

**Architecture:** All live operations go through the SDK `Query` of the panel's scope (the active chat), warming a session when none exists. A main-process adapter (`mcpControl.ts`) wraps the typed (`mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`) and untyped (`mcpAuthenticate`, `mcpClearAuth`, `mcpSubmitOAuthCallbackUrl`) SDK control methods, keeps per-scope status + auth state in `mcpRuntimeStatus.ts`, and pushes snapshots to the renderer. The renderer derives a grouped view-model (`mcpView.ts`) from config listing + live status and renders it in a rebuilt sidebar, detail view, edit form and chat nudge.

**Tech Stack:** Electron (main + preload IPC), React 18 + TypeScript, `@anthropic-ai/claude-agent-sdk` 0.3.196, vitest + @testing-library/react, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-10-04-mcp-panel-redesign-design.md`

## Global Constraints

- Run vitest with at most 2 workers (repo `vitest.config.ts` already sets `maxWorkers: 2`; never override upward). Unit tests: `npx vitest run --project unit <path>`.
- Typecheck with `npx tsc --noEmit` before every commit that touches `.ts/.tsx`.
- Work on branch `mcp-panel-redesign` (already created). Never `git checkout <sha>`; use `git show` to inspect old code.
- Codex provider MCP branch in `McpSidebar` stays behaviourally unchanged and must never call Claude MCP APIs.
- Plugin and claude.ai servers are never edited or removed. Remove/Edit only for `source: 'user' | 'project'`.
- Sign in is never offered for `stdio` servers.
- Auth poll: every 2000 ms, give up after 300 000 ms (5 min).
- Secrets: env and header values are always masked in the detail view; never log tokens or header values.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Name mismatch between config and live status** (plugin servers listed as `plugin:<short>:<name>`, live status may report the bare `<name>`) — a reasonable user expects every row to show its real status, not a blank dot. Pinned in Task 6 (`liveFor` bare-name fallback test).
2. **Opening the panel on a resumed chat after an app restart** (scope has a `pendingResume` id, no live session) — the user expects the conversation to still resume on next send. Pinned in Task 4 (`getLiveQuery` keeps resume id, `warm=false`).
3. **Clicking Sign in twice / from both panel and nudge** — one browser tab per click is fine, but only one poller must run and the state must not flip to timeout from a stale timer. Pinned in Task 4 (second `authenticate` replaces the first poller).
4. **Missing or malformed `~/.claude.json` / project `.mcp.json`** — the list should still render other sources rather than error out. Pinned in Task 2.
5. **No live session possible** (CLI backend opt-out, SDK spawn failure) — the panel should still list config with a "Live status unavailable" note and disable live-only actions. Pinned in Task 4 (`available:false`) and Task 7 (sidebar note).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/types.ts` | modify | Shared MCP types (config + live + auth + capabilities) |
| `electron/services/mcpConfig.ts` | create | Pure-ish config read/write for user + project + plugin servers (fs, explicit paths) |
| `electron/services/mcp.ts` | modify | IPC handlers only; delegate to `mcpConfig` + `mcpControl` |
| `electron/services/claudeBackend/mcpRuntimeStatus.ts` | rewrite | Per-scope live status + auth state store |
| `electron/services/claudeBackend/mcpControl.ts` | create | Adapter over a scope's live Query; auth flow + poller; snapshots |
| `electron/services/claudeBackend/sdkBackend.ts` | modify | `getLiveQuery()`; init-frame push uses per-scope store |
| `electron/services/claudeBackend/types.ts` | modify | Optional `getLiveQuery` on `ClaudeBackend` |
| `electron/services/claudeBackend/externalMcp.ts` | modify | Keep `plugin:<short>:<name>` keys |
| `electron/preload.ts` | modify | New MCP IPC methods |
| `src/components/MCP/mcpView.ts` | create | View-model: merge config + live, rows, groups, attention count |
| `src/components/MCP/useMcpLive.ts` | create | Hook: fetch/subscribe snapshot + action wrappers |
| `src/components/MCP/McpServerList.tsx` | create | Grouped list + needs-attention box |
| `src/components/MCP/McpSidebar.tsx` | modify | Wire list/detail/form views to hook |
| `src/components/MCP/McpDetail.tsx` | rewrite | Live header pill, actions, auth card, tools, config |
| `src/components/MCP/McpAuthCard.tsx` | create | Browser sign-in waiting card |
| `src/components/MCP/McpServerForm.tsx` | create (replaces `McpAddServer.tsx`) | Add/edit form with headers + target source |
| `src/components/Chat/McpAuthNudge.tsx` | create | Chat strip for needs-auth servers |
| `src/components/Chat/ChatPanel.tsx` | modify | Mount nudge above `ChatInput` |
| `src/App.tsx` | modify | Pass `onOpenMcpPanel` to `ChatPanel` |

---

### Task 0: Spike — verify SDK auth controls (throwaway, gate)

**Files:**
- Create (do NOT commit): `scripts/spikes/mcp-auth-spike.mjs`

This answers four questions before any product code. If (1) or (2) fails, STOP and report to the user — the approach must be revisited.

1. Does `query.mcpAuthenticate(name)` work for a server supplied via SDK `options.plugins` (cloudflare plugin) and via `options.mcpServers`?
2. After completing browser sign-in, does the same live query report the server `connected` via `mcpServerStatus()` (no new session)?
3. Exact return shape of `mcpAuthenticate` (raw `{authUrl, requiresUserAction, ...}` or wrapped in `{response: ...}`), and what `name` the init frame / `mcpServerStatus()` reports for plugin servers (`plugin:cloudflare:cloudflare-api` vs `cloudflare-api`).
4. Are `mcpServers` keys containing colons (`plugin:x:y`) accepted? And what `~/.claude.json` key does the CLI use to persist disabled project `.mcp.json` servers (`grep -ao 'disabledMcpjsonServers' node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude | head -1`)?

- [ ] **Step 1: Write the spike script**

```js
// scripts/spikes/mcp-auth-spike.mjs — run: node scripts/spikes/mcp-auth-spike.mjs <serverName>
import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const target = process.argv[2] ?? 'plugin:cloudflare:cloudflare-api';
const installed = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude/plugins/installed_plugins.json'), 'utf8'));
const plugins = Object.values(installed.plugins).flat().map((p) => ({ type: 'local', path: p.installPath }));

let release;
const input = (async function* () { await new Promise((r) => { release = r; }); })();
const q = query({
  prompt: input,
  options: {
    plugins,
    mcpServers: { 'colon:test:server': { type: 'http', url: 'https://mcp.cloudflare.com/mcp' } },
    pathToClaudeCodeExecutable: path.resolve('node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude'),
  },
});
(async () => { for await (const m of q) if (m.type === 'system' && m.subtype === 'init') console.log('INIT mcp_servers', m.mcp_servers); })();

const status = async () => (await q.mcpServerStatus()).map((s) => `${s.name}=${s.status}${s.scope ? `(${s.scope})` : ''}`);
console.log('STATUS before', await status());
const res = await q.mcpAuthenticate(target);
console.log('AUTH result', JSON.stringify(res, null, 2));
const url = res?.authUrl ?? res?.response?.authUrl;
if (url) console.log('\nOPEN THIS URL AND APPROVE:\n' + url + '\n');
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await status();
  console.log('STATUS', s.filter((x) => x.includes(target.split(':').pop())).join(' '));
  if (s.some((x) => x.endsWith('=connected') && x.includes(target.split(':').pop()))) break;
}
release?.(); q.close();
```

- [ ] **Step 2: Run it against cloudflare-api and record answers**

Run: `node scripts/spikes/mcp-auth-spike.mjs plugin:cloudflare:cloudflare-api` (retry with `cloudflare-api` if "Server not found"), open the printed URL, approve.
Expected: an `AUTH result` with an `authUrl`, then a `STATUS ... =connected` line within a minute of approving. Also note the `colon:test:server` entry appears in status (any status other than an error about its name means colons are accepted).

- [ ] **Step 3: Write findings into the plan**

Append a `## Spike findings` section at the bottom of this plan file with: the exact result shape, the reported plugin server name format, colon-key result, and the CLI's project-disable key. Later tasks reference these:
- Task 3 is skipped if colon keys are rejected (keep `<short>-<name>`; Task 6's `liveFor` keeps that fallback).
- Task 4 `unwrap()` handles both shapes regardless.
- Task 2 uses the CLI's project-disable key in place of `disabledMcpjsonServers` if it differs.

- [ ] **Step 4: Commit only the findings**

```bash
git add docs/superpowers/plans/2026-10-04-mcp-panel-redesign.md
git commit -m "docs: record MCP auth spike findings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Shared types + per-scope runtime status store

**Files:**
- Modify: `src/types.ts:320-345`
- Rewrite: `electron/services/claudeBackend/mcpRuntimeStatus.ts`
- Modify: `electron/services/claudeBackend/sdkBackend.ts:1427-1436` (init push)
- Test: `tests/unit/electron/mcpRuntimeStatus.test.ts` (rewrite)

**Interfaces:**
- Produces (types in `src/types.ts`): `McpSource`, `McpServer` (+`headers`, wider `source`), `McpServerConfig` (+`headers`, `source`), `McpLiveStatus`, `McpLiveServer`, `McpAuthState`, `McpCapabilities`, `McpRuntimePush`, `McpLiveSnapshot`, `McpActionResult`, `McpAuthResult`.
- Produces (store): `recordMcpRuntimeStatus(projectPath, scope, servers, plugins?)`, `replaceMcpRuntimeStatus(projectPath, scope, servers: unknown[])`, `setMcpAuthState(projectPath, scope, name, state | null)`, `getMcpRuntimeStatus(projectPath, scope): McpRuntimePush`, `normalizeScope(scope?)`, `__resetMcpRuntimeStatusForTests()`.

- [ ] **Step 1: Replace the MCP types in `src/types.ts`**

Replace the existing `McpServer` and `McpServerConfig` interfaces (lines ~320-339) with:

```ts
export type McpSource = 'user' | 'project' | 'plugin' | 'claudeai';

export interface McpServer {
  name: string;
  description?: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  source?: McpSource;
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** Which file to write. Defaults to 'user' (~/.claude.json). */
  source?: 'user' | 'project';
}

export type McpLiveStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | 'unknown';

export interface McpLiveServer {
  name: string;
  status: McpLiveStatus;
  error?: string;
  /** SDK config scope: user | project | local | claudeai | managed | dynamic … */
  scope?: string;
  serverInfo?: { name: string; version: string };
  tools?: Array<{ name: string; description?: string }>;
  config?: { type?: string; url?: string };
}

export interface McpAuthState {
  phase: 'waiting' | 'timeout' | 'error';
  authUrl?: string;
  error?: string;
}

export interface McpCapabilities {
  status: boolean;
  reconnect: boolean;
  toggle: boolean;
  authenticate: boolean;
  clearAuth: boolean;
  submitCallbackUrl: boolean;
}

/** Pushed on `mcp:runtime-status` and returned by `mcp:runtimeStatus`. */
export interface McpRuntimePush {
  projectPath: string;
  scope: string;
  servers: Record<string, McpLiveServer>;
  auth: Record<string, McpAuthState>;
}

/** Full snapshot returned by `mcp:status` (adds live-session facts). */
export interface McpLiveSnapshot extends McpRuntimePush {
  /** False when no live session could be obtained (CLI backend, spawn failure). */
  available: boolean;
  capabilities: McpCapabilities;
}

export type McpActionResult = { ok: true } | { ok: false; error: string };
export type McpAuthResult =
  | { ok: true; state: 'already-authorized' }
  | { ok: true; state: 'awaiting-browser'; authUrl: string }
  | { ok: false; error: string };
```

- [ ] **Step 2: Write the failing store test**

Replace `tests/unit/electron/mcpRuntimeStatus.test.ts` with:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordMcpRuntimeStatus,
  replaceMcpRuntimeStatus,
  setMcpAuthState,
  getMcpRuntimeStatus,
  __resetMcpRuntimeStatusForTests,
} from '@electron/services/claudeBackend/mcpRuntimeStatus';

describe('mcpRuntimeStatus (per scope)', () => {
  beforeEach(() => __resetMcpRuntimeStatusForTests());

  it('keeps scopes separate', () => {
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'github', status: 'failed' }]);
    recordMcpRuntimeStatus('/p', 'b', [{ name: 'github', status: 'connected' }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.github.status).toBe('failed');
    expect(getMcpRuntimeStatus('/p', 'b').servers.github.status).toBe('connected');
  });

  it('undefined scope is "chat"', () => {
    recordMcpRuntimeStatus('/p', undefined, [{ name: 'x', status: 'connected' }]);
    expect(getMcpRuntimeStatus('/p', 'chat')).toMatchObject({ projectPath: '/p', scope: 'chat' });
    expect(getMcpRuntimeStatus('/p', 'chat').servers.x.status).toBe('connected');
  });

  it('record() merges: same status keeps tools/serverInfo, changed status drops them', () => {
    replaceMcpRuntimeStatus('/p', 'a', [
      { name: 'gh', status: 'connected', tools: [{ name: 't1' }], serverInfo: { name: 'GH', version: '1' } },
    ]);
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'gh', status: 'connected' }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.gh.tools).toEqual([{ name: 't1' }]);
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'gh', status: 'failed' }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.gh.tools).toBeUndefined();
  });

  it('replace() is authoritative and normalizes unknown statuses', () => {
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'old', status: 'connected' }]);
    replaceMcpRuntimeStatus('/p', 'a', [{ name: 'new', status: 'weird' }, null, { status: 'connected' }]);
    const { servers } = getMcpRuntimeStatus('/p', 'a');
    expect(Object.keys(servers)).toEqual(['new']);
    expect(servers.new.status).toBe('unknown');
  });

  it('replace() keeps error, scope, config and strips tool fields to name/description', () => {
    replaceMcpRuntimeStatus('/p', 'a', [{
      name: 'cf', status: 'failed', error: 'boom', scope: 'claudeai',
      config: { type: 'http', url: 'https://x', headers: { a: 'secret' } },
      tools: [{ name: 't', description: 'd', annotations: { readOnly: true } }],
    }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.cf).toEqual({
      name: 'cf', status: 'failed', error: 'boom', scope: 'claudeai',
      config: { type: 'http', url: 'https://x' },
      tools: [{ name: 't', description: 'd' }],
    });
  });

  it('auth state set/clear per scope', () => {
    setMcpAuthState('/p', 'a', 'cf', { phase: 'waiting', authUrl: 'https://auth' });
    expect(getMcpRuntimeStatus('/p', 'a').auth.cf).toEqual({ phase: 'waiting', authUrl: 'https://auth' });
    expect(getMcpRuntimeStatus('/p', 'b').auth).toEqual({});
    setMcpAuthState('/p', 'a', 'cf', null);
    expect(getMcpRuntimeStatus('/p', 'a').auth).toEqual({});
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/electron/mcpRuntimeStatus.test.ts`
Expected: FAIL — `replaceMcpRuntimeStatus` / `setMcpAuthState` not exported.

- [ ] **Step 4: Rewrite `mcpRuntimeStatus.ts`**

```ts
/**
 * mcpRuntimeStatus.ts — per-scope record of live MCP server state for the MCP
 * sidebar and the chat sign-in nudge. Seeded by the SDK's `system/init` frame
 * (names + status only, merged) and replaced wholesale by `mcpServerStatus()`
 * control calls (full entries). Also holds in-flight OAuth sign-in state.
 * SDK backend only — the CLI path never reports connection state.
 */
import type { McpAuthState, McpLiveServer, McpLiveStatus, McpRuntimePush } from '../../../src/types';

export interface McpRuntimePlugin { name: string; path: string }

const KNOWN: ReadonlySet<string> = new Set(['connected', 'failed', 'needs-auth', 'pending', 'disabled']);
const servers = new Map<string, Map<string, McpLiveServer>>();
const auth = new Map<string, Map<string, McpAuthState>>();
let loadedPlugins: McpRuntimePlugin[] = [];

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
  plugins?: Array<{ name?: string; path?: string }>,
): void {
  const b = bucket(servers, keyOf(projectPath, scope));
  for (const s of reported) {
    if (!s || typeof s.name !== 'string' || !s.name) continue;
    const status = normalizeStatus(s.status);
    const prev = b.get(s.name);
    b.set(s.name, prev && prev.status === status ? { ...prev } : { name: s.name, status });
  }
  if (Array.isArray(plugins)) {
    loadedPlugins = plugins
      .filter((p): p is { name: string; path: string } => typeof p?.name === 'string' && typeof p?.path === 'string')
      .map((p) => ({ name: p.name, path: p.path }));
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

export function getMcpRuntimeStatus(projectPath: string, scope?: string): McpRuntimePush {
  const key = keyOf(projectPath, scope);
  return {
    projectPath,
    scope: normalizeScope(scope),
    servers: Object.fromEntries(servers.get(key) ?? []),
    auth: Object.fromEntries(auth.get(key) ?? []),
  };
}

export function getLoadedPlugins(): McpRuntimePlugin[] { return loadedPlugins; }

export function __resetMcpRuntimeStatusForTests(): void {
  servers.clear();
  auth.clear();
  loadedPlugins = [];
}
```

- [ ] **Step 5: Update the init-frame push in `sdkBackend.ts`** (around line 1427)

Replace the existing block with:

```ts
          // Live MCP/plugin status for the sidebar + chat nudge (SDK-only
          // capability — the CLI never reports per-server connection state).
          if (m?.type === 'system' && m?.subtype === 'init' && Array.isArray(m?.mcp_servers)) {
            recordMcpRuntimeStatus(
              projectPath,
              effectiveScope,
              m.mcp_servers as Array<{ name?: string; status?: string }>,
              Array.isArray(m?.plugins) ? (m.plugins as Array<{ name?: string; path?: string }>) : undefined,
            );
            getMainWin()?.webContents.send('mcp:runtime-status', getMcpRuntimeStatus(projectPath, effectiveScope));
          }
```

Confirm `effectiveScope` is in scope at that point (it is the `scope ?? 'chat'` of the iterating session — search upward in the same function; if the variable there is named differently, use that name). Then grep for any other `getMcpRuntimeStatus(` / `recordMcpRuntimeStatus(` callers: `grep -rn "McpRuntimeStatus(" electron src tests` — `electron/services/mcp.ts` is updated in Task 5; leave it compiling by changing its call to `getMcpRuntimeStatus(projectPath ?? '', scope)` with handler signature `async (_e, projectPath?: string, scope?: string)` for now.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run --project unit tests/unit/electron/mcpRuntimeStatus.test.ts tests/unit/electron/sdkBackend.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (`McpSidebar`/`McpDetail` may now fail typecheck where they read `source` — if so widen the comparisons; they are rewritten in Tasks 7-8.)

- [ ] **Step 7: Commit**

```bash
git add src/types.ts electron/services/claudeBackend/mcpRuntimeStatus.ts electron/services/claudeBackend/sdkBackend.ts electron/services/mcp.ts tests/unit/electron/mcpRuntimeStatus.test.ts
git commit -m "refactor(mcp): per-scope live status store with full entries + auth state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Config module — project servers, headers, edit/upsert

**Files:**
- Create: `electron/services/mcpConfig.ts`
- Modify: `electron/services/mcp.ts` (list/add/remove/update handlers delegate)
- Test: `tests/unit/electron/mcpConfig.test.ts`

**Interfaces:**
- Consumes: `McpServer`, `McpServerConfig` from `src/types.ts` (Task 1).
- Produces:
  - `interface McpPaths { home: string; projectPath?: string }`
  - `listMcpServers(paths: McpPaths): McpServer[]`
  - `upsertMcpServer(paths: McpPaths, config: McpServerConfig): void` (creates or merges; preserves unknown keys)
  - `removeMcpServer(paths: McpPaths, name: string, source: 'user' | 'project'): void`
  - `setMcpServerDisabled(paths: McpPaths, name: string, source: McpSource, disabled: boolean): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/mcpConfig.test.ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  listMcpServers, upsertMcpServer, removeMcpServer, setMcpServerDisabled,
} from '@electron/services/mcpConfig';

let home: string;
let proj: string;
const write = (p: string, data: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data)); };
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpcfg-home-'));
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpcfg-proj-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
});

describe('mcpConfig', () => {
  it('lists user, project and plugin servers with sources', () => {
    write(path.join(home, '.claude.json'), { mcpServers: { gh: { type: 'http', url: 'https://gh', headers: { Authorization: 'x' } } } });
    write(path.join(proj, '.mcp.json'), { mcpServers: { e2e: { command: 'node', args: ['s.js'] } } });
    const pluginDir = path.join(home, 'plug');
    write(path.join(pluginDir, '.mcp.json'), { cf: { type: 'http', url: 'https://cf' } });
    write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), { plugins: { 'cloudflare@mk': [{ installPath: pluginDir }] } });

    const list = listMcpServers({ home, projectPath: proj });
    expect(list.map((s) => [s.name, s.source, s.transport])).toEqual([
      ['gh', 'user', 'streamable-http'],
      ['e2e', 'project', 'stdio'],
      ['plugin:cloudflare:cf', 'plugin', 'streamable-http'],
    ]);
    expect(list[0].headers).toEqual({ Authorization: 'x' });
  });

  it('survives missing and malformed files', () => {
    fs.writeFileSync(path.join(home, '.claude.json'), '{not json');
    expect(listMcpServers({ home, projectPath: proj })).toEqual([]);
    expect(listMcpServers({ home })).toEqual([]);
  });

  it('upsert creates in the chosen file and merges on edit, keeping unknown keys', () => {
    write(path.join(home, '.claude.json'), { other: 1, mcpServers: { gh: { type: 'http', url: 'https://old', timeout: 5 } } });
    upsertMcpServer({ home }, { name: 'gh', transport: 'streamable-http', url: 'https://new', headers: { A: 'b' } });
    expect(read(path.join(home, '.claude.json'))).toEqual({
      other: 1,
      mcpServers: { gh: { type: 'http', url: 'https://new', timeout: 5, headers: { A: 'b' } } },
    });

    upsertMcpServer({ home, projectPath: proj }, { name: 'e2e', transport: 'stdio', command: 'node', args: ['a'], source: 'project' });
    expect(read(path.join(proj, '.mcp.json'))).toEqual({ mcpServers: { e2e: { command: 'node', args: ['a'] } } });
  });

  it('upsert switching http→stdio drops url/type/headers', () => {
    write(path.join(home, '.claude.json'), { mcpServers: { s: { type: 'http', url: 'https://x', headers: { A: 'b' } } } });
    upsertMcpServer({ home }, { name: 's', transport: 'stdio', command: 'run' });
    expect(read(path.join(home, '.claude.json')).mcpServers.s).toEqual({ command: 'run' });
  });

  it('remove deletes from the chosen file only', () => {
    write(path.join(home, '.claude.json'), { mcpServers: { a: { command: 'x' } } });
    write(path.join(proj, '.mcp.json'), { mcpServers: { a: { command: 'y' } } });
    removeMcpServer({ home, projectPath: proj }, 'a', 'project');
    expect(read(path.join(proj, '.mcp.json')).mcpServers).toEqual({});
    expect(read(path.join(home, '.claude.json')).mcpServers.a).toBeDefined();
  });

  it('disable: user/plugin → home disabledMcpServers; project → project disabledMcpjsonServers', () => {
    setMcpServerDisabled({ home, projectPath: proj }, 'gh', 'user', true);
    setMcpServerDisabled({ home, projectPath: proj }, 'e2e', 'project', true);
    const cfg = read(path.join(home, '.claude.json'));
    expect(cfg.projects[home].disabledMcpServers).toEqual(['gh']);
    expect(cfg.projects[proj].disabledMcpjsonServers).toEqual(['e2e']);
    setMcpServerDisabled({ home, projectPath: proj }, 'gh', 'user', false);
    expect(read(path.join(home, '.claude.json')).projects[home].disabledMcpServers).toEqual([]);
  });

  it('listing reflects disables', () => {
    write(path.join(proj, '.mcp.json'), { mcpServers: { e2e: { command: 'node' } } });
    setMcpServerDisabled({ home, projectPath: proj }, 'e2e', 'project', true);
    expect(listMcpServers({ home, projectPath: proj })[0].enabled).toBe(false);
  });
});
```

If the Task 0 spike found a different CLI key than `disabledMcpjsonServers`, use that key in this test and the implementation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/electron/mcpConfig.test.ts`
Expected: FAIL — cannot resolve `@electron/services/mcpConfig`.

- [ ] **Step 3: Implement `mcpConfig.ts`**

Move `readJson`, `detectTransport`, `listPluginServers`, the config interfaces and disable logic out of `mcp.ts` into this file, parameterized by paths:

```ts
/**
 * mcpConfig.ts — read/write Claude MCP server config files for the MCP sidebar.
 *   user    → ~/.claude.json `mcpServers`
 *   project → <projectPath>/.mcp.json `mcpServers`
 *   plugin  → <installPath>/.mcp.json of enabled plugins (read-only)
 * Disables mirror the CLI: user/plugin names in projects[home].disabledMcpServers,
 * project names in projects[projectPath].disabledMcpjsonServers.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { McpServer, McpServerConfig, McpSource } from '../../src/types';

export interface McpPaths { home: string; projectPath?: string }

interface McpConfigEntry {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
  [k: string]: unknown;
}
interface ProjectEntry { disabledMcpServers?: string[]; disabledMcpjsonServers?: string[]; [k: string]: unknown }
interface ClaudeConfig { mcpServers?: Record<string, McpConfigEntry>; projects?: Record<string, ProjectEntry>; [k: string]: unknown }

const PROJECT_DISABLE_KEY = 'disabledMcpjsonServers';
const claudeJson = (p: McpPaths) => path.join(p.home, '.claude.json');
const projectJson = (p: McpPaths) => {
  if (!p.projectPath) throw new Error('No project open');
  return path.join(p.projectPath, '.mcp.json');
};

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed as T;
    }
  } catch { /* missing or malformed → fallback */ }
  return fallback;
}
const writeJson = (file: string, data: unknown) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');

/** `.mcp.json` may be `{ mcpServers: {...} }` or a bare server map. */
function serverMap(data: Record<string, unknown>): Record<string, McpConfigEntry> {
  const raw = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : data;
  const out: Record<string, McpConfigEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v as McpConfigEntry;
  }
  return out;
}

export function detectTransport(entry: McpConfigEntry): McpServer['transport'] {
  if (entry.type === 'sse') return 'sse';
  if (entry.type === 'http' || entry.type === 'streamable-http') return 'streamable-http';
  if (entry.url) return entry.url.includes('/sse') ? 'sse' : 'streamable-http';
  return 'stdio';
}

function disabledSet(cfg: ClaudeConfig, scopeDir: string | undefined, key: 'disabledMcpServers' | typeof PROJECT_DISABLE_KEY): Set<string> {
  const list = scopeDir ? cfg.projects?.[scopeDir]?.[key] : undefined;
  return new Set(Array.isArray(list) ? list : []);
}

function toServer(name: string, entry: McpConfigEntry, source: McpSource, enabled: boolean): McpServer {
  return {
    name,
    transport: detectTransport(entry),
    command: entry.command,
    args: entry.args,
    url: entry.url,
    env: entry.env,
    headers: entry.headers,
    enabled,
    source,
  };
}

function listPluginServers(home: string): Array<{ pluginShort: string; serverName: string; entry: McpConfigEntry }> {
  const installed = readJson<{ plugins?: Record<string, Array<{ installPath: string }>> }>(
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {});
  const settings = readJson<{ enabledPlugins?: Record<string, boolean> }>(path.join(home, '.claude', 'settings.json'), {});
  const enabled = settings.enabledPlugins ?? {};
  const out: Array<{ pluginShort: string; serverName: string; entry: McpConfigEntry }> = [];
  for (const [pluginKey, entries] of Object.entries(installed.plugins ?? {})) {
    if (enabled[pluginKey] === false) continue;
    const pluginShort = pluginKey.split('@')[0];
    for (const inst of entries ?? []) {
      if (!inst?.installPath) continue;
      const servers = serverMap(readJson<Record<string, unknown>>(path.join(inst.installPath, '.mcp.json'), {}));
      for (const [serverName, entry] of Object.entries(servers)) out.push({ pluginShort, serverName, entry });
    }
  }
  return out;
}

export function listMcpServers(paths: McpPaths): McpServer[] {
  const cfg = readJson<ClaudeConfig>(claudeJson(paths), {});
  const homeDisabled = disabledSet(cfg, paths.home, 'disabledMcpServers');
  const items: McpServer[] = [];
  for (const [name, entry] of Object.entries(serverMap({ mcpServers: cfg.mcpServers ?? {} }))) {
    items.push(toServer(name, entry, 'user', !homeDisabled.has(name) && !entry.disabled));
  }
  if (paths.projectPath) {
    const projDisabled = disabledSet(cfg, paths.projectPath, PROJECT_DISABLE_KEY);
    const proj = serverMap(readJson<Record<string, unknown>>(projectJson(paths), {}));
    for (const [name, entry] of Object.entries(proj)) {
      items.push(toServer(name, entry, 'project', !projDisabled.has(name) && !entry.disabled));
    }
  }
  for (const ps of listPluginServers(paths.home)) {
    const full = `plugin:${ps.pluginShort}:${ps.serverName}`;
    items.push(toServer(full, ps.entry, 'plugin', !homeDisabled.has(full)));
  }
  return items;
}

const TRANSPORT_KEYS = ['type', 'url', 'headers', 'command', 'args', 'env'] as const;

export function upsertMcpServer(paths: McpPaths, config: McpServerConfig): void {
  const source = config.source ?? 'user';
  const file = source === 'project' ? projectJson(paths) : claudeJson(paths);
  const data = readJson<ClaudeConfig>(file, {});
  if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
  const entry: McpConfigEntry = { ...(data.mcpServers[config.name] ?? {}) };
  for (const k of TRANSPORT_KEYS) delete entry[k];
  if (config.transport === 'stdio') {
    entry.command = config.command;
    if (config.args?.length) entry.args = config.args;
  } else {
    entry.type = config.transport === 'sse' ? 'sse' : 'http';
    entry.url = config.url;
    if (config.headers && Object.keys(config.headers).length) entry.headers = config.headers;
  }
  if (config.env && Object.keys(config.env).length) entry.env = config.env;
  data.mcpServers[config.name] = entry;
  writeJson(file, data);
}

export function removeMcpServer(paths: McpPaths, name: string, source: 'user' | 'project'): void {
  const file = source === 'project' ? projectJson(paths) : claudeJson(paths);
  const data = readJson<ClaudeConfig>(file, {});
  if (data.mcpServers?.[name]) {
    delete data.mcpServers[name];
    writeJson(file, data);
  }
}

export function setMcpServerDisabled(paths: McpPaths, name: string, source: McpSource, disabled: boolean): void {
  if (source === 'claudeai') throw new Error('claude.ai connectors are managed on claude.ai');
  const cfg = readJson<ClaudeConfig>(claudeJson(paths), {});
  const scopeDir = source === 'project' ? paths.projectPath : paths.home;
  if (!scopeDir) throw new Error('No project open');
  const key = source === 'project' ? PROJECT_DISABLE_KEY : 'disabledMcpServers';
  cfg.projects ??= {};
  cfg.projects[scopeDir] ??= {};
  const set = disabledSet(cfg, scopeDir, key);
  if (disabled) set.add(name); else set.delete(name);
  cfg.projects[scopeDir][key] = Array.from(set);
  writeJson(claudeJson(paths), cfg);
}
```

- [ ] **Step 4: Make `mcp.ts` handlers delegate**

In `electron/services/mcp.ts`: delete the moved helpers/interfaces (keep `readClaudeConfig` only if `mcp:registryList` still needs it — it does, for `installed`; replace that with `new Set(listMcpServers({ home: os.homedir() }).map((s) => s.name))`). Replace the four handlers:

```ts
import { listMcpServers, upsertMcpServer, removeMcpServer, setMcpServerDisabled } from './mcpConfig';
import type { McpServerConfig, McpSource } from '../../src/types';

const pathsFor = (projectPath?: string) => ({ home: os.homedir(), projectPath: projectPath || undefined });
const fail = (err: any, fallback: string) => ({ error: err?.message || fallback });

  ipcMain.handle('mcp:list', async (_e, projectPath?: string) => {
    try { return listMcpServers(pathsFor(projectPath)); } catch (err) { return fail(err, 'Failed to read MCP config'); }
  });

  ipcMain.handle('mcp:add', async (_e, config: McpServerConfig, projectPath?: string) => {
    try { upsertMcpServer(pathsFor(projectPath), config); return { success: true }; }
    catch (err) { return fail(err, 'Failed to save MCP server'); }
  });

  ipcMain.handle('mcp:remove', async (_e, name: string, source: 'user' | 'project' = 'user', projectPath?: string) => {
    if (name.startsWith('plugin:')) return { error: 'Plugin-provided MCP servers must be removed via the plugin itself' };
    try { removeMcpServer(pathsFor(projectPath), name, source); return { success: true }; }
    catch (err) { return fail(err, 'Failed to remove MCP server'); }
  });

  ipcMain.handle('mcp:update', async (_e, name: string, updates: { disabled?: boolean; source?: McpSource }, projectPath?: string) => {
    try {
      if (typeof updates?.disabled !== 'boolean') return { error: 'Only { disabled } updates are supported; use mcp:add to edit' };
      const source = updates.source ?? (name.startsWith('plugin:') ? 'plugin' : 'user');
      setMcpServerDisabled(pathsFor(projectPath), name, source, updates.disabled);
      return { success: true };
    } catch (err) { return fail(err, 'Failed to update MCP server'); }
  });
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run --project unit tests/unit/electron/mcpConfig.test.ts tests/unit/services/mcp.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/mcpConfig.ts electron/services/mcp.ts tests/unit/electron/mcpConfig.test.ts
git commit -m "feat(mcp): config module with project servers, headers and upsert edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Keep plugin server keys stable for shared OAuth tokens

Skip this task if the Task 0 spike found colon keys rejected in `mcpServers`.

**Files:**
- Modify: `electron/services/claudeBackend/externalMcp.ts:88-134`
- Test: `tests/unit/electron/externalMcp.test.ts`

**Interfaces:**
- Produces: `collectPluginSdkConfigs(...).servers` keys are now `plugin:<pluginShort>:<serverName>`.

- [ ] **Step 1: Update the existing key assertion to the new format (failing)**

Run `grep -n "\-\${\|'[a-z]*-[a-z]*'" tests/unit/electron/externalMcp.test.ts` to find the assertion(s) on `<short>-<name>` keys in the partial-disable test, and change the expected key(s) to `plugin:<short>:<name>`, e.g.:

```ts
    expect(Object.keys(result.servers)).toEqual(['plugin:myplug:alpha']);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/unit/electron/externalMcp.test.ts`
Expected: FAIL — received `myplug-alpha`.

- [ ] **Step 3: Change the key + doc comment**

In `collectPluginSdkConfigs`, change `servers[\`${pluginShort}-${name}\`]` to `servers[\`plugin:${pluginShort}:${name}\`]`, and update the JSDoc line "keyed `<pluginShort>-<serverName>`" to:

```
 * keyed `plugin:<pluginShort>:<serverName>` — the CLI's own name for plugin
 * servers, so OAuth tokens (keyed by server name) are shared with the CLI.
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run --project unit tests/unit/electron/externalMcp.test.ts && npx tsc --noEmit` → PASS.

```bash
git add electron/services/claudeBackend/externalMcp.ts tests/unit/electron/externalMcp.test.ts
git commit -m "fix(mcp): keep plugin:<short>:<name> keys so OAuth tokens match the CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Live control adapter + `getLiveQuery`

**Files:**
- Create: `electron/services/claudeBackend/mcpControl.ts`
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (add `getLiveQuery` after `_warmForCommands`, ~line 437)
- Modify: `electron/services/claudeBackend/types.ts:51-76`
- Test: `tests/unit/electron/mcpControl.test.ts`, `tests/unit/electron/sdkBackend.test.ts` (add cases)

**Interfaces:**
- Consumes: store functions from Task 1; `McpLiveSnapshot`, `McpCapabilities`, `McpActionResult`, `McpAuthResult` types.
- Produces:
  - `ClaudeBackend.getLiveQuery?(projectPath: string, scope: string | undefined, opts: { create: boolean }): unknown | null`
  - `createMcpControl(deps: McpControlDeps): McpControl` where
    ```ts
    interface McpControlDeps {
      getQuery: (projectPath: string, scope: string | undefined, create: boolean) => McpControlQuery | null;
      openExternal: (url: string) => void;
      push: (snapshot: McpLiveSnapshot) => void;
      pollMs?: number;      // default 2000
      timeoutMs?: number;   // default 300_000
      now?: () => number;   // default Date.now
    }
    interface McpControl {
      peek(projectPath: string, scope?: string): McpLiveSnapshot;              // never creates a session
      status(projectPath: string, scope?: string): Promise<McpLiveSnapshot>;    // creates/warms, refreshes
      reconnect(projectPath: string, scope: string | undefined, name: string): Promise<McpActionResult>;
      toggle(projectPath: string, scope: string | undefined, name: string, enabled: boolean): Promise<McpActionResult>;
      authenticate(projectPath: string, scope: string | undefined, name: string): Promise<McpAuthResult>;
      cancelAuth(projectPath: string, scope: string | undefined, name: string): void;
      submitCallbackUrl(projectPath: string, scope: string | undefined, name: string, url: string): Promise<McpActionResult>;
      signOut(projectPath: string, scope: string | undefined, name: string): Promise<McpActionResult>;
      dispose(): void;
    }
    ```

- [ ] **Step 1: Write the failing control test**

```ts
// tests/unit/electron/mcpControl.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMcpControl, type McpControlQuery } from '@electron/services/claudeBackend/mcpControl';
import { __resetMcpRuntimeStatusForTests, getMcpRuntimeStatus } from '@electron/services/claudeBackend/mcpRuntimeStatus';

function fakeQuery(over: Partial<McpControlQuery> = {}) {
  let list: any[] = [{ name: 'cf', status: 'needs-auth', config: { type: 'http', url: 'https://cf' } }];
  const q: McpControlQuery & { setList(l: any[]): void } = {
    mcpServerStatus: vi.fn(async () => list),
    reconnectMcpServer: vi.fn(async () => {}),
    toggleMcpServer: vi.fn(async () => {}),
    mcpAuthenticate: vi.fn(async () => ({ authUrl: 'https://auth/x', requiresUserAction: true, callbackExpected: true })),
    mcpClearAuth: vi.fn(async () => {}),
    mcpSubmitOAuthCallbackUrl: vi.fn(async () => {}),
    setList(l) { list = l; },
    ...over,
  };
  return q;
}

describe('mcpControl', () => {
  let now = 0;
  beforeEach(() => { __resetMcpRuntimeStatusForTests(); vi.useFakeTimers(); now = 0; });
  afterEach(() => vi.useRealTimers());

  const make = (q: McpControlQuery | null) => {
    const push = vi.fn();
    const openExternal = vi.fn();
    const getQuery = vi.fn(() => q);
    const ctl = createMcpControl({ getQuery, push, openExternal, pollMs: 2000, timeoutMs: 10_000, now: () => now });
    return { ctl, push, openExternal, getQuery };
  };

  it('status(): creates session, stores full entries, reports capabilities', async () => {
    const q = fakeQuery();
    const { ctl, getQuery, push } = make(q);
    const snap = await ctl.status('/p', 's1');
    expect(getQuery).toHaveBeenCalledWith('/p', 's1', true);
    expect(snap.available).toBe(true);
    expect(snap.servers.cf.status).toBe('needs-auth');
    expect(snap.capabilities).toEqual({ status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true });
    expect(push).toHaveBeenCalledWith(snap);
  });

  it('no live session → available:false, actions fail cleanly', async () => {
    const { ctl } = make(null);
    expect((await ctl.status('/p', 's1')).available).toBe(false);
    expect(await ctl.reconnect('/p', 's1', 'cf')).toEqual({ ok: false, error: 'Live status unavailable — no Claude session' });
  });

  it('missing untyped methods → capability false + clear error', async () => {
    const q = fakeQuery({ mcpAuthenticate: undefined });
    const { ctl } = make(q);
    expect((await ctl.status('/p', 's1')).capabilities.authenticate).toBe(false);
    expect(await ctl.authenticate('/p', 's1', 'cf')).toEqual({ ok: false, error: 'This Claude runtime does not support in-app sign-in' });
  });

  it('peek() never creates a session', () => {
    const { ctl, getQuery } = make(fakeQuery());
    ctl.peek('/p', 's1');
    expect(getQuery).toHaveBeenCalledWith('/p', 's1', false);
  });

  it('reconnect(): calls SDK, then refreshes; errors are surfaced', async () => {
    const q = fakeQuery({ reconnectMcpServer: vi.fn(async () => { throw new Error('Server not found: x'); }) });
    const { ctl } = make(q);
    expect(await ctl.reconnect('/p', 's1', 'x')).toEqual({ ok: false, error: 'Server not found: x' });
    expect(q.mcpServerStatus).toHaveBeenCalled();
  });

  it('authenticate(): opens browser, sets waiting, clears on connected', async () => {
    const q = fakeQuery();
    const { ctl, openExternal } = make(q);
    const res = await ctl.authenticate('/p', 's1', 'cf');
    expect(res).toEqual({ ok: true, state: 'awaiting-browser', authUrl: 'https://auth/x' });
    expect(openExternal).toHaveBeenCalledWith('https://auth/x');
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toEqual({ phase: 'waiting', authUrl: 'https://auth/x' });

    q.setList([{ name: 'cf', status: 'connected' }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toBeUndefined();
    expect(getMcpRuntimeStatus('/p', 's1').servers.cf.status).toBe('connected');
  });

  it('authenticate(): unwraps {response:{...}} shape', async () => {
    const q = fakeQuery({ mcpAuthenticate: vi.fn(async () => ({ response: { authUrl: 'https://w', requiresUserAction: true } })) });
    const { ctl } = make(q);
    expect(await ctl.authenticate('/p', 's1', 'cf')).toEqual({ ok: true, state: 'awaiting-browser', authUrl: 'https://w' });
  });

  it('authenticate(): already authorized → reconnect path, no browser', async () => {
    const q = fakeQuery({ mcpAuthenticate: vi.fn(async () => ({ requiresUserAction: false })) });
    const { ctl, openExternal } = make(q);
    expect(await ctl.authenticate('/p', 's1', 'cf')).toEqual({ ok: true, state: 'already-authorized' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('authenticate(): times out', async () => {
    const { ctl } = make(fakeQuery());
    await ctl.authenticate('/p', 's1', 'cf');
    now = 10_001;
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toMatchObject({ phase: 'timeout' });
  });

  it('authenticate(): failed status → error phase', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    q.setList([{ name: 'cf', status: 'failed', error: 'invalid_grant' }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toEqual({ phase: 'error', error: 'invalid_grant' });
  });

  it('second authenticate() replaces the first poller', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    now = 6000;
    await ctl.authenticate('/p', 's1', 'cf'); // restarts the 10s window at t=6000
    now = 12_000;                              // past first window, inside second
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toMatchObject({ phase: 'waiting' });
  });

  it('cancelAuth() stops polling and clears state', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    ctl.cancelAuth('/p', 's1', 'cf');
    (q.mcpServerStatus as any).mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(q.mcpServerStatus).not.toHaveBeenCalled();
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toBeUndefined();
  });

  it('submitCallbackUrl() rejects URLs without code/error', async () => {
    const { ctl } = make(fakeQuery());
    expect(await ctl.submitCallbackUrl('/p', 's1', 'cf', 'http://localhost:1234/cb')).toEqual({
      ok: false, error: 'That URL has no "code" or "error" parameter — copy the full address from the browser after approving',
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/unit/electron/mcpControl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mcpControl.ts`**

```ts
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
  pollMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

export type McpControl = ReturnType<typeof createMcpControl>;

const NO_SESSION = 'Live status unavailable — no Claude session';
const NO_AUTH = 'This Claude runtime does not support in-app sign-in';
const fn = (q: McpControlQuery | null, k: keyof McpControlQuery) => typeof q?.[k] === 'function';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Unknown error';
/** Control responses may arrive raw or wrapped in `{ response }`. */
const unwrap = (r: any) => (r && typeof r === 'object' && r.response && typeof r.response === 'object' ? r.response : r);

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
  const pollKey = (p: string, s: string | undefined, n: string) => `${p} ${normalizeScope(s)} ${n}`;

  const snapshotOf = (projectPath: string, scope: string | undefined, q: McpControlQuery | null): McpLiveSnapshot => ({
    ...getMcpRuntimeStatus(projectPath, scope),
    available: q !== null,
    capabilities: capabilitiesOf(q),
  });

  async function refresh(projectPath: string, scope: string | undefined, create: boolean): Promise<McpLiveSnapshot> {
    const q = deps.getQuery(projectPath, scope, create);
    if (q?.mcpServerStatus) {
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
    pollers.set(k, setInterval(async () => {
      const snap = await refresh(projectPath, scope, false);
      if (pollers.get(k) === undefined) return; // cancelled while awaiting
      const s = snap.servers[name];
      let done = false;
      if (s?.status === 'connected') { setMcpAuthState(projectPath, scope, name, null); done = true; }
      else if (s?.status === 'failed') { setMcpAuthState(projectPath, scope, name, { phase: 'error', error: s.error ?? 'Sign-in failed' }); done = true; }
      else if (now() - startedAt > timeoutMs) {
        const prev = getMcpRuntimeStatus(projectPath, scope).auth[name];
        setMcpAuthState(projectPath, scope, name, { phase: 'timeout', authUrl: prev?.authUrl });
        done = true;
      }
      if (done) { stopPoll(projectPath, scope, name); deps.push(snapshotOf(projectPath, scope, deps.getQuery(projectPath, scope, false))); }
    }, pollMs));
  }

  return {
    peek(projectPath: string, scope?: string): McpLiveSnapshot {
      return snapshotOf(projectPath, scope, deps.getQuery(projectPath, scope, false));
    },

    status(projectPath: string, scope?: string) { return refresh(projectPath, scope, true); },

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
      if (!q.mcpAuthenticate) return { ok: false, error: NO_AUTH };
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
        if (q.reconnectMcpServer) { try { await q.reconnectMcpServer(name); } catch { /* status shows it */ } }
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
    },
  };
}
```

Note on the timeout test: `now` is read from the injected clock, while `setInterval` is driven by fake timers. The "second authenticate replaces the first poller" test passes because `startPoll` calls `stopPoll` first and captures a fresh `startedAt`.

- [ ] **Step 4: Run control tests**

Run: `npx vitest run --project unit tests/unit/electron/mcpControl.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing `getLiveQuery` tests in `sdkBackend.test.ts`**

Add near the existing warm-session tests (search `warm` in the test file and follow the same backend construction pattern with `queryFn: vi.fn(() => makeFakeQuery([], { hang: true }))`):

```ts
  describe('getLiveQuery', () => {
    it('returns the existing session query without creating another', () => {
      const queryFn = vi.fn(() => makeFakeQuery([], { hang: true }));
      const backend = new SdkBackend({ queryFn: queryFn as any, emit: vi.fn(), resolveClaudePath: () => '/claude' });
      backend.send({ projectPath: '/p', message: 'hi', scope: 's1' } as any);
      const q1 = backend.getLiveQuery('/p', 's1', { create: true });
      expect(q1).toBeTruthy();
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('create:false never spawns', () => {
      const queryFn = vi.fn(() => makeFakeQuery([], { hang: true }));
      const backend = new SdkBackend({ queryFn: queryFn as any, emit: vi.fn(), resolveClaudePath: () => '/claude' });
      expect(backend.getLiveQuery('/p', 's1', { create: false })).toBeNull();
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('create:true on a scope with a pending resume consumes it and is NOT warm', () => {
      const queryFn = vi.fn((_args: any) => makeFakeQuery([], { hang: true }));
      const backend = new SdkBackend({ queryFn: queryFn as any, emit: vi.fn(), resolveClaudePath: () => '/claude' });
      backend.setSessionId('/p', 'sess-123', 's1');
      expect(backend.getLiveQuery('/p', 's1', { create: true })).toBeTruthy();
      expect(queryFn.mock.calls[0][0].options.resume).toBe('sess-123');
      expect((backend as any).sessions.get('/p s1').warm).toBe(false);
    });

    it('create:true on a fresh scope warms', () => {
      const backend = new SdkBackend({ queryFn: vi.fn(() => makeFakeQuery([], { hang: true })) as any, emit: vi.fn(), resolveClaudePath: () => '/claude' });
      backend.getLiveQuery('/p', 's2', { create: true });
      expect((backend as any).sessions.get('/p s2').warm).toBe(true);
    });
  });
```

Match the constructor deps to how other tests in this file build `SdkBackend` (copy an existing `new SdkBackend({...})` call and add nothing else). If the resume option key in this file's other resume tests isn't `options.resume`, use the key those tests assert.

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/electron/sdkBackend.test.ts -t getLiveQuery`
Expected: FAIL — `getLiveQuery is not a function`.

- [ ] **Step 7: Implement `getLiveQuery` in `SdkBackend`** (directly after `_warmForCommands`)

```ts
  /** Live Query for the MCP panel's control calls. With `create`, spins up a
   *  session for a scope that has none — resuming a pending conversation if
   *  there is one (then it is a real session, not warm, so the resume id
   *  survives a later config respawn). */
  getLiveQuery(projectPath: string, scope: string | undefined, opts: { create: boolean }): unknown | null {
    const scopeKey = toScopeKey(projectPath, scope);
    const existing = this.sessions.get(scopeKey);
    if (existing) return existing.query;
    if (!opts.create) return null;
    const resuming = this.pendingResume.has(scopeKey);
    try {
      const session = this._createSession(scopeKey, projectPath, scope, {});
      session.warm = !resuming;
      return session.query;
    } catch {
      return null;
    }
  }
```

In `electron/services/claudeBackend/types.ts`, add to `ClaudeBackend` after `refreshSlashCommands`:

```ts
  /** SDK only: the scope's live Query for MCP control calls (status, reconnect,
   *  toggle, OAuth). `create` spins up a session when none exists. */
  getLiveQuery?(projectPath: string, scope: string | undefined, opts: { create: boolean }): unknown | null;
```

- [ ] **Step 8: Run + typecheck + commit**

Run: `npx vitest run --project unit tests/unit/electron/mcpControl.test.ts tests/unit/electron/sdkBackend.test.ts && npx tsc --noEmit` → PASS.

```bash
git add electron/services/claudeBackend/mcpControl.ts electron/services/claudeBackend/sdkBackend.ts electron/services/claudeBackend/types.ts tests/unit/electron/mcpControl.test.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(mcp): live control adapter with in-app OAuth flow + getLiveQuery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: IPC + preload wiring

**Files:**
- Modify: `electron/services/mcp.ts` (register control handlers)
- Modify: `electron/preload.ts:429-447`
- Test: `tests/unit/services/mcp.test.ts`

**Interfaces:**
- Consumes: `createMcpControl` (Task 4), `getClaudeBackend` (`electron/services/claudeBackend/index.ts`), `getMainWin` (`electron/services/claude.ts`).
- Produces (renderer `window.sai`):
  - `mcpList(projectPath?: string): Promise<McpServer[] | { error }>`
  - `mcpAdd(config: McpServerConfig, projectPath?: string)`
  - `mcpRemove(name: string, source?: 'user'|'project', projectPath?: string)`
  - `mcpUpdate(name: string, updates: { disabled: boolean; source?: McpSource }, projectPath?: string)`
  - `mcpRuntimeStatus(projectPath: string, scope?: string): Promise<McpLiveSnapshot>` (peek, no spawn)
  - `mcpStatus(projectPath: string, scope?: string): Promise<McpLiveSnapshot>` (spawns/warms)
  - `mcpReconnect(projectPath, scope, name): Promise<McpActionResult>`
  - `mcpToggle(projectPath, scope, name, enabled, source, ): Promise<McpActionResult>` — live toggle + persist
  - `mcpAuthenticate(projectPath, scope, name): Promise<McpAuthResult>`
  - `mcpAuthCancel(projectPath, scope, name): Promise<void>`
  - `mcpSubmitCallbackUrl(projectPath, scope, name, url): Promise<McpActionResult>`
  - `mcpSignOut(projectPath, scope, name): Promise<McpActionResult>`
  - `onMcpRuntimeStatus(cb: (push: McpRuntimePush | McpLiveSnapshot) => void): () => void` (unchanged channel)

- [ ] **Step 1: Extend the failing handler-registration test**

In `tests/unit/services/mcp.test.ts`, add mocks at the top (after the `node:fs` mock):

```ts
vi.mock('../../../electron/services/claudeBackend/index', () => ({ getClaudeBackend: () => ({}) }));
vi.mock('../../../electron/services/claude', () => ({ getMainWin: () => null }));
```

and extend the `channels` assertions:

```ts
    for (const ch of ['mcp:runtimeStatus', 'mcp:status', 'mcp:reconnect', 'mcp:toggle', 'mcp:authenticate',
      'mcp:authCancel', 'mcp:submitCallbackUrl', 'mcp:signOut']) {
      expect(channels).toContain(ch);
    }
```

Also update the `electron` mock to `{ ipcMain: { handle: vi.fn() }, shell: { openExternal: vi.fn() } }`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/services/mcp.test.ts`
Expected: FAIL — `mcp:status` not registered.

- [ ] **Step 3: Register control handlers in `mcp.ts`**

```ts
import { ipcMain, shell } from 'electron';
import { getClaudeBackend } from './claudeBackend/index';
import { getMainWin } from './claude';
import { createMcpControl, type McpControlQuery } from './claudeBackend/mcpControl';

let control: ReturnType<typeof createMcpControl> | null = null;
function mcpControl() {
  control ??= createMcpControl({
    getQuery: (projectPath, scope, create) =>
      (getClaudeBackend().getLiveQuery?.(projectPath, scope, { create }) as McpControlQuery | null | undefined) ?? null,
    openExternal: (url) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); },
    push: (snap) => getMainWin()?.webContents.send('mcp:runtime-status', snap),
  });
  return control;
}
```

Inside `registerMcpHandlers()`, replace the old `mcp:runtimeStatus` handler and add:

```ts
  ipcMain.handle('mcp:runtimeStatus', async (_e, projectPath: string, scope?: string) => mcpControl().peek(projectPath, scope));
  ipcMain.handle('mcp:status', async (_e, projectPath: string, scope?: string) => mcpControl().status(projectPath, scope));
  ipcMain.handle('mcp:reconnect', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().reconnect(projectPath, scope, name));
  ipcMain.handle('mcp:toggle', async (_e, projectPath: string, scope: string | undefined, name: string, enabled: boolean, source: McpSource) => {
    // Persist first so new sessions agree, then flip the live one.
    try { if (source !== 'claudeai') setMcpServerDisabled(pathsFor(projectPath), name, source, !enabled); }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to save' }; }
    const live = await mcpControl().toggle(projectPath, scope, name, enabled);
    // No live session is fine for a toggle — the file change applies next session.
    return live.ok || live.error.startsWith('Live status unavailable') ? { ok: true } : live;
  });
  ipcMain.handle('mcp:authenticate', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().authenticate(projectPath, scope, name));
  ipcMain.handle('mcp:authCancel', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().cancelAuth(projectPath, scope, name));
  ipcMain.handle('mcp:submitCallbackUrl', async (_e, projectPath: string, scope: string | undefined, name: string, url: string) =>
    mcpControl().submitCallbackUrl(projectPath, scope, name, url));
  ipcMain.handle('mcp:signOut', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().signOut(projectPath, scope, name));
```

If importing `./claudeBackend/index` from `mcp.ts` creates an import cycle at startup (check: `npx tsc --noEmit` passes and `npm run dev` boots), switch to a lazy `require('./claudeBackend/index').getClaudeBackend()` inside `getQuery`.

- [ ] **Step 4: Update preload** (replace the `// MCP` block's Claude entries)

```ts
  // MCP
  mcpList: (projectPath?: string) => ipcRenderer.invoke('mcp:list', projectPath),
  mcpAdd: (config: any, projectPath?: string) => ipcRenderer.invoke('mcp:add', config, projectPath),
  mcpRemove: (name: string, source?: 'user' | 'project', projectPath?: string) => ipcRenderer.invoke('mcp:remove', name, source, projectPath),
  mcpUpdate: (name: string, updates: any, projectPath?: string) => ipcRenderer.invoke('mcp:update', name, updates, projectPath),
  mcpRegistryList: () => ipcRenderer.invoke('mcp:registryList'),
  mcpRuntimeStatus: (projectPath: string, scope?: string) => ipcRenderer.invoke('mcp:runtimeStatus', projectPath, scope),
  mcpStatus: (projectPath: string, scope?: string) => ipcRenderer.invoke('mcp:status', projectPath, scope),
  mcpReconnect: (projectPath: string, scope: string | undefined, name: string) => ipcRenderer.invoke('mcp:reconnect', projectPath, scope, name),
  mcpToggle: (projectPath: string, scope: string | undefined, name: string, enabled: boolean, source: string) =>
    ipcRenderer.invoke('mcp:toggle', projectPath, scope, name, enabled, source),
  mcpAuthenticate: (projectPath: string, scope: string | undefined, name: string) => ipcRenderer.invoke('mcp:authenticate', projectPath, scope, name),
  mcpAuthCancel: (projectPath: string, scope: string | undefined, name: string) => ipcRenderer.invoke('mcp:authCancel', projectPath, scope, name),
  mcpSubmitCallbackUrl: (projectPath: string, scope: string | undefined, name: string, url: string) =>
    ipcRenderer.invoke('mcp:submitCallbackUrl', projectPath, scope, name, url),
  mcpSignOut: (projectPath: string, scope: string | undefined, name: string) => ipcRenderer.invoke('mcp:signOut', projectPath, scope, name),
```

(Keep the Codex entries and `onMcpRuntimeStatus` as they are.)

- [ ] **Step 5: Run + typecheck + commit**

Run: `npx vitest run --project unit tests/unit/services/mcp.test.ts && npx tsc --noEmit` → PASS.

```bash
git add electron/services/mcp.ts electron/preload.ts tests/unit/services/mcp.test.ts
git commit -m "feat(mcp): IPC for live status, reconnect, toggle, sign-in and sign-out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer view-model + live hook

**Files:**
- Create: `src/components/MCP/mcpView.ts`
- Create: `src/components/MCP/useMcpLive.ts`
- Test: `tests/unit/components/MCP/mcpView.test.ts`, `tests/unit/components/MCP/useMcpLive.test.tsx`

**Interfaces:**
- Consumes: Task 1 types; Task 5 `window.sai` methods.
- Produces:
  ```ts
  // mcpView.ts
  export type McpGroupId = 'attention' | 'user' | 'project' | 'plugin' | 'claudeai';
  export type McpDot = 'ok' | 'pending' | 'bad' | 'off' | 'unknown';
  export interface McpRow {
    key: string;              // stable React key: `${source}:${name}`
    name: string;             // config name (or live name for live-only rows)
    controlName: string;      // name to send to SDK control calls
    displayName: string;      // plugin rows: bare server name
    source: McpSource;
    pluginShort?: string;
    server?: McpServer;       // absent for live-only rows
    live?: McpLiveServer;
    auth?: McpAuthState;
    transport: McpServer['transport'] | 'unknown';
    subtitle: string;
    dot: McpDot;
    fix?: 'sign-in' | 'retry';
    enabled: boolean;
    editable: boolean;        // user/project only
    removable: boolean;       // user/project only
  }
  export const HIDDEN_LIVE_NAMES: ReadonlySet<string>;  // 'sai', 'swarm'
  export function liveFor(name: string, live: Record<string, McpLiveServer>): McpLiveServer | undefined;
  export function buildMcpRows(config: McpServer[], live: Record<string, McpLiveServer>, auth: Record<string, McpAuthState>): McpRow[];
  export function groupMcpRows(rows: McpRow[]): Array<{ id: McpGroupId; label: string; hint?: string; rows: McpRow[] }>;
  export function needsAttention(row: McpRow): boolean;
  // useMcpLive.ts
  export const EMPTY_CAPS: McpCapabilities;
  export function useMcpLive(projectPath: string | undefined, scope: string | undefined, opts: { spawn: boolean }): {
    snapshot: McpLiveSnapshot | null;
    refresh(): Promise<void>;
    reconnect(name: string): Promise<McpActionResult>;
    toggle(name: string, enabled: boolean, source: McpSource): Promise<McpActionResult>;
    authenticate(name: string): Promise<McpAuthResult>;
    cancelAuth(name: string): Promise<void>;
    submitCallbackUrl(name: string, url: string): Promise<McpActionResult>;
    signOut(name: string): Promise<McpActionResult>;
  };
  ```

- [ ] **Step 1: Write the failing view-model test**

```ts
// tests/unit/components/MCP/mcpView.test.ts
import { describe, it, expect } from 'vitest';
import { buildMcpRows, groupMcpRows, liveFor, needsAttention } from '../../../../src/components/MCP/mcpView';
import type { McpServer } from '../../../../src/types';

const cfg = (over: Partial<McpServer>): McpServer => ({ name: 'x', transport: 'stdio', enabled: true, source: 'user', ...over });

describe('mcpView', () => {
  it('liveFor matches exact, then bare plugin name, then legacy <short>-<name>', () => {
    const live = { 'cloudflare-api': { name: 'cloudflare-api', status: 'connected' as const }, 'pw-browser': { name: 'pw-browser', status: 'failed' as const } };
    expect(liveFor('plugin:cloudflare:cloudflare-api', live)?.status).toBe('connected');
    expect(liveFor('plugin:pw:browser', live)?.status).toBe('failed');
    expect(liveFor('nope', live)).toBeUndefined();
  });

  it('builds rows with subtitles, dots and fixes', () => {
    const rows = buildMcpRows(
      [
        cfg({ name: 'gh', transport: 'streamable-http', url: 'https://gh' }),
        cfg({ name: 'pg', enabled: false }),
        cfg({ name: 'plugin:cloudflare:cloudflare-api', transport: 'streamable-http', source: 'plugin' }),
        cfg({ name: 'local', transport: 'stdio' }),
        cfg({ name: 'e2e', source: 'project' }),
      ],
      {
        gh: { name: 'gh', status: 'connected', tools: [{ name: 'a' }, { name: 'b' }] },
        'plugin:cloudflare:cloudflare-api': { name: 'plugin:cloudflare:cloudflare-api', status: 'needs-auth' },
        local: { name: 'local', status: 'failed', error: 'spawn ENOENT' },
        e2e: { name: 'e2e', status: 'pending' },
        'claude.ai Gmail': { name: 'claude.ai Gmail', status: 'connected', scope: 'claudeai', tools: [{ name: 't' }] },
        sai: { name: 'sai', status: 'connected' },
      },
      {},
    );
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.gh).toMatchObject({ subtitle: 'http · 2 tools', dot: 'ok', editable: true, removable: true });
    expect(by.pg).toMatchObject({ subtitle: 'stdio · disabled', dot: 'off', enabled: false });
    expect(by['plugin:cloudflare:cloudflare-api']).toMatchObject({
      displayName: 'cloudflare-api', pluginShort: 'cloudflare', subtitle: 'Needs sign-in', dot: 'bad', fix: 'sign-in', editable: false,
    });
    expect(by.local).toMatchObject({ subtitle: 'spawn ENOENT', dot: 'bad', fix: 'retry' });
    expect(by.e2e).toMatchObject({ subtitle: 'stdio · connecting…', dot: 'pending', source: 'project' });
    expect(by['claude.ai Gmail']).toMatchObject({ source: 'claudeai', subtitle: 'connector · 1 tools', editable: false, removable: false });
    expect(by.sai).toBeUndefined();
  });

  it('stdio needs-auth gets no sign-in fix', () => {
    const [row] = buildMcpRows([cfg({ name: 's' })], { s: { name: 's', status: 'needs-auth' } }, {});
    expect(row.fix).toBeUndefined();
  });

  it('auth waiting overrides subtitle', () => {
    const [row] = buildMcpRows(
      [cfg({ name: 'cf', transport: 'streamable-http' })],
      { cf: { name: 'cf', status: 'needs-auth' } },
      { cf: { phase: 'waiting', authUrl: 'https://a' } },
    );
    expect(row).toMatchObject({ subtitle: 'Waiting for browser sign-in…', dot: 'pending' });
  });

  it('groups: attention first, then user/project/plugin/claudeai, empty groups dropped', () => {
    const rows = buildMcpRows(
      [cfg({ name: 'gh' }), cfg({ name: 'cf', transport: 'sse', source: 'plugin' })],
      { gh: { name: 'gh', status: 'connected' }, cf: { name: 'cf', status: 'needs-auth' } },
      {},
    );
    const groups = groupMcpRows(rows);
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.name)])).toEqual([
      ['attention', ['cf']],
      ['user', ['gh']],
    ]);
    expect(needsAttention(rows.find((r) => r.name === 'cf')!)).toBe(true);
  });

  it('disabled servers never need attention even if live says failed', () => {
    const [row] = buildMcpRows([cfg({ name: 'pg', enabled: false })], { pg: { name: 'pg', status: 'failed' } }, {});
    expect(needsAttention(row)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/components/MCP/mcpView.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mcpView.ts`**

```ts
import type { McpAuthState, McpLiveServer, McpServer, McpSource } from '../../types';

export type McpGroupId = 'attention' | 'user' | 'project' | 'plugin' | 'claudeai';
export type McpDot = 'ok' | 'pending' | 'bad' | 'off' | 'unknown';

export interface McpRow {
  key: string;
  name: string;
  controlName: string;
  displayName: string;
  source: McpSource;
  pluginShort?: string;
  server?: McpServer;
  live?: McpLiveServer;
  auth?: McpAuthState;
  transport: McpServer['transport'] | 'unknown';
  subtitle: string;
  dot: McpDot;
  fix?: 'sign-in' | 'retry';
  enabled: boolean;
  editable: boolean;
  removable: boolean;
}

/** SAI's own in-process servers — not user-manageable. */
export const HIDDEN_LIVE_NAMES: ReadonlySet<string> = new Set(['sai', 'swarm']);
const PLUGIN_RE = /^plugin:([^:]+):(.+)$/;

const TRANSPORT_LABEL: Record<string, string> = { stdio: 'stdio', sse: 'sse', 'streamable-http': 'http', unknown: 'remote' };

export function liveFor(name: string, live: Record<string, McpLiveServer>): McpLiveServer | undefined {
  if (live[name]) return live[name];
  const m = PLUGIN_RE.exec(name);
  return m ? live[m[2]] ?? live[`${m[1]}-${m[2]}`] : undefined;
}

function transportOfLive(l: McpLiveServer): McpRow['transport'] {
  const t = l.config?.type;
  if (t === 'stdio') return 'stdio';
  if (t === 'sse') return 'sse';
  if (t === 'http') return 'streamable-http';
  return 'unknown';
}

function sourceOfLive(l: McpLiveServer): McpSource {
  if (l.scope === 'claudeai') return 'claudeai';
  if (l.scope === 'project') return 'project';
  if (PLUGIN_RE.test(l.name)) return 'plugin';
  return 'user';
}

function finish(base: Omit<McpRow, 'subtitle' | 'dot' | 'fix'>): McpRow {
  const { live, auth, enabled, transport, source, pluginShort } = base;
  const prefix = source === 'plugin' && pluginShort ? pluginShort
    : source === 'claudeai' ? 'connector'
    : TRANSPORT_LABEL[transport];
  const tools = live?.tools?.length;
  const remote = transport !== 'stdio';

  if (!enabled || live?.status === 'disabled') return { ...base, subtitle: `${prefix} · disabled`, dot: 'off' };
  if (auth?.phase === 'waiting') return { ...base, subtitle: 'Waiting for browser sign-in…', dot: 'pending' };
  switch (live?.status) {
    case 'connected':
      return { ...base, subtitle: tools !== undefined ? `${prefix} · ${tools} tools` : prefix, dot: 'ok' };
    case 'pending':
      return { ...base, subtitle: `${prefix} · connecting…`, dot: 'pending' };
    case 'needs-auth':
      return { ...base, subtitle: 'Needs sign-in', dot: 'bad', ...(remote ? { fix: 'sign-in' as const } : {}) };
    case 'failed':
      return { ...base, subtitle: live.error || 'Failed to connect', dot: 'bad', fix: 'retry' };
    default:
      return { ...base, subtitle: prefix, dot: 'unknown' };
  }
}

export function buildMcpRows(
  config: McpServer[],
  live: Record<string, McpLiveServer>,
  auth: Record<string, McpAuthState>,
): McpRow[] {
  const rows: McpRow[] = [];
  const claimed = new Set<string>();

  for (const server of config) {
    const source = server.source ?? 'user';
    const l = liveFor(server.name, live);
    if (l) claimed.add(l.name);
    const m = PLUGIN_RE.exec(server.name);
    const controlName = l?.name ?? server.name;
    rows.push(finish({
      key: `${source}:${server.name}`,
      name: server.name,
      controlName,
      displayName: m ? m[2] : server.name,
      source,
      pluginShort: m?.[1],
      server,
      live: l,
      auth: auth[controlName] ?? auth[server.name],
      transport: server.transport,
      enabled: server.enabled,
      editable: source === 'user' || source === 'project',
      removable: source === 'user' || source === 'project',
    }));
  }

  for (const l of Object.values(live)) {
    if (claimed.has(l.name) || HIDDEN_LIVE_NAMES.has(l.name)) continue;
    const source = sourceOfLive(l);
    const m = PLUGIN_RE.exec(l.name);
    rows.push(finish({
      key: `${source}:${l.name}`,
      name: l.name,
      controlName: l.name,
      displayName: m ? m[2] : l.name,
      source,
      pluginShort: m?.[1],
      live: l,
      auth: auth[l.name],
      transport: transportOfLive(l),
      enabled: true,
      editable: false,
      removable: false,
    }));
  }
  return rows;
}

export function needsAttention(row: McpRow): boolean {
  if (!row.enabled) return false;
  return row.live?.status === 'needs-auth' || row.live?.status === 'failed' || row.auth?.phase === 'timeout' || row.auth?.phase === 'error';
}

const GROUPS: Array<{ id: Exclude<McpGroupId, 'attention'>; label: string; hint?: string }> = [
  { id: 'user', label: 'Global', hint: '~/.claude.json' },
  { id: 'project', label: 'Project', hint: '.mcp.json' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'claudeai', label: 'claude.ai', hint: 'read-only' },
];

export function groupMcpRows(rows: McpRow[]): Array<{ id: McpGroupId; label: string; hint?: string; rows: McpRow[] }> {
  const attention = rows.filter(needsAttention);
  const rest = rows.filter((r) => !needsAttention(r));
  const out: Array<{ id: McpGroupId; label: string; hint?: string; rows: McpRow[] }> = [];
  if (attention.length) out.push({ id: 'attention', label: 'Needs attention', rows: attention });
  for (const g of GROUPS) {
    const members = rest.filter((r) => r.source === g.id);
    if (members.length) out.push({ ...g, hint: g.id === 'plugin' ? String(members.length) : g.hint, rows: members });
  }
  return out;
}
```

- [ ] **Step 4: Run view-model tests** → `npx vitest run --project unit tests/unit/components/MCP/mcpView.test.ts` → PASS.

- [ ] **Step 5: Write the failing hook test**

```tsx
// tests/unit/components/MCP/useMcpLive.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMcpLive } from '../../../../src/components/MCP/useMcpLive';

let pushCb: ((p: any) => void) | null = null;
const sai = {
  mcpStatus: vi.fn(),
  mcpRuntimeStatus: vi.fn(),
  mcpReconnect: vi.fn().mockResolvedValue({ ok: true }),
  onMcpRuntimeStatus: vi.fn((cb: any) => { pushCb = cb; return () => { pushCb = null; }; }),
};
Object.defineProperty(window, 'sai', { value: sai, writable: true });

const snap = (over: any = {}) => ({
  projectPath: '/p', scope: 's1', servers: {}, auth: {}, available: true,
  capabilities: { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true },
  ...over,
});

describe('useMcpLive', () => {
  beforeEach(() => { vi.clearAllMocks(); sai.mcpStatus.mockResolvedValue(snap()); sai.mcpRuntimeStatus.mockResolvedValue(snap()); });

  it('spawn:true uses mcpStatus; spawn:false uses mcpRuntimeStatus', async () => {
    renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(sai.mcpStatus).toHaveBeenCalledWith('/p', 's1'));
    renderHook(() => useMcpLive('/p', 's1', { spawn: false }));
    await waitFor(() => expect(sai.mcpRuntimeStatus).toHaveBeenCalledWith('/p', 's1'));
  });

  it('applies pushes for its own scope only, keeping capabilities from the last full snapshot', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => pushCb?.({ projectPath: '/p', scope: 'other', servers: { a: { name: 'a', status: 'connected' } }, auth: {} }));
    expect(result.current.snapshot!.servers).toEqual({});
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: { a: { name: 'a', status: 'connected' } }, auth: {} }));
    expect(result.current.snapshot!.servers.a.status).toBe('connected');
    expect(result.current.snapshot!.capabilities.authenticate).toBe(true);
  });

  it('undefined scope matches "chat" pushes', async () => {
    sai.mcpStatus.mockResolvedValue(snap({ scope: 'chat' }));
    const { result } = renderHook(() => useMcpLive('/p', undefined, { spawn: true }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => pushCb?.({ projectPath: '/p', scope: 'chat', servers: { b: { name: 'b', status: 'pending' } }, auth: {} }));
    expect(result.current.snapshot!.servers.b).toBeDefined();
  });

  it('actions pass projectPath + scope', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await act(() => result.current.reconnect('gh'));
    expect(sai.mcpReconnect).toHaveBeenCalledWith('/p', 's1', 'gh');
  });
});
```

- [ ] **Step 6: Implement `useMcpLive.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import type {
  McpActionResult, McpAuthResult, McpCapabilities, McpLiveSnapshot, McpRuntimePush, McpSource,
} from '../../types';

export const EMPTY_CAPS: McpCapabilities = {
  status: false, reconnect: false, toggle: false, authenticate: false, clearAuth: false, submitCallbackUrl: false,
};

const NO_API: McpActionResult = { ok: false, error: 'MCP controls unavailable' };

/** Live MCP state for one chat scope. `spawn` lets the call start/warm a
 *  session (MCP panel); the chat nudge passes false so mounting a chat never
 *  spins up a Claude process. */
export function useMcpLive(projectPath: string | undefined, scope: string | undefined, opts: { spawn: boolean }) {
  const [snapshot, setSnapshot] = useState<McpLiveSnapshot | null>(null);
  const wantScope = scope ?? 'chat';
  const api = window.sai as any;

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    const fetcher = opts.spawn ? api.mcpStatus : api.mcpRuntimeStatus;
    if (typeof fetcher !== 'function') return;
    try {
      const s = await fetcher(projectPath, scope);
      if (s && typeof s === 'object') setSnapshot(s);
    } catch { /* leave last known */ }
  }, [projectPath, scope, opts.spawn]);

  useEffect(() => {
    setSnapshot(null);
    void refresh();
    const off = api.onMcpRuntimeStatus?.((p: McpRuntimePush | McpLiveSnapshot) => {
      if (!p || p.projectPath !== projectPath || p.scope !== wantScope) return;
      setSnapshot((prev) => ({
        available: prev?.available ?? true,
        capabilities: prev?.capabilities ?? EMPTY_CAPS,
        ...p,
      }));
    });
    return () => off?.();
  }, [projectPath, wantScope, refresh]);

  const call = <T,>(method: string, ...args: unknown[]): Promise<T> =>
    typeof api[method] === 'function' && projectPath
      ? api[method](projectPath, scope, ...args)
      : Promise.resolve(NO_API as T);

  return {
    snapshot,
    refresh,
    reconnect: (name: string) => call<McpActionResult>('mcpReconnect', name),
    toggle: (name: string, enabled: boolean, source: McpSource) => call<McpActionResult>('mcpToggle', name, enabled, source),
    authenticate: (name: string) => call<McpAuthResult>('mcpAuthenticate', name),
    cancelAuth: (name: string) => call<void>('mcpAuthCancel', name),
    submitCallbackUrl: (name: string, url: string) => call<McpActionResult>('mcpSubmitCallbackUrl', name, url),
    signOut: (name: string) => call<McpActionResult>('mcpSignOut', name),
  };
}
```

- [ ] **Step 7: Run + typecheck + commit**

Run: `npx vitest run --project unit tests/unit/components/MCP/mcpView.test.ts tests/unit/components/MCP/useMcpLive.test.tsx && npx tsc --noEmit` → PASS.

```bash
git add src/components/MCP/mcpView.ts src/components/MCP/useMcpLive.ts tests/unit/components/MCP/mcpView.test.ts tests/unit/components/MCP/useMcpLive.test.tsx
git commit -m "feat(mcp): renderer view-model and live-status hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Grouped list + sidebar wiring

**Files:**
- Create: `src/components/MCP/McpServerList.tsx`
- Modify: `src/components/MCP/McpSidebar.tsx` (Claude branch only)
- Test: `tests/unit/components/MCP/McpSidebar.test.tsx` (extend)

**Interfaces:**
- Consumes: `buildMcpRows`, `groupMcpRows`, `McpRow` (Task 6), `useMcpLive` (Task 6).
- Produces: `McpServerList` props:
  ```ts
  interface McpServerListProps {
    groups: ReturnType<typeof groupMcpRows>;
    canSignIn: boolean;            // snapshot.capabilities.authenticate
    busy: Record<string, boolean>; // keyed by row.key
    onOpen(row: McpRow): void;
    onSignIn(row: McpRow): void;
    onRetry(row: McpRow): void;
  }
  ```
  `McpSidebar` new internal state: `selectedKey: string | null`, `view: 'list' | 'detail' | 'add' | 'edit' | 'registry-detail'`, `actionError: string | null`.

- [ ] **Step 1: Add failing sidebar tests**

Extend `mockSai` in `McpSidebar.test.tsx` with:

```ts
  mcpStatus: vi.fn(),
  mcpRuntimeStatus: vi.fn(),
  mcpAuthenticate: vi.fn().mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'https://a' }),
  mcpReconnect: vi.fn().mockResolvedValue({ ok: true }),
  onMcpRuntimeStatus: vi.fn(() => () => {}),
```

with a `liveSnap` helper and `beforeEach` default `mockSai.mcpStatus.mockResolvedValue(liveSnap())`:

```ts
const liveSnap = (servers: Record<string, any> = {}, over: any = {}) => ({
  projectPath: '/p', scope: 's1', servers, auth: {}, available: true,
  capabilities: { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true },
  ...over,
});
```

New tests:

```tsx
  it('shows Needs attention with Sign in and badge count, and groups the rest', async () => {
    mockSai.mcpList.mockResolvedValue([
      { name: 'gh', transport: 'streamable-http', enabled: true, source: 'user' },
      { name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' },
    ]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({
      gh: { name: 'gh', status: 'connected', tools: [{ name: 't' }] },
      cf: { name: 'cf', status: 'needs-auth' },
    }));
    const { findByText, getByText, container } = render(<McpSidebar projectPath="/p" scope="s1" />);
    expect(await findByText('Needs attention')).toBeTruthy();
    expect(getByText('Global')).toBeTruthy();
    expect(container.querySelector('.sidebar-tab .tab-badge')?.textContent).toBe('1');
    fireEvent.click(getByText('Sign in'));
    await waitFor(() => expect(mockSai.mcpAuthenticate).toHaveBeenCalledWith('/p', 's1', 'cf'));
  });

  it('passes projectPath to mcpList', async () => {
    render(<McpSidebar projectPath="/p" scope="s1" />);
    await waitFor(() => expect(mockSai.mcpList).toHaveBeenCalledWith('/p'));
  });

  it('shows live-unavailable note when no session', async () => {
    mockSai.mcpStatus.mockResolvedValue(liveSnap({}, { available: false }));
    const { findByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    expect(await findByText(/Live status unavailable/)).toBeTruthy();
  });

  it('without auth capability shows a terminal hint instead of Sign in', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'cf', transport: 'sse', enabled: true, source: 'user' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ cf: { name: 'cf', status: 'needs-auth' } }, {
      capabilities: { status: true, reconnect: true, toggle: true, authenticate: false, clearAuth: false, submitCallbackUrl: false },
    }));
    const { findByTitle, queryByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    expect(await findByTitle('Run `claude` in a terminal, then /mcp')).toBeTruthy();
    expect(queryByText('Sign in')).toBeNull();
  });
```

Update the existing `'shows add server form when Add button is clicked'` test only if the heading text changes (it stays `Add MCP Server` — see Task 9). The existing Codex tests must pass unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/components/MCP/McpSidebar.test.tsx`
Expected: new tests FAIL; existing pass.

- [ ] **Step 3: Implement `McpServerList.tsx`**

```tsx
import { ChevronRight, Cloud, Server, Puzzle, FolderGit2, Loader2 } from 'lucide-react';
import type { McpRow, groupMcpRows } from './mcpView';

interface McpServerListProps {
  groups: ReturnType<typeof groupMcpRows>;
  canSignIn: boolean;
  busy: Record<string, boolean>;
  onOpen(row: McpRow): void;
  onSignIn(row: McpRow): void;
  onRetry(row: McpRow): void;
}

const ICON = { user: Server, project: FolderGit2, plugin: Puzzle, claudeai: Cloud } as const;

function Row({ row, canSignIn, busy, onOpen, onSignIn, onRetry }: { row: McpRow } & Omit<McpServerListProps, 'groups' | 'busy'> & { busy: boolean }) {
  const Icon = ICON[row.source];
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  let right: React.ReactNode = <span className={`mcp-dot ${row.dot}`} />;
  if (busy) right = <Loader2 size={12} className="mcp-spin" />;
  else if (row.fix === 'sign-in' && canSignIn) right = <button className="mcp-btn pri" onClick={stop(() => onSignIn(row))}>Sign in</button>;
  else if (row.fix === 'sign-in') right = <span className="mcp-hint" title="Run `claude` in a terminal, then /mcp">CLI</span>;
  else if (row.fix === 'retry') right = <button className="mcp-btn" onClick={stop(() => onRetry(row))}>Retry</button>;

  return (
    <div className="mcp-row" onClick={() => onOpen(row)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(row); }}>
      <div className="mcp-ico"><Icon size={13} /></div>
      <div className="mcp-info">
        <div className="mcp-nm">{row.displayName}</div>
        <div className={`mcp-ds ${row.live?.status === 'failed' ? 'err' : ''}`} title={row.subtitle}>{row.subtitle}</div>
      </div>
      {right}
      <ChevronRight size={12} className="mcp-chev" />
    </div>
  );
}

export default function McpServerList({ groups, canSignIn, busy, onOpen, onSignIn, onRetry }: McpServerListProps) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.id} className={g.id === 'attention' ? 'mcp-attn' : 'mcp-grp-wrap'}>
          <div className="mcp-grp"><span>{g.label}</span>{g.hint && <span>{g.hint}</span>}</div>
          {g.rows.map((r) => (
            <Row key={r.key} row={r} canSignIn={canSignIn} busy={!!busy[r.key]} onOpen={onOpen} onSignIn={onSignIn} onRetry={onRetry} />
          ))}
        </div>
      ))}
      <style>{`
        .mcp-grp { display:flex; justify-content:space-between; padding:10px 12px 4px; font-size:10.5px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.08em; }
        .mcp-attn { margin:6px 10px 4px; border:1px solid rgba(212,92,60,.35); background:rgba(212,92,60,.06); border-radius:8px; }
        .mcp-attn .mcp-grp { color:var(--red); padding-top:8px; }
        .mcp-row { display:flex; align-items:center; gap:9px; padding:7px 12px; cursor:pointer; }
        .mcp-row:hover { background:var(--surface-4); }
        .mcp-ico { width:26px; height:26px; border-radius:6px; background:var(--accent-dim); color:var(--accent); display:grid; place-items:center; flex-shrink:0; }
        .mcp-info { flex:1; min-width:0; }
        .mcp-nm { font-size:12.5px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mcp-ds { font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mcp-ds.err { color:#c9806c; }
        .mcp-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
        .mcp-dot.ok { background:var(--green); }
        .mcp-dot.bad { background:var(--red); }
        .mcp-dot.pending { background:var(--accent); animation:mcp-pulse 1s infinite alternate; }
        .mcp-dot.off { border:1px solid var(--text-muted); }
        .mcp-dot.unknown { background:var(--text-muted); opacity:.5; }
        @keyframes mcp-pulse { to { opacity:.3; } }
        .mcp-btn { background:var(--surface-2); border:1px solid var(--border-subtle); color:var(--text); border-radius:6px; padding:3px 9px; font-size:11.5px; cursor:pointer; white-space:nowrap; }
        .mcp-btn:hover { border-color:var(--border-strong); }
        .mcp-btn.pri { background:var(--accent); border-color:var(--accent); color:#111; font-weight:600; }
        .mcp-btn.pri:hover { background:var(--accent-hover); }
        .mcp-btn.danger { color:var(--red); }
        .mcp-btn:disabled { opacity:.45; cursor:not-allowed; }
        .mcp-hint { font-size:10px; color:var(--text-muted); border:1px dashed var(--border-strong); border-radius:4px; padding:1px 5px; }
        .mcp-chev { color:var(--text-muted); flex-shrink:0; }
        .mcp-spin { animation:mcp-rot 1s linear infinite; color:var(--text-muted); }
        @keyframes mcp-rot { to { transform:rotate(360deg); } }
      `}</style>
    </>
  );
}
```

(`.mcp-btn` styles live here and are reused by Detail/AuthCard/Nudge — this component is always mounted before them in the sidebar; Task 10 adds its own copy for the nudge since it renders outside the sidebar.)

- [ ] **Step 4: Rewire `McpSidebar.tsx` (Claude branch)**

Changes, top to bottom:
1. Imports: drop `Server`, `McpAddServer`; add `McpServerList`, `McpServerForm` (Task 9 — until then keep `McpAddServer` import and swap in Task 9), `useMcpLive`, `buildMcpRows`, `groupMcpRows`, `needsAttention`, `type McpRow`.
2. `type View = 'list' | 'detail' | 'add' | 'edit' | 'registry-detail';`
3. Remove the `runtime` state, the runtime `useEffect`, `runtimeFor`, `selectedServer`, `handleRestart`.
4. Add:

```tsx
  const live = useMcpLive(isCodex ? undefined : projectPath, scope, { spawn: true });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = useMemo(
    () => buildMcpRows(installed, live.snapshot?.servers ?? {}, live.snapshot?.auth ?? {}),
    [installed, live.snapshot],
  );
  const filteredRows = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(query) || r.subtitle.toLowerCase().includes(query)),
    [rows, query],
  );
  const groups = useMemo(() => groupMcpRows(filteredRows), [filteredRows]);
  const attentionCount = rows.filter(needsAttention).length;
  const selectedRow = rows.find((r) => r.key === selectedKey) ?? null;

  const withBusy = async (row: McpRow, fn: () => Promise<{ ok: boolean; error?: string } | void>) => {
    setBusy((b) => ({ ...b, [row.key]: true }));
    setActionError(null);
    try {
      const res = await fn();
      if (res && !res.ok) setActionError(res.error ?? 'Action failed');
    } finally {
      setBusy((b) => ({ ...b, [row.key]: false }));
    }
  };

  const handleSignIn = (row: McpRow) => withBusy(row, () => live.authenticate(row.controlName));
  const handleRetry = (row: McpRow) => withBusy(row, () => live.reconnect(row.controlName));
  const handleToggle = (row: McpRow) => withBusy(row, async () => {
    const res = await live.toggle(row.controlName, !row.enabled, row.source);
    await loadInstalled();
    return res;
  });
  const handleRemove = async (row: McpRow) => {
    if (!row.removable) return;
    await window.sai.mcpRemove(row.name, row.source as 'user' | 'project', projectPath);
    setView('list'); setSelectedKey(null); loadInstalled();
  };
  const handleSave = async (config: McpServerConfig) => {
    const res = await window.sai.mcpAdd(config, projectPath);
    if (res?.error) { setActionError(res.error); return; }
    const wasEdit = view === 'edit';
    setView(wasEdit ? 'detail' : 'list');
    await loadInstalled();
    if (wasEdit) await live.reconnect(config.name);
  };
```

5. `loadInstalled` calls `window.sai.mcpList(projectPath)`, and its `useEffect` deps become `[isCodex, projectPath]`.
6. Installed tab button: `Installed{attentionCount > 0 && <span className="tab-badge">{attentionCount}</span>}`.
7. Replace the installed `.map(server => …sidebar-card…)` block with:

```tsx
        {!loading && !error && tab === 'installed' && live.snapshot && !live.snapshot.available && (
          <div className="mcp-unavailable">Live status unavailable — showing configuration only.</div>
        )}
        {!loading && !error && tab === 'installed' && actionError && (
          <div className="sidebar-error"><div>{actionError}</div></div>
        )}
        {!loading && !error && tab === 'installed' && (
          <McpServerList
            groups={groups}
            canSignIn={!!live.snapshot?.capabilities.authenticate}
            busy={busy}
            onOpen={(r) => { setSelectedKey(r.key); setView('detail'); }}
            onSignIn={handleSignIn}
            onRetry={handleRetry}
          />
        )}
```

and change the empty-state condition from `filteredInstalled.length === 0` to `filteredRows.length === 0`; delete `filteredInstalled`.
8. Detail branch (`view === 'detail'`) renders `McpDetail` with the Task 8 props; until Task 8 lands, temporarily pass `server={selectedRow.server ?? { name: selectedRow.name, transport: 'stdio', enabled: true }}` and the old callbacks mapped to the new handlers. If `selectedRow` is null, fall back to the list (`setView('list')`).
9. Add to the `<style>` block:

```css
        .sidebar-tab .tab-badge { display:inline-block; min-width:16px; padding:0 5px; margin-left:5px; border-radius:8px; background:var(--red); color:#fff; font-size:10px; line-height:15px; }
        .mcp-unavailable { margin:8px 10px; padding:6px 8px; font-size:11px; color:var(--text-secondary); background:var(--surface-2); border:1px solid var(--border-subtle); border-radius:6px; }
```

Remove the now-unused `.card-runtime` CSS rules. Leave the Browse tab code and the Codex branch untouched.

- [ ] **Step 5: Run + typecheck + commit**

Run: `npx vitest run --project unit tests/unit/components/MCP/ && npx tsc --noEmit` → PASS.

```bash
git add src/components/MCP/McpServerList.tsx src/components/MCP/McpSidebar.tsx tests/unit/components/MCP/McpSidebar.test.tsx
git commit -m "feat(mcp): grouped server list with needs-attention section and inline fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Detail view + auth card

**Files:**
- Rewrite: `src/components/MCP/McpDetail.tsx`
- Create: `src/components/MCP/McpAuthCard.tsx`
- Modify: `src/components/MCP/McpSidebar.tsx` (detail branch props)
- Test: `tests/unit/components/MCP/McpDetail.test.tsx`

**Interfaces:**
- Consumes: `McpRow` (Task 6), `McpCapabilities`.
- Produces:
  ```ts
  interface McpDetailProps {
    row: McpRow;
    capabilities: McpCapabilities;
    available: boolean;
    busy: boolean;
    error: string | null;
    onBack(): void;
    onReconnect(row: McpRow): void;
    onToggle(row: McpRow): void;
    onSignIn(row: McpRow): void;
    onCancelAuth(row: McpRow): void;
    onSubmitCallbackUrl(row: McpRow, url: string): void;
    onSignOut(row: McpRow): void;
    onEdit(row: McpRow): void;
    onRemove(row: McpRow): void;
  }
  interface McpAuthCardProps {
    auth: McpAuthState;
    canPasteCallback: boolean;
    onOpenAgain(): void;     // re-run sign-in
    onCancel(): void;
    onSubmitCallbackUrl(url: string): void;
  }
  ```

- [ ] **Step 1: Write the failing detail test**

```tsx
// tests/unit/components/MCP/McpDetail.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import McpDetail from '../../../../src/components/MCP/McpDetail';
import { buildMcpRows } from '../../../../src/components/MCP/mcpView';

Object.defineProperty(window, 'sai', { value: { clipboardWrite: vi.fn(), openExternal: vi.fn() }, writable: true });

const caps = { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true };
const handlers = () => ({
  onBack: vi.fn(), onReconnect: vi.fn(), onToggle: vi.fn(), onSignIn: vi.fn(), onCancelAuth: vi.fn(),
  onSubmitCallbackUrl: vi.fn(), onSignOut: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(),
});
const rowOf = (server: any, live?: any, auth?: any) =>
  buildMcpRows([server], live ? { [server.name]: live } : {}, auth ? { [server.name]: auth } : {})[0];

describe('McpDetail', () => {
  let h: ReturnType<typeof handlers>;
  beforeEach(() => { h = handlers(); });

  it('connected: pill shows serverInfo, tools listed, all actions for user http server', () => {
    const row = rowOf(
      { name: 'gh', transport: 'streamable-http', url: 'https://gh', headers: { Authorization: 'secret-token' }, enabled: true, source: 'user' },
      { name: 'gh', status: 'connected', serverInfo: { name: 'GitHub MCP', version: '0.9' }, tools: [{ name: 'search_code', description: 'Search' }] },
    );
    const { getByText, queryByText, container } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Connected · GitHub MCP v0.9')).toBeTruthy();
    expect(getByText('search_code')).toBeTruthy();
    for (const label of ['Reconnect', 'Disable', 'Sign out', 'Edit', 'Remove']) expect(getByText(label)).toBeTruthy();
    expect(container.textContent).not.toContain('secret-token');
    fireEvent.click(getByText('Edit'));
    expect(h.onEdit).toHaveBeenCalledWith(row);
    expect(queryByText('Sign in')).toBeNull();
  });

  it('plugin stdio server: no Edit/Remove/Sign out', () => {
    const row = rowOf({ name: 'plugin:pw:browser', transport: 'stdio', command: 'npx', enabled: true, source: 'plugin' }, { name: 'plugin:pw:browser', status: 'connected' });
    const { queryByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(queryByText('Edit')).toBeNull();
    expect(queryByText('Remove')).toBeNull();
    expect(queryByText('Sign out')).toBeNull();
  });

  it('needs-auth shows Sign in button in header actions', () => {
    const row = rowOf({ name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Needs sign-in')).toBeTruthy();
    fireEvent.click(getByText('Sign in'));
    expect(h.onSignIn).toHaveBeenCalledWith(row);
  });

  it('waiting: auth card with Open again / Copy link / Cancel and callback paste', () => {
    const row = rowOf({ name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'waiting', authUrl: 'https://auth/x' });
    const { getByText, getByPlaceholderText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Finish signing in in your browser')).toBeTruthy();
    expect(getByText('https://auth/x')).toBeTruthy();
    fireEvent.click(getByText('Copy link'));
    expect((window as any).sai.clipboardWrite).toHaveBeenCalledWith('https://auth/x');
    fireEvent.click(getByText('Cancel'));
    expect(h.onCancelAuth).toHaveBeenCalledWith(row);
    fireEvent.click(getByText('Paste redirect URL'));
    fireEvent.change(getByPlaceholderText('http://localhost:…/callback?code=…'), { target: { value: 'http://localhost:1/cb?code=1' } });
    fireEvent.click(getByText('Submit'));
    expect(h.onSubmitCallbackUrl).toHaveBeenCalledWith(row, 'http://localhost:1/cb?code=1');
  });

  it('timeout: shows retry message', () => {
    const row = rowOf({ name: 'cf', transport: 'sse', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'timeout', authUrl: 'https://a' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText("Sign-in didn't complete")).toBeTruthy();
  });

  it('failed: pill shows the error', () => {
    const row = rowOf({ name: 'db', transport: 'stdio', command: 'x', enabled: true, source: 'user' }, { name: 'db', status: 'failed', error: 'spawn ENOENT' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Failed — spawn ENOENT')).toBeTruthy();
  });

  it('unavailable: live-only actions disabled, Edit still enabled', () => {
    const row = rowOf({ name: 'gh', transport: 'stdio', command: 'x', enabled: true, source: 'user' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available={false} busy={false} error={null} {...h} />);
    expect((getByText('Reconnect').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((getByText('Edit').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/components/MCP/McpDetail.test.tsx` → FAIL (old props).

- [ ] **Step 3: Implement `McpAuthCard.tsx`**

```tsx
import { useState } from 'react';
import type { McpAuthState } from '../../types';

interface McpAuthCardProps {
  auth: McpAuthState;
  canPasteCallback: boolean;
  onOpenAgain(): void;
  onCancel(): void;
  onSubmitCallbackUrl(url: string): void;
}

export default function McpAuthCard({ auth, canPasteCallback, onOpenAgain, onCancel, onSubmitCallbackUrl }: McpAuthCardProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [url, setUrl] = useState('');
  const waiting = auth.phase === 'waiting';
  const title = waiting ? 'Finish signing in in your browser'
    : auth.phase === 'timeout' ? "Sign-in didn't complete"
    : 'Sign-in failed';
  const body = waiting
    ? 'We opened the login page. SAI reconnects this server automatically when you approve.'
    : auth.phase === 'timeout'
      ? 'No approval arrived within 5 minutes. Try again.'
      : auth.error ?? 'The server rejected the sign-in.';

  return (
    <div className={`mcp-auth ${waiting ? '' : 'bad'}`}>
      <b>{title}</b>
      <p>{body}</p>
      {auth.authUrl && <div className="mcp-auth-url" title={auth.authUrl}>{auth.authUrl}</div>}
      <div className="mcp-acts">
        <button className="mcp-btn" onClick={onOpenAgain}>{waiting ? 'Open again' : 'Retry'}</button>
        {auth.authUrl && (
          <button className="mcp-btn" onClick={() => (window.sai as any).clipboardWrite?.(auth.authUrl)}>Copy link</button>
        )}
        {waiting && <button className="mcp-btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
      {waiting && canPasteCallback && (
        <div className="mcp-auth-paste">
          <button className="mcp-link" onClick={() => setPasteOpen((o) => !o)}>Paste redirect URL</button>
          {pasteOpen && (
            <div className="mcp-auth-paste-row">
              <input className="form-input mono" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:…/callback?code=…" />
              <button className="mcp-btn" disabled={!url.trim()} onClick={() => onSubmitCallbackUrl(url.trim())}>Submit</button>
            </div>
          )}
        </div>
      )}
      <style>{`
        .mcp-auth { margin:12px; padding:12px; border-radius:8px; background:var(--accent-dim); border:1px solid var(--border-accent); }
        .mcp-auth.bad { background:rgba(212,92,60,.06); border-color:rgba(212,92,60,.35); }
        .mcp-auth b { display:block; margin-bottom:4px; font-size:12.5px; }
        .mcp-auth p { margin:0 0 8px; font-size:12px; color:var(--text-secondary); }
        .mcp-auth-url { font:11px 'Geist Mono',monospace; color:var(--text-secondary); background:var(--surface-2); border-radius:5px; padding:5px 7px; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mcp-acts { display:flex; gap:6px; flex-wrap:wrap; }
        .mcp-btn.ghost { background:none; }
        .mcp-link { background:none; border:none; color:var(--accent); font-size:11px; padding:8px 0 0; cursor:pointer; }
        .mcp-auth-paste-row { display:flex; gap:6px; margin-top:6px; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `McpDetail.tsx`**

```tsx
import { ArrowLeft, Cloud, FolderGit2, Puzzle, RotateCcw, Server, Trash2, Pencil, LogOut, Power } from 'lucide-react';
import { useState } from 'react';
import type { McpCapabilities } from '../../types';
import type { McpRow } from './mcpView';
import McpAuthCard from './McpAuthCard';

interface McpDetailProps {
  row: McpRow;
  capabilities: McpCapabilities;
  available: boolean;
  busy: boolean;
  error: string | null;
  onBack(): void;
  onReconnect(row: McpRow): void;
  onToggle(row: McpRow): void;
  onSignIn(row: McpRow): void;
  onCancelAuth(row: McpRow): void;
  onSubmitCallbackUrl(row: McpRow, url: string): void;
  onSignOut(row: McpRow): void;
  onEdit(row: McpRow): void;
  onRemove(row: McpRow): void;
}

const ICON = { user: Server, project: FolderGit2, plugin: Puzzle, claudeai: Cloud } as const;
const SOURCE_LABEL = { user: 'global', project: 'project', plugin: 'plugin', claudeai: 'claude.ai' } as const;
const TOOL_PREVIEW = 8;
const mask = (obj?: Record<string, string>) =>
  obj ? Object.fromEntries(Object.keys(obj).map((k) => [k, '••••••'])) : null;

function pillText(row: McpRow): string {
  if (!row.enabled) return 'Disabled';
  if (row.auth?.phase === 'waiting') return 'Waiting for browser sign-in…';
  switch (row.live?.status) {
    case 'connected': return row.live.serverInfo ? `Connected · ${row.live.serverInfo.name} v${row.live.serverInfo.version}` : 'Connected';
    case 'pending': return 'Connecting…';
    case 'needs-auth': return 'Needs sign-in';
    case 'failed': return `Failed — ${row.live.error || 'unknown error'}`;
    case 'disabled': return 'Disabled';
    default: return 'Status unknown';
  }
}

export default function McpDetail(props: McpDetailProps) {
  const { row, capabilities: caps, available, busy, error } = props;
  const [showAllTools, setShowAllTools] = useState(false);
  const Icon = ICON[row.source];
  const remote = row.transport !== 'stdio';
  const live = available && !busy;
  const tools = row.live?.tools ?? [];
  const shownTools = showAllTools ? tools : tools.slice(0, TOOL_PREVIEW);
  const server = row.server;
  const transportLabel = row.transport === 'streamable-http' ? 'http' : row.transport;

  return (
    <div className="mcp-detail">
      <button className="detail-back" onClick={props.onBack}><ArrowLeft size={12} /> Servers</button>

      <div className="mcp-dhd">
        <div className="mcp-dht">
          <div className="mcp-ico lg"><Icon size={16} /></div>
          <div className="mcp-info">
            <div className="mcp-dnm">{row.displayName}</div>
            <div className="mcp-ds">{transportLabel} · {row.source === 'plugin' ? `plugin: ${row.pluginShort}` : SOURCE_LABEL[row.source]}</div>
          </div>
        </div>
        <span className="mcp-pill"><span className={`mcp-dot ${row.dot}`} />{pillText(row)}</span>
        <div className="mcp-acts">
          {row.fix === 'sign-in' && caps.authenticate && row.auth?.phase !== 'waiting' && (
            <button className="mcp-btn pri" disabled={!live} onClick={() => props.onSignIn(row)}>Sign in</button>
          )}
          {row.fix === 'sign-in' && !caps.authenticate && (
            <span className="mcp-hint" title="Run `claude` in a terminal, then /mcp">Sign in from a terminal: claude → /mcp</span>
          )}
          <button className="mcp-btn" disabled={!live || !caps.reconnect} onClick={() => props.onReconnect(row)}>
            <RotateCcw size={11} /> Reconnect
          </button>
          {row.source !== 'claudeai' && (
            <button className="mcp-btn" disabled={busy} onClick={() => props.onToggle(row)}>
              <Power size={11} /> {row.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
          {remote && caps.clearAuth && row.live?.status === 'connected' && (
            <button className="mcp-btn" disabled={!live} onClick={() => props.onSignOut(row)}><LogOut size={11} /> Sign out</button>
          )}
          {row.editable && <button className="mcp-btn ghost" disabled={busy} onClick={() => props.onEdit(row)}><Pencil size={11} /> Edit</button>}
          {row.removable && <button className="mcp-btn ghost danger" disabled={busy} onClick={() => props.onRemove(row)}><Trash2 size={11} /> Remove</button>}
        </div>
        {error && <div className="mcp-derr">{error}</div>}
      </div>

      {row.auth && (
        <McpAuthCard
          auth={row.auth}
          canPasteCallback={caps.submitCallbackUrl}
          onOpenAgain={() => props.onSignIn(row)}
          onCancel={() => props.onCancelAuth(row)}
          onSubmitCallbackUrl={(url) => props.onSubmitCallbackUrl(row, url)}
        />
      )}

      <div className="mcp-sec">
        <h4>Tools{tools.length ? ` · ${tools.length}` : ''}</h4>
        {tools.length === 0 && (
          <div className="mcp-ds">{row.live?.status === 'needs-auth' ? 'Tools appear after sign-in.' : 'No tools reported.'}</div>
        )}
        {shownTools.map((t) => (
          <div key={t.name} className="mcp-tool" title={t.description}>
            {t.name}{t.description && <span>{t.description}</span>}
          </div>
        ))}
        {tools.length > TOOL_PREVIEW && (
          <button className="mcp-link" onClick={() => setShowAllTools((s) => !s)}>
            {showAllTools ? 'Show fewer' : `+ ${tools.length - TOOL_PREVIEW} more`}
          </button>
        )}
      </div>

      <div className="mcp-sec">
        <h4>Config</h4>
        <div className="config-block">
          {server?.command && <div><span className="config-key">command:</span> {server.command}</div>}
          {server?.args?.length ? <div><span className="config-key">args:</span> {server.args.join(' ')}</div> : null}
          {(server?.url ?? row.live?.config?.url) && <div><span className="config-key">url:</span> {server?.url ?? row.live?.config?.url}</div>}
          {mask(server?.env) && <div><span className="config-key">env:</span> {Object.keys(server!.env!).map((k) => `${k}=••••••`).join(' ')}</div>}
          {mask(server?.headers) && <div><span className="config-key">headers:</span> {Object.keys(server!.headers!).map((k) => `${k}: ••••••`).join(', ')}</div>}
          {!server && !row.live?.config?.url && <div className="config-key">Managed outside SAI</div>}
        </div>
      </div>

      <style>{`
        .mcp-detail { width:var(--sidebar-width); background:var(--surface-1); border-right:1px solid var(--border-subtle); overflow-y:auto; flex-shrink:0; }
        .detail-back { display:flex; align-items:center; gap:6px; padding:8px 12px; border:none; border-bottom:1px solid var(--border-hairline); background:none; color:var(--text-muted); cursor:pointer; font-size:11px; width:100%; }
        .detail-back:hover { color:var(--text); }
        .mcp-dhd { padding:12px; border-bottom:1px solid var(--border-hairline); }
        .mcp-dht { display:flex; gap:10px; align-items:center; margin-bottom:8px; }
        .mcp-ico.lg { width:32px; height:32px; }
        .mcp-dnm { font-size:14px; font-weight:600; color:var(--text); }
        .mcp-pill { display:inline-flex; align-items:center; gap:6px; font-size:11px; padding:2px 8px; border-radius:10px; background:var(--surface-2); border:1px solid var(--border-subtle); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .mcp-dhd .mcp-acts { margin-top:10px; }
        .mcp-btn { display:inline-flex; align-items:center; gap:4px; }
        .mcp-derr { margin-top:8px; font-size:11px; color:var(--red); }
        .mcp-sec { padding:10px 12px; border-bottom:1px solid var(--border-hairline); }
        .mcp-sec h4 { margin:0 0 6px; font-size:10.5px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.08em; font-weight:500; }
        .mcp-tool { font:11.5px 'Geist Mono',monospace; padding:3px 0; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mcp-tool span { color:var(--text-muted); font-family:inherit; margin-left:6px; font-size:11px; }
        .config-block { padding:8px 10px; background:var(--surface-2); border-radius:6px; font-family:'Geist Mono',monospace; font-size:10.5px; color:var(--text-secondary); line-height:1.6; border:1px solid var(--border-hairline); word-break:break-all; }
        .config-key { color:var(--text-muted); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 5: Wire detail props in `McpSidebar.tsx`**

```tsx
  if (view === 'detail' && selectedRow) {
    return (
      <McpDetail
        row={selectedRow}
        capabilities={live.snapshot?.capabilities ?? EMPTY_CAPS}
        available={!!live.snapshot?.available}
        busy={!!busy[selectedRow.key]}
        error={actionError}
        onBack={() => { setView('list'); setSelectedKey(null); setActionError(null); }}
        onReconnect={handleRetry}
        onToggle={handleToggle}
        onSignIn={handleSignIn}
        onCancelAuth={(r) => live.cancelAuth(r.controlName)}
        onSubmitCallbackUrl={(r, url) => withBusy(r, () => live.submitCallbackUrl(r.controlName, url))}
        onSignOut={(r) => withBusy(r, () => live.signOut(r.controlName))}
        onEdit={() => setView('edit')}
        onRemove={handleRemove}
      />
    );
  }
```

Import `EMPTY_CAPS` from `./useMcpLive`. If `view === 'detail'` and `selectedRow` is null (row vanished after a reload), render the list.

- [ ] **Step 6: Run + typecheck + commit**

Run: `npx vitest run --project unit tests/unit/components/MCP/ && npx tsc --noEmit` → PASS.

```bash
git add src/components/MCP/McpDetail.tsx src/components/MCP/McpAuthCard.tsx src/components/MCP/McpSidebar.tsx tests/unit/components/MCP/McpDetail.test.tsx
git commit -m "feat(mcp): live detail view with sign-in card, tools and working actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Add/Edit form with headers and target file

**Files:**
- Create: `src/components/MCP/McpServerForm.tsx` (from `McpAddServer.tsx`)
- Delete: `src/components/MCP/McpAddServer.tsx`
- Modify: `src/components/MCP/McpSidebar.tsx` (`add` / `edit` views)
- Test: `tests/unit/components/MCP/McpServerForm.test.tsx`

**Interfaces:**
- Consumes: `McpServer`, `McpServerConfig` types.
- Produces:
  ```ts
  interface McpServerFormProps {
    mode: 'add' | 'edit';
    initial?: McpServer;          // required in edit mode
    hasProject: boolean;          // offer the "This project" target
    onBack(): void;
    onSubmit(config: McpServerConfig): void;
  }
  ```

- [ ] **Step 1: Write the failing form test**

```tsx
// tests/unit/components/MCP/McpServerForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import McpServerForm from '../../../../src/components/MCP/McpServerForm';

describe('McpServerForm', () => {
  it('add http server with headers to the project file', () => {
    const onSubmit = vi.fn();
    const { getByText, getByPlaceholderText, getAllByPlaceholderText } = render(
      <McpServerForm mode="add" hasProject onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'cf' } });
    fireEvent.click(getByText('HTTP'));
    fireEvent.change(getByPlaceholderText('https://example.com/mcp'), { target: { value: 'https://cf/mcp' } });
    fireEvent.click(getByText('Add header'));
    fireEvent.change(getAllByPlaceholderText('Header')[0], { target: { value: 'Authorization' } });
    fireEvent.change(getAllByPlaceholderText('value')[0], { target: { value: 'Bearer x' } });
    fireEvent.click(getByText('This project'));
    fireEvent.click(getByText('Add Server'));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'cf', transport: 'streamable-http', url: 'https://cf/mcp', headers: { Authorization: 'Bearer x' }, source: 'project',
    });
  });

  it('edit mode prefills, locks name, hides target, keeps source', () => {
    const onSubmit = vi.fn();
    const { getByDisplayValue, getByText, queryByText } = render(
      <McpServerForm mode="edit" hasProject
        initial={{ name: 'gh', transport: 'streamable-http', url: 'https://gh', headers: { A: 'b' }, enabled: true, source: 'project' }}
        onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    expect((getByDisplayValue('gh') as HTMLInputElement).readOnly).toBe(true);
    expect(getByDisplayValue('A')).toBeTruthy();
    expect(queryByText('This project')).toBeNull();
    expect(getByText('Edit MCP Server')).toBeTruthy();
    fireEvent.click(getByText('Save'));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'gh', transport: 'streamable-http', url: 'https://gh', headers: { A: 'b' }, source: 'project' });
  });

  it('stdio has no headers section', () => {
    const { queryByText } = render(<McpServerForm mode="add" hasProject={false} onBack={vi.fn()} onSubmit={vi.fn()} />);
    expect(queryByText('Add header')).toBeNull();
    expect(queryByText('This project')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run --project unit tests/unit/components/MCP/McpServerForm.test.tsx` → FAIL.

- [ ] **Step 3: Create `McpServerForm.tsx`**

`git mv src/components/MCP/McpAddServer.tsx src/components/MCP/McpServerForm.tsx`, then edit it:

1. Props + state:

```tsx
import { useState } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import type { McpServer, McpServerConfig } from '../../types';

type Transport = McpServerConfig['transport'];
type Pair = { key: string; value: string };

interface McpServerFormProps {
  mode: 'add' | 'edit';
  initial?: McpServer;
  hasProject: boolean;
  onBack(): void;
  onSubmit(config: McpServerConfig): void;
}

const toPairs = (o?: Record<string, string>): Pair[] => Object.entries(o ?? {}).map(([key, value]) => ({ key, value }));
const fromPairs = (p: Pair[]) => Object.fromEntries(p.filter((x) => x.key.trim()).map((x) => [x.key.trim(), x.value]));

function PairEditor({ pairs, setPairs, keyPlaceholder, addLabel }: {
  pairs: Pair[]; setPairs(p: Pair[]): void; keyPlaceholder: string; addLabel: string;
}) {
  const update = (i: number, field: keyof Pair, v: string) => setPairs(pairs.map((p, j) => (j === i ? { ...p, [field]: v } : p)));
  return (
    <>
      {pairs.map((p, i) => (
        <div key={i} className="env-row">
          <input className="form-input mono env-key" value={p.key} onChange={(e) => update(i, 'key', e.target.value)} placeholder={keyPlaceholder} />
          <span className="env-eq">=</span>
          <input className="form-input mono env-val" value={p.value} onChange={(e) => update(i, 'value', e.target.value)} placeholder="value" />
          <button className="env-remove" onClick={() => setPairs(pairs.filter((_, j) => j !== i))}><X size={12} /></button>
        </div>
      ))}
      <button className="add-env-btn" onClick={() => setPairs([...pairs, { key: '', value: '' }])}><Plus size={10} /> {addLabel}</button>
    </>
  );
}

export default function McpServerForm({ mode, initial, hasProject, onBack, onSubmit }: McpServerFormProps) {
  const editing = mode === 'edit';
  const [name, setName] = useState(initial?.name ?? '');
  const [transport, setTransport] = useState<Transport>(initial?.transport ?? 'stdio');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(initial?.args?.join(' ') ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [envVars, setEnvVars] = useState<Pair[]>(toPairs(initial?.env));
  const [headers, setHeaders] = useState<Pair[]>(toPairs(initial?.headers));
  const [target, setTarget] = useState<'user' | 'project'>(initial?.source === 'project' ? 'project' : 'user');

  const handleSubmit = () => {
    if (!isValid) return;
    const env = fromPairs(envVars);
    const hdrs = fromPairs(headers);
    onSubmit({
      name: name.trim(),
      transport,
      ...(transport === 'stdio'
        ? { command: command.trim(), ...(args.trim() ? { args: args.trim().split(/\s+/) } : {}) }
        : { url: url.trim(), ...(Object.keys(hdrs).length ? { headers: hdrs } : {}) }),
      ...(Object.keys(env).length ? { env } : {}),
      source: target,
    });
  };

  const isValid = !!name.trim() && !!(transport === 'stdio' ? command.trim() : url.trim());
```

2. JSX changes vs. the old file:
   - Title: `{editing ? 'Edit MCP Server' : 'Add MCP Server'}`.
   - Name input: `readOnly={editing}`.
   - After the name field, when `!editing && hasProject`, a "Save to" toggle reusing `.transport-toggle`/`.transport-btn` styles with buttons `Global` (`target === 'user'`) and `This project`.
   - URL placeholder: `https://example.com/mcp`.
   - When `transport !== 'stdio'`: a `Headers (optional)` field containing `<PairEditor pairs={headers} setPairs={setHeaders} keyPlaceholder="Header" addLabel="Add header" />`.
   - Env field uses `<PairEditor pairs={envVars} setPairs={setEnvVars} keyPlaceholder="KEY" addLabel="Add variable" />` (replacing the inline env rows and handlers).
   - Submit button label: `{editing ? 'Save' : 'Add Server'}`.
   - Rename root class `.mcp-add-server` → `.mcp-server-form` (both JSX and CSS).

- [ ] **Step 4: Wire into `McpSidebar.tsx`**

```tsx
  if (view === 'add' || (view === 'edit' && selectedRow?.server)) {
    return (
      <McpServerForm
        mode={view}
        initial={view === 'edit' ? selectedRow!.server : undefined}
        hasProject={!!projectPath}
        onBack={() => setView(view === 'edit' ? 'detail' : 'list')}
        onSubmit={handleSave}
      />
    );
  }
```

Replace the old `McpAddServer` import/usage. The registry Install button keeps calling `handleAdd` — reimplement `handleAdd` as `(config) => handleSave(config)` with `view` still `'list'`/`'registry-detail'` (so it doesn't reconnect).

- [ ] **Step 5: Run + typecheck + commit**

Run: `npx vitest run --project unit tests/unit/components/MCP/ && npx tsc --noEmit` → PASS.

```bash
git add -A src/components/MCP tests/unit/components/MCP/McpServerForm.test.tsx
git commit -m "feat(mcp): add/edit form with headers and project target

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Chat sign-in nudge

**Files:**
- Create: `src/components/Chat/McpAuthNudge.tsx`
- Modify: `src/components/Chat/ChatPanel.tsx` (props + mount above `<ChatInput` at ~line 2691)
- Modify: `src/App.tsx` (pass `onOpenMcpPanel` to both `<ChatPanel` usages, ~lines 4729 and 5068)
- Test: `tests/unit/components/Chat/McpAuthNudge.test.tsx`

**Interfaces:**
- Consumes: `useMcpLive` (spawn:false), `buildMcpRows` not needed — works off `snapshot.servers`.
- Produces: `McpAuthNudge` props `{ projectPath: string; scope: string; onOpenMcpPanel?: () => void }`; `ChatPanelProps.onOpenMcpPanel?: () => void`.

- [ ] **Step 1: Write the failing nudge test**

```tsx
// tests/unit/components/Chat/McpAuthNudge.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import McpAuthNudge from '../../../../src/components/Chat/McpAuthNudge';

let pushCb: ((p: any) => void) | null = null;
const caps = { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true };
const snap = (servers: any, auth: any = {}, over: any = {}) => ({ projectPath: '/p', scope: 's1', servers, auth, available: true, capabilities: caps, ...over });
const sai = {
  mcpRuntimeStatus: vi.fn(),
  mcpStatus: vi.fn(),
  mcpAuthenticate: vi.fn().mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'https://a' }),
  mcpAuthCancel: vi.fn().mockResolvedValue(undefined),
  onMcpRuntimeStatus: vi.fn((cb: any) => { pushCb = cb; return () => {}; }),
};
Object.defineProperty(window, 'sai', { value: sai, writable: true });

describe('McpAuthNudge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders nothing when no server needs auth, and never spawns a session', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ gh: { name: 'gh', status: 'connected' } }));
    const { container } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    await waitFor(() => expect(sai.mcpRuntimeStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(sai.mcpStatus).not.toHaveBeenCalled();
  });

  it('single server: Sign in runs auth, waiting state shows, connected hides', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ 'plugin:cloudflare:cloudflare-api': { name: 'plugin:cloudflare:cloudflare-api', status: 'needs-auth' } }));
    const { findByText, queryByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    expect(await findByText('cloudflare-api')).toBeTruthy();
    fireEvent.click(await findByText('Sign in'));
    expect(sai.mcpAuthenticate).toHaveBeenCalledWith('/p', 's1', 'plugin:cloudflare:cloudflare-api');
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: { 'plugin:cloudflare:cloudflare-api': { name: 'plugin:cloudflare:cloudflare-api', status: 'needs-auth' } }, auth: { 'plugin:cloudflare:cloudflare-api': { phase: 'waiting', authUrl: 'https://a' } } }));
    expect(await findByText(/Waiting for browser/)).toBeTruthy();
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: { 'plugin:cloudflare:cloudflare-api': { name: 'plugin:cloudflare:cloudflare-api', status: 'connected' } }, auth: {} }));
    await waitFor(() => expect(queryByText('cloudflare-api')).toBeNull());
  });

  it('multiple servers collapse to Review which opens the panel', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ a: { name: 'a', status: 'needs-auth' }, b: { name: 'b', status: 'needs-auth' } }));
    const onOpen = vi.fn();
    const { findByText } = render(<McpAuthNudge projectPath="/p" scope="s1" onOpenMcpPanel={onOpen} />);
    expect(await findByText('2 servers need sign-in')).toBeTruthy();
    fireEvent.click(await findByText('Review'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('dismiss hides until the set of needs-auth servers changes', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ a: { name: 'a', status: 'needs-auth' } }));
    const { findByLabelText, queryByText, findByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    fireEvent.click(await findByLabelText('Dismiss'));
    expect(queryByText('a')).toBeNull();
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: { a: { name: 'a', status: 'needs-auth' }, b: { name: 'b', status: 'needs-auth' } }, auth: {} }));
    expect(await findByText('2 servers need sign-in')).toBeTruthy();
  });

  it('without auth capability shows terminal hint', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ a: { name: 'a', status: 'needs-auth' } }, {}, { capabilities: { ...caps, authenticate: false } }));
    const { findByText, queryByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    expect(await findByText(/claude → \/mcp/)).toBeTruthy();
    expect(queryByText('Sign in')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run --project unit tests/unit/components/Chat/McpAuthNudge.test.tsx` → FAIL.

- [ ] **Step 3: Implement `McpAuthNudge.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useMcpLive } from '../MCP/useMcpLive';
import { HIDDEN_LIVE_NAMES } from '../MCP/mcpView';

interface McpAuthNudgeProps {
  projectPath: string;
  scope: string;
  onOpenMcpPanel?: () => void;
}

const display = (name: string) => /^plugin:[^:]+:(.+)$/.exec(name)?.[1] ?? name;

/** Strip above the composer when this chat's session has MCP servers waiting
 *  for OAuth. Reads cached status only — never spawns a session. */
export default function McpAuthNudge({ projectPath, scope, onOpenMcpPanel }: McpAuthNudgeProps) {
  const live = useMcpLive(projectPath, scope, { spawn: false });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const needs = useMemo(
    () => Object.values(live.snapshot?.servers ?? {})
      .filter((s) => s.status === 'needs-auth' && !HIDDEN_LIVE_NAMES.has(s.name))
      .map((s) => s.name)
      .sort(),
    [live.snapshot],
  );
  const key = needs.join('|');
  if (needs.length === 0 || dismissedKey === key) return null;

  const caps = live.snapshot?.capabilities;
  const only = needs.length === 1 ? needs[0] : null;
  const auth = only ? live.snapshot?.auth[only] : undefined;

  let message: React.ReactNode;
  let action: React.ReactNode = null;
  if (!only) {
    message = <span>{needs.length} servers need sign-in</span>;
    action = onOpenMcpPanel && <button className="mcp-btn pri" onClick={onOpenMcpPanel}>Review</button>;
  } else if (auth?.phase === 'waiting') {
    message = <span><b>{display(only)}</b> — Waiting for browser sign-in…</span>;
    action = <button className="mcp-btn" onClick={() => void live.cancelAuth(only)}>Cancel</button>;
  } else {
    const retry = auth?.phase === 'timeout' || auth?.phase === 'error';
    message = (
      <span>
        <b>{display(only)}</b>{' '}
        {retry ? "— sign-in didn't complete." : "needs sign-in — its tools aren't available in this chat."}
      </span>
    );
    action = caps?.authenticate
      ? <button className="mcp-btn pri" onClick={() => void live.authenticate(only)}>{retry ? 'Retry' : 'Sign in'}</button>
      : <span className="mcp-nudge-hint">Sign in from a terminal: claude → /mcp</span>;
  }

  return (
    <div className="mcp-nudge" role="status">
      <span className="mcp-nudge-dot" />
      {message}
      {action}
      <button className="mcp-nudge-x" aria-label="Dismiss" onClick={() => setDismissedKey(key)}><X size={12} /></button>
      <style>{`
        .mcp-nudge { display:flex; align-items:center; gap:10px; margin:0 0 8px; padding:7px 10px; border-radius:8px; background:rgba(var(--accent-rgb),.07); border:1px solid rgba(var(--accent-rgb),.3); font-size:12.5px; color:var(--text); }
        .mcp-nudge b { font-weight:600; }
        .mcp-nudge-dot { width:7px; height:7px; border-radius:50%; background:var(--red); flex-shrink:0; }
        .mcp-nudge-hint { font-size:11px; color:var(--text-secondary); }
        .mcp-nudge-x { margin-left:auto; background:none; border:none; color:var(--text-muted); cursor:pointer; padding:2px; display:flex; }
        .mcp-nudge-x:hover { color:var(--text); }
        .mcp-nudge .mcp-btn { background:var(--surface-2); border:1px solid var(--border-subtle); color:var(--text); border-radius:6px; padding:3px 9px; font-size:11.5px; cursor:pointer; white-space:nowrap; }
        .mcp-nudge .mcp-btn.pri { background:var(--accent); border-color:var(--accent); color:#111; font-weight:600; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Mount in `ChatPanel.tsx`**

1. Add to `ChatPanelProps`: `/** Opens the MCP sidebar (chat sign-in nudge "Review"). */ onOpenMcpPanel?: () => void;` and destructure `onOpenMcpPanel` in the component signature.
2. Import `McpAuthNudge from './McpAuthNudge'`.
3. Immediately before `<ChatInput` (~line 2691), inside the same parent element:

```tsx
          {aiProvider === 'claude' && projectPath && (
            <McpAuthNudge projectPath={projectPath} scope={claudeScope} onOpenMcpPanel={onOpenMcpPanel} />
          )}
```

Check the surrounding JSX: if `<ChatInput` is inside a conditional expression or wrapper where a sibling cannot be added directly, wrap both in a fragment `<>…</>`.

- [ ] **Step 5: Pass from `App.tsx`**

At both `<ChatPanel` sites (~4729, ~5068) add `onOpenMcpPanel={() => setSidebarOpen('mcp')}` — confirm the setter name with `grep -n "setSidebarOpen" src/App.tsx | head -3`; if opening needs to go through a toggle helper used by the NavBar MCP button (`grep -n "'mcp'" src/App.tsx`), call that helper with `'mcp'` instead, without toggling it closed if already open.

- [ ] **Step 6: Run + typecheck + commit**

Run: `npx vitest run --project unit tests/unit/components/Chat/McpAuthNudge.test.tsx tests/unit/components/Chat/ && npx tsc --noEmit` → PASS (existing ChatPanel tests must still pass; if they mock `window.sai` without `mcpRuntimeStatus`, the hook no-ops by design).

```bash
git add src/components/Chat/McpAuthNudge.tsx src/components/Chat/ChatPanel.tsx src/App.tsx tests/unit/components/Chat/McpAuthNudge.test.tsx
git commit -m "feat(mcp): chat nudge to sign in to MCP servers needing auth

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full verification + live smoke

**Files:** none new (fixes only, if verification finds issues).

- [ ] **Step 1: Full unit suite + typecheck**

Run: `npx vitest run --project unit && npx tsc --noEmit`
Expected: all PASS. Fix any regressions (e.g., other tests that mocked `mcpRuntimeStatus` with the old shape — update them to the per-scope `McpRuntimePush` shape).

- [ ] **Step 2: Visual check in-app**

Launch the dev app (`npm run dev` per the repo's run setup), open a Claude chat, open the MCP sidebar. Capture with `sai_capture_app` and compare against the approved mockup ("MCP panel redesign — mockup v1"): needs-attention box, groups, dots, detail pill/actions, auth card, nudge strip.

- [ ] **Step 3: Live smoke checklist (record results in the PR body)**

1. Cloudflare `needs-auth` appears in Needs attention and the Installed badge counts it.
2. Send a message in a chat → nudge appears above composer → Sign in → browser opens → approve → nudge disappears, row turns green, and asking Claude to use a Cloudflare tool works in the same chat.
3. `claude` CLI → `/mcp` shows Cloudflare authenticated (shared tokens).
4. Sign out → row returns to Needs sign-in.
5. Disable/Enable a server → status flips live; restart app → state persisted.
6. Edit a global http server's header → saves to `~/.claude.json`, reconnects.
7. Add a project server → written to `<project>/.mcp.json`, appears under Project.
8. Retry a failed stdio server → reconnects (or shows the new error).
9. Opening the panel on a chat restored after app restart, then sending a message → conversation resumes (Review Focus #2).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(mcp): verification follow-ups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Skip if nothing changed.)
