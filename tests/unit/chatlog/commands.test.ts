// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatLogStore } from '../../../electron/services/chatlog/store';
import { ChatLogService } from '../../../electron/services/chatlog/service';
import { ChatCommands, type ProviderDispatch } from '../../../electron/services/chatlog/commands';
import type { ChatSettings } from '../../../src/lib/chat/types';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const P = '/proj';
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function fakeDispatch() {
  const calls: Array<[string, ...unknown[]]> = [];
  let busy = false;
  let paused = false;
  const d: ProviderDispatch & { setBusy(b: boolean): void; setPaused(b: boolean): void } = {
    send: vi.fn((p, a) => { calls.push(['send', p, a]); }),
    stop: vi.fn((p, projectPath, scope) => { calls.push(['stop', p, projectPath, scope]); }),
    approve: vi.fn(async (p, a) => { calls.push(['approve', p, a]); }),
    answer: vi.fn(async (a) => { calls.push(['answer', a]); }),
    planReview: vi.fn(async (a) => { calls.push(['planReview', a]); }),
    isBusy: vi.fn(() => busy),
    isLoadPaused: vi.fn(() => paused),
    setBusy(b) { busy = b; },
    setPaused(b) { paused = b; },
  };
  return { d, calls };
}

function wire(log: ChatLogService, cmds: ChatCommands) {
  log.setTurnHooks({
    started: (id) => cmds.onTurnStarted(id),
    ended: (id, ev) => cmds.onTurnEnded(id, ev),
    idleDone: (id) => cmds.onIdleDone(id),
  });
}

function mk(opts: { ceiling?: 'auto' | 'auto-read' | 'always-ask' | null; provider?: ChatSettings['provider']; dir?: string } = {}) {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'chatcmd-'));
  if (!opts.dir) dirs.push(dir);
  const store = new ChatLogStore({ dir });
  stores.push(store);
  const log = new ChatLogService({
    store,
    sendToRenderer: () => {},
    bus: () => null,
    liveChats: () => [],
    providerOf: () => opts.provider ?? 'claude',
    devlog: () => {},
  });
  const { d, calls } = fakeDispatch();
  const cmds = new ChatCommands({ log, store, dispatch: d, getRemoteCeiling: () => opts.ceiling ?? null, retryBaseMs: 2, inFlightTimeoutMs: 200 });
  wire(log, cmds);
  return { store, log, d, calls, cmds, dir };
}

const send = (clientId: string, text: string, extra: Record<string, unknown> = {}) => ({
  kind: 'send' as const, chatId: 'c1', clientId, text, origin: 'desktop' as const, projectPath: P, ...extra,
});

/** Simulate a backend turn in the log: streaming_start then done. */
function startTurn(log: ChatLogService, turnSeq = 1) {
  log.record({ type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq });
}
function endTurn(log: ChatLogService, turnSeq = 1) {
  log.record({ type: 'done', projectPath: P, scope: 'c1', turnSeq });
}
/** The dispatched turn runs to completion (clears the in-flight marker). */
function runTurn(log: ChatLogService, turnSeq = 1) {
  startTurn(log, turnSeq);
  endTurn(log, turnSeq);
}

describe('ChatCommands', () => {
  it('send logs user_message before dispatching, with the chat settings', async () => {
    const { store, log, d, cmds } = mk();
    // No chat yet: settings needs an existing chat.
    expect((await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's0', settings: { model: 'x' } })).ok).toBe(false);
    let seenAtDispatch: string[] = [];
    (d.send as any).mockImplementation(() => {
      seenAtDispatch = store.state('c1')!.messages.map((m) => m.id);
    });
    const r = await cmds.run(send('u1', 'hello', { promptOverride: '[File: a.ts]\n\nhello', imagePaths: ['/tmp/i.png'], images: ['data:x'] }));
    expect(r).toMatchObject({ clientId: 'u1', ok: true, duplicate: false });
    expect(typeof r.seq).toBe('number');
    expect(seenAtDispatch).toEqual(['u1']);
    const msg = store.state('c1')!.messages[0];
    expect(msg).toMatchObject({ id: 'u1', role: 'user', content: 'hello', images: ['data:x'] });
    expect(d.send).toHaveBeenCalledTimes(1);
    const [provider, args] = (d.send as any).mock.calls[0];
    expect(provider).toBe('claude');
    expect(args).toMatchObject({ projectPath: P, scope: 'c1', prompt: '[File: a.ts]\n\nhello', imagePaths: ['/tmp/i.png'], origin: 'desktop' });
    expect(args.settings.provider).toBe('claude');

    runTurn(log);
    // Settings set on the chat ride the next dispatch.
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1', settings: { model: 'opus', effort: 'high' } });
    await cmds.run(send('u2', 'again'));
    expect((d.send as any).mock.calls[1][1].settings).toMatchObject({ provider: 'claude', model: 'opus', effort: 'high' });
  });

  it('duplicate clientId is acked, not re-sent', async () => {
    const { store, d, cmds } = mk();
    const a = await cmds.run(send('u1', 'hello'));
    const b = await cmds.run(send('u1', 'hello'));
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(a.duplicate).toBe(false);
    expect(b).toMatchObject({ clientId: 'u1', ok: true, duplicate: true, seq: a.seq });
    expect(store.state('c1')!.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('send while busy queues (queue_added) and does not dispatch', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log);
    d.setBusy(true);
    const r = await cmds.run(send('u2', 'second'));
    expect(r.ok).toBe(true);
    expect(d.send).toHaveBeenCalledTimes(1);
    const st = store.state('c1')!;
    expect(st.queue.map((q) => q.clientId)).toEqual(['u2']);
    expect(st.queue[0].text).toBe('second');
    // The bubble is logged at queue time.
    expect(st.messages.map((m) => m.id)).toContain('u2');
  });

  it('turn end drains exactly one queued item in order', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'second', { promptOverride: 'P2' }));
    await cmds.run(send('u3', 'third'));
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2', 'u3']);

    d.setBusy(false);
    endTurn(log, 1);
    await tick();
    expect(d.send).toHaveBeenCalledTimes(2);
    expect((d.send as any).mock.calls[1][1].prompt).toBe('P2');
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u3']);
    // Drains don't log the user message again.
    expect(store.state('c1')!.messages.filter((m) => m.id === 'u2')).toHaveLength(1);

    startTurn(log, 2);
    endTurn(log, 2);
    await tick();
    expect(d.send).toHaveBeenCalledTimes(3);
    expect((d.send as any).mock.calls[2][1].prompt).toBe('third');
    expect(store.state('c1')!.queue).toEqual([]);
  });

  it('send with now:true while busy stops then dispatches, queue untouched', async () => {
    const { store, log, d, calls, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'queued'));
    (d.stop as any).mockImplementation((p: string, projectPath: string, scope: string) => {
      calls.push(['stop', p, projectPath, scope]);
      d.setBusy(false);
      endTurn(log, 1); // the stop's own done must not drain the queue
    });
    await cmds.run(send('u3', 'now please', { now: true }));
    await tick();
    const kinds = calls.map((c) => c[0]);
    expect(kinds).toEqual(['send', 'stop', 'send']);
    expect((calls[2][2] as any).prompt).toBe('now please');
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);

    // The now-turn's end drains the queue as usual.
    startTurn(log, 2);
    endTurn(log, 2);
    await tick();
    expect(d.send).toHaveBeenCalledTimes(3);
    expect((d.send as any).mock.calls[2][1].prompt).toBe('queued');
  });

  it('send while load-paused queues', async () => {
    const { store, log, d, cmds } = mk();
    d.setPaused(true);
    await cmds.run(send('u1', 'held'));
    expect(d.send).not.toHaveBeenCalled();
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u1']);
    // A turn end while still paused leaves it queued.
    startTurn(log);
    endTurn(log);
    await tick();
    expect(d.send).not.toHaveBeenCalled();
    expect(store.state('c1')!.queue).toHaveLength(1);
    // Resume drains it.
    d.setPaused(false);
    cmds.onLoadResumed();
    await tick();
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(store.state('c1')!.queue).toEqual([]);
  });

  it('remote settings are capped by the remote ceiling, in the provider\'s own vocabulary', async () => {
    const { store, log, d, cmds } = mk({ ceiling: 'always-ask' });
    await cmds.run(send('u1', 'hi'));
    runTurn(log);
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1', origin: 'remote', settings: { permMode: 'bypass', model: 'm' } });
    expect(store.state('c1')!.settings).toMatchObject({ permMode: 'default', model: 'm' });
    // A permission the ceiling allows is stored as is (never rewritten to the ceiling's name).
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1b', origin: 'remote', settings: { permMode: 'default' } });
    expect(store.state('c1')!.settings.permMode).toBe('default');
    // Desktop settings are not capped.
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's2', settings: { permMode: 'bypass' } });
    expect(store.state('c1')!.settings.permMode).toBe('bypass');
    // A remote send dispatches capped settings; the chat's stored settings stay the desktop's.
    await cmds.run(send('u2', 'x', { origin: 'remote' }));
    const last = (d.send as any).mock.calls.at(-1)[1];
    expect(last.origin).toBe('remote');
    expect(last.settings.permMode).toBe('default');
    expect(store.state('c1')!.settings.permMode).toBe('bypass');
  });

  it('remote codex read-only is never raised by the ceiling', async () => {
    const { store, cmds } = mk({ ceiling: 'auto', provider: 'codex' });
    await cmds.run(send('u1', 'hi'));
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1', origin: 'remote', settings: { permMode: 'read-only' } });
    expect(store.state('c1')!.settings.permMode).toBe('read-only');
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's2', origin: 'remote', settings: { permMode: 'full-access' } });
    expect(store.state('c1')!.settings.permMode).toBe('auto');
  });

  it('approve/answer/planReview/interrupt dispatch once per clientId', async () => {
    const { d, cmds } = mk();
    await cmds.run(send('u1', 'hi'));
    const approve = { kind: 'approve' as const, chatId: 'c1', clientId: 'a1', toolUseId: 't1', approved: true, modifiedCommand: 'ls' };
    const answer = { kind: 'answer' as const, chatId: 'c1', clientId: 'a2', toolUseId: 't2', answers: { q: 'yes' } };
    const plan = { kind: 'planReview' as const, chatId: 'c1', clientId: 'a3', toolUseId: 't3', approved: false };
    const intr = { kind: 'interrupt' as const, chatId: 'c1', clientId: 'a4' };
    for (const c of [approve, answer, plan, intr]) {
      expect((await cmds.run(c)).duplicate).toBe(false);
      expect((await cmds.run(c)).duplicate).toBe(true);
    }
    expect(d.approve).toHaveBeenCalledTimes(1);
    expect(d.approve).toHaveBeenCalledWith('claude', { projectPath: P, scope: 'c1', toolUseId: 't1', approved: true, modifiedCommand: 'ls' });
    expect(d.answer).toHaveBeenCalledTimes(1);
    expect(d.answer).toHaveBeenCalledWith({ projectPath: P, scope: 'c1', toolUseId: 't2', answers: { q: 'yes' } });
    expect(d.planReview).toHaveBeenCalledTimes(1);
    expect(d.planReview).toHaveBeenCalledWith({ projectPath: P, scope: 'c1', toolUseId: 't3', approved: false });
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(d.stop).toHaveBeenCalledWith('claude', P, 'c1');
  });

  it('routes to the provider in chat settings (codex chat → dispatch.send("codex"))', async () => {
    const { log, d, cmds } = mk({ provider: 'codex' });
    await cmds.run(send('u1', 'hi'));
    expect((d.send as any).mock.calls[0][0]).toBe('codex');
    runTurn(log);
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1', settings: { provider: 'kimi' } });
    await cmds.run(send('u2', 'hi'));
    expect((d.send as any).mock.calls[1][0]).toBe('kimi');
    await cmds.run({ kind: 'interrupt', chatId: 'c1', clientId: 'i1' });
    expect(d.stop).toHaveBeenCalledWith('kimi', P, 'c1');
  });

  it('queueRemove and queueClear log events', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log);
    d.setBusy(true);
    await cmds.run(send('u2', 'a'));
    await cmds.run(send('u3', 'b'));
    await cmds.run(send('u4', 'c'));
    const r = await cmds.run({ kind: 'queueRemove', chatId: 'c1', clientId: 'q1', target: 'u3' });
    expect(r.ok).toBe(true);
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2', 'u4']);
    const c = await cmds.run({ kind: 'queueClear', chatId: 'c1', clientId: 'q2' });
    expect(c.ok).toBe(true);
    expect(store.state('c1')!.queue).toEqual([]);
    const types = store.read('c1', 0).entries.map((e) => e.ev.type);
    expect(types).toContain('queue_removed');
    expect(types).toContain('queue_cleared');
  });

  it('a Claude send produces exactly one user_message entry even with the backend echo', async () => {
    const { store, log, d, cmds } = mk();
    (d.send as any).mockImplementation((_p: string, a: { projectPath: string; scope: string; prompt: string }) => {
      // The backend's own user_message emit, stamped logged:true by the real dispatch.
      log.record({ type: 'user_message', projectPath: a.projectPath, scope: a.scope, text: a.prompt, origin: 'desktop', logged: true });
    });
    await cmds.run(send('u1', 'hello'));
    const ums = store.read('c1', 0).entries.filter((e) => e.ev.type === 'user_message');
    expect(ums).toHaveLength(1);
    expect(ums[0].ev.clientId).toBe('u1');
  });

  it('rejects a command without a chatId or clientId', async () => {
    const { cmds } = mk();
    expect((await cmds.run({ ...send('', 'x') })).ok).toBe(false);
    expect((await cmds.run({ ...send('u1', 'x'), chatId: '' })).ok).toBe(false);
  });

  it('async provider: concurrent drains dispatch once (in-flight counts as busy)', async () => {
    const { store, log, d, cmds } = mk();
    // isBusy only flips true after an await, like codex (getModels) or kimi (transport/session).
    (d.send as any).mockImplementation(() => { setTimeout(() => d.setBusy(true), 10); });
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'a'));
    await cmds.run(send('u3', 'b'));
    d.setBusy(false);
    endTurn(log, 1);          // schedules a drain
    cmds.onLoadResumed();     // and another (coalesced)
    await tick();
    expect(d.send).toHaveBeenCalledTimes(2);
    // Another drain before the backend reports busy: in-flight blocks it.
    cmds.onLoadResumed();
    await tick();
    expect(d.send).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 20));
    expect(d.send).toHaveBeenCalledTimes(2);
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u3']);
  });

  it('two rapid idle sends to an async provider: the second queues', async () => {
    const { store, d, cmds } = mk();
    await cmds.run(send('u1', 'a'));
    await cmds.run(send('u2', 'b'));
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);
  });

  it('a stale stop done after the send-now turn started does not eat that turn\'s drain', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'queued'));
    // Kimi-style: stop's done arrives asynchronously, after the new turn starts.
    (d.stop as any).mockImplementation(() => {});
    (d.send as any).mockImplementation(() => {
      log.record({ type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 2 });
    });
    await cmds.run(send('u3', 'now', { now: true }));
    log.record({ type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 }); // stale: ignored by the reducer
    expect(store.state('c1')!.turn.streaming).toBe(true);
    d.setBusy(false);
    endTurn(log, 2);
    await tick();
    expect(d.send).toHaveBeenCalledTimes(3);
    expect((d.send as any).mock.calls[2][1].prompt).toBe('queued');
  });

  it('a drain blocked by a busy backend with no open turn retries until it is idle', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'queued'));
    endTurn(log, 1); // log closed, backend still finishing
    await tick();
    expect(d.send).toHaveBeenCalledTimes(1);
    d.setBusy(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(d.send).toHaveBeenCalledTimes(2);
    expect(store.state('c1')!.queue).toEqual([]);
  });

  it('startup repair leaves a persisted queue intact and dispatches nothing', async () => {
    const first = mk();
    await first.cmds.run(send('u1', 'first'));
    startTurn(first.log, 1);
    first.d.setBusy(true);
    await first.cmds.run(send('u2', 'queued'));
    first.store.close();
    // Next run: same dir, fresh service + commands, no live backend.
    const second = mk({ dir: first.dir });
    second.log.startupRepair();
    await new Promise((r) => setTimeout(r, 20));
    expect(second.store.state('c1')!.turn.streaming).toBe(false);
    expect(second.d.send).not.toHaveBeenCalled();
    expect(second.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);
  });

  it('a drain whose provider is not ready or whose dispatch throws leaves the item queued', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'queued'));
    d.setBusy(false);
    (d.send as any).mockImplementation(() => { throw new Error('no workspace'); });
    endTurn(log, 1);
    await tick();
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);
    expect(store.read('c1', 0).entries.some((e) => e.ev.type === 'queue_removed')).toBe(false);

    (d.send as any).mockImplementation(() => {});
    d.canDispatch = () => false;
    startTurn(log, 2);
    endTurn(log, 2);
    await tick();
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);
  });

  it('a send with provider:codex on a new chat creates codex meta and dispatches codex', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'hi', { provider: 'codex' }));
    expect(store.meta('c1')!.provider).toBe('codex');
    expect(store.state('c1')!.settings.provider).toBe('codex');
    expect((d.send as any).mock.calls[0][0]).toBe('codex');
    runTurn(log);
    // A different provider on an existing chat switches it before the message.
    await cmds.run(send('u2', 'hi', { provider: 'gemini' }));
    expect((d.send as any).mock.calls[1][0]).toBe('gemini');
    const types = store.read('c1', 0).entries.map((e) => e.ev.type);
    expect(types.slice(-2)).toEqual(['settings_changed', 'user_message']);
  });

  it('settings can create a chat given projectPath and provider', async () => {
    const { store, cmds } = mk();
    const r = await cmds.run({ kind: 'settings', chatId: 'c9', clientId: 's1', projectPath: P, settings: { provider: 'kimi', approvalMode: 'plan' } });
    expect(r.ok).toBe(true);
    expect(store.meta('c9')).toMatchObject({ provider: 'kimi', projectPath: P });
    expect(store.state('c9')!.settings).toMatchObject({ provider: 'kimi', approvalMode: 'plan' });
  });
});
