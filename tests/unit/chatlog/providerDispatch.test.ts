// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({
  mode: 'sdk' as 'sdk' | 'cli',
  workspaces: new Set<string>(),
  claude: { send: vi.fn(), interrupt: vi.fn(), isScopeBusy: vi.fn(() => false) },
  gemini: { send: vi.fn(), stop: vi.fn() },
  kimi: { send: vi.fn(), stop: vi.fn(), approve: vi.fn() },
}));

vi.mock('../../../electron/services/claudeBackend', () => ({
  getClaudeBackend: () => h.claude,
  getClaudeBackendSetting: () => h.mode,
}));
vi.mock('../../../electron/services/codexBackend', () => ({
  getCodexBackend: () => ({ isScopeBusy: () => false, send: vi.fn(), getModels: async () => ({ models: [], defaultModel: '' }) }),
}));
vi.mock('../../../electron/services/gemini', () => ({ getGeminiCommands: () => h.gemini }));
vi.mock('../../../electron/services/acpProvider', () => ({ getAcpCommands: () => h.kimi }));
vi.mock('../../../electron/services/workspace', () => ({
  get: (p: string) => (h.workspaces.has(p) ? { gemini: { scopeTurns: new Map() }, kimi: { scopeTurns: new Map() } } : undefined),
}));
vi.mock('../../../electron/services/loadGuard', () => ({ getLoadGuard: () => null }));

import { createProviderDispatch } from '../../../electron/services/chatlog/providerDispatch';
import { ChatLogStore } from '../../../electron/services/chatlog/store';
import { ChatLogService } from '../../../electron/services/chatlog/service';
import { ChatCommands, type Timers } from '../../../electron/services/chatlog/commands';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
beforeEach(() => {
  h.mode = 'sdk';
  h.workspaces.clear();
  vi.clearAllMocks();
});

const P = '/proj';

function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdisp-'));
  dirs.push(dir);
  const store = new ChatLogStore({ dir });
  stores.push(store);
  const log = new ChatLogService({
    store, sendToRenderer: () => {}, bus: () => null, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
  });
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const timers: Timers = { set: (fn, ms) => { const t = { fn, ms }; scheduled.push(t); return t; }, clear: (t) => { const i = scheduled.indexOf(t as any); if (i >= 0) scheduled.splice(i, 1); } };
  const cmds = new ChatCommands({ log, store, dispatch: createProviderDispatch(), timers, retryBaseMs: 250 });
  return { store, cmds, scheduled };
}

const send = (clientId: string, extra: Record<string, unknown> = {}) => ({
  kind: 'send' as const, chatId: 'c1', clientId, text: 'hi', origin: 'remote' as const, projectPath: P, ...extra,
});

describe('createProviderDispatch.canDispatch', () => {
  it('claude on the SDK backend is ready without an open workspace (SdkBackend.send creates it)', () => {
    const d = createProviderDispatch();
    expect(d.canDispatch!('claude', P, 'c1')).toBe(true);
    h.mode = 'cli';
    expect(d.canDispatch!('claude', P, 'c1')).toBe(false);
    h.workspaces.add(P);
    expect(d.canDispatch!('claude', P, 'c1')).toBe(true);
  });

  it('gemini and kimi need a workspace; codex never does', () => {
    const d = createProviderDispatch();
    expect(d.canDispatch!('gemini', P, 'c1')).toBe(false);
    expect(d.canDispatch!('kimi', P, 'c1')).toBe(false);
    expect(d.canDispatch!('codex', P, 'c1')).toBe(true);
    h.workspaces.add(P);
    expect(d.canDispatch!('gemini', P, 'c1')).toBe(true);
    expect(d.canDispatch!('kimi', P, 'c1')).toBe(true);
  });
});

describe('ChatCommands with the real dispatch', () => {
  it('a Claude SDK send with no open workspace dispatches immediately', async () => {
    const { store, cmds } = mk();
    const r = await cmds.run(send('u1'));
    expect(r.ok).toBe(true);
    expect(h.claude.send).toHaveBeenCalledTimes(1);
    expect(h.claude.send.mock.calls[0][0]).toMatchObject({ projectPath: P, scope: 'c1', message: 'hi', origin: 'remote', logged: true });
    expect(store.state('c1')!.queue).toEqual([]);
  });

  it('a Claude CLI send with no workspace stays queued with a bounded retry, and drains once the workspace exists', async () => {
    h.mode = 'cli';
    const { store, cmds, scheduled } = mk();
    await cmds.run(send('u1'));
    expect(h.claude.send).not.toHaveBeenCalled();
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u1']);
    // A retry is scheduled (not a fire-and-forget drop).
    const retry = scheduled.find((t) => t.ms === 250);
    expect(retry).toBeDefined();
    // Still not ready: it backs off with a longer delay.
    scheduled.splice(scheduled.indexOf(retry!), 1);
    retry!.fn();
    const next = scheduled.find((t) => t.ms === 500);
    expect(next).toBeDefined();
    expect(h.claude.send).not.toHaveBeenCalled();
    // The workspace opens: the next retry dispatches and removes the item.
    h.workspaces.add(P);
    scheduled.splice(scheduled.indexOf(next!), 1);
    next!.fn();
    expect(h.claude.send).toHaveBeenCalledTimes(1);
    expect(store.state('c1')!.queue).toEqual([]);
  });

  it('the not-ready retry gives up after maxRetries', async () => {
    h.mode = 'cli';
    const { cmds, scheduled } = mk();
    await cmds.run(send('u1'));
    let runs = 0;
    for (;;) {
      const t = scheduled.find((x) => x.ms >= 250);
      if (!t) break;
      scheduled.splice(scheduled.indexOf(t), 1);
      t.fn();
      if (++runs > 20) throw new Error('unbounded retry');
    }
    expect(runs).toBe(6);
    expect(h.claude.send).not.toHaveBeenCalled();
  });
});
