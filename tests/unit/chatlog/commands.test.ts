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
    compact: vi.fn((p, a) => { calls.push(['compact', p, a]); }),
    stopTask: vi.fn(async (p, a) => { calls.push(['stopTask', p, a]); return a.taskId !== 'gone'; }),
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
    opened: (id) => cmds.onChatOpened(id),
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

// Queue sends (Ctrl+Enter) by default: a plain send to a busy Claude chat joins the turn (see midTurn tests).
const send = (clientId: string, text: string, extra: Record<string, unknown> = {}) => ({
  kind: 'send' as const, chatId: 'c1', clientId, text, origin: 'desktop' as const, projectPath: P, queue: true, ...extra,
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
    // The bubble is logged at queue time, then held in the queue (not the transcript) until it drains.
    expect(store.read('c1', 0).entries.some((e) => e.ev.type === 'user_message' && e.ev.clientId === 'u2')).toBe(true);
    expect(st.messages.map((m) => m.id)).not.toContain('u2');
  });

  it('a plain send to a busy Claude chat joins the running turn (mid-turn), not the queue', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log);
    d.setBusy(true);
    await cmds.run(send('u2', 'also this', { queue: false }));
    expect(d.send).toHaveBeenCalledTimes(2);
    expect((d.send as any).mock.calls[1][1].prompt).toBe('also this');
    expect(d.stop).not.toHaveBeenCalled();
    const st = store.state('c1')!;
    expect(st.queue).toEqual([]);
    expect(st.messages.map((m) => m.id)).toContain('u2'); // the bubble shows now
  });

  it('a plain busy send still queues behind waiting items, while its own dispatch lands, and for other providers', async () => {
    // Behind waiting items: keeps their order.
    const a = mk();
    await a.cmds.run(send('u1', 'first'));
    startTurn(a.log);
    a.d.setBusy(true);
    await a.cmds.run(send('u2', 'queued'));
    await a.cmds.run(send('u3', 'plain', { queue: false }));
    expect(a.d.send).toHaveBeenCalledTimes(1);
    expect(a.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2', 'u3']);

    // Dispatched but no streaming_start yet: a second dispatch would race the first.
    const b = mk();
    await b.cmds.run(send('u1', 'first'));
    b.d.setBusy(true);
    await b.cmds.run(send('u2', 'plain', { queue: false }));
    expect(b.d.send).toHaveBeenCalledTimes(1);
    expect(b.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);

    // Codex has no mid-turn input.
    const c = mk();
    await c.cmds.run(send('u1', 'first', { provider: 'codex' }));
    startTurn(c.log);
    c.d.setBusy(true);
    await c.cmds.run(send('u2', 'plain', { queue: false }));
    expect(c.d.send).toHaveBeenCalledTimes(1);
    expect(c.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);
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
    // Each send's late flip is captured and fired explicitly, so a slow runner can't reorder it.
    const flips: Array<() => void> = [];
    (d.send as any).mockImplementation(() => { flips.push(() => d.setBusy(true)); });
    await cmds.run(send('u1', 'first'));
    flips.shift()!();         // the first send's backend reports busy
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
    // Then the drained send's backend reports busy: still nothing more dispatched.
    expect(flips).toHaveLength(1);
    flips.shift()!();
    cmds.onLoadResumed();
    await tick();
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

  it('startup repair drains a persisted queue for the chats it closes (R16)', async () => {
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
    expect(second.d.send).toHaveBeenCalledTimes(1);
    expect((second.d.send as any).mock.calls[0][1]).toMatchObject({ projectPath: P, scope: 'c1', prompt: 'queued' });
    expect(second.store.state('c1')!.queue).toEqual([]);
    expect(second.store.state('c1')!.messages.map((m) => m.id)).toEqual(['u1', 'u2']);
  });

  it('startup repair: a provider with no workspace yet keeps its queue through the bounded retry', async () => {
    const first = mk();
    await first.cmds.run(send('u1', 'first'));
    startTurn(first.log, 1);
    first.d.setBusy(true);
    await first.cmds.run(send('u2', 'queued'));
    first.store.close();
    const second = mk({ dir: first.dir });
    let ready = false;
    second.d.canDispatch = () => ready;
    second.log.startupRepair();
    await new Promise((r) => setTimeout(r, 10));
    expect(second.d.send).not.toHaveBeenCalled();
    expect(second.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);
    // The workspace appears while the backoff is still polling: the retry dispatches it.
    ready = true;
    await new Promise((r) => setTimeout(r, 300));
    expect(second.d.send).toHaveBeenCalledTimes(1);
    expect(second.store.state('c1')!.queue).toEqual([]);
  });

  it('resumeQueues drains persisted queues of chats with no open turn at startup (R16)', async () => {
    const first = mk();
    first.d.setPaused(true);
    await first.cmds.run(send('u1', 'held a'));
    await first.cmds.run(send('u2', 'held b'));
    await first.cmds.run({ kind: 'settings', chatId: 'c2', clientId: 's-c2', projectPath: P, settings: { provider: 'codex' } });
    expect(first.store.meta('c1')!.openTurn).toBe(false);
    expect(first.store.queuedChatIds()).toEqual(['c1']);
    first.store.close();

    const second = mk({ dir: first.dir });
    second.log.startupRepair(); // nothing open: repair wakes nothing
    await new Promise((r) => setTimeout(r, 10));
    expect(second.d.send).not.toHaveBeenCalled();
    // The persisted index finds the queue without reducing every log.
    expect(second.store.queuedChatIds()).toEqual(['c1']);
    second.cmds.resumeQueues(second.store.queuedChatIds());
    await new Promise((r) => setTimeout(r, 10));
    expect(second.d.send).toHaveBeenCalledTimes(1);
    expect((second.d.send as any).mock.calls[0][1].prompt).toBe('held a');
    // The rest waits for that turn's end, in order.
    expect(second.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u2']);
    runTurn(second.log);
    await tick();
    expect((second.d.send as any).mock.calls[1][1].prompt).toBe('held b');
    expect(second.store.queuedChatIds()).toEqual([]);
  });

  it('queuePromote moves an item to the front so it drains next', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'a'));
    await cmds.run(send('u3', 'b'));
    const r = await cmds.run({ kind: 'queuePromote', chatId: 'c1', clientId: 'p1', target: 'u3' });
    expect(r.ok).toBe(true);
    expect(store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['u3', 'u2']);
    d.setBusy(false);
    endTurn(log, 1);
    await tick();
    expect((d.send as any).mock.calls[1][1].prompt).toBe('b');
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

// R17: the Task 9 Step 5 dogfood scenarios, driven through the real store,
// service, reducer and ChatCommands with a fake provider dispatch.
describe('Task 9 dogfood scenarios (log-driven)', () => {
  it('queue three messages mid-turn: they run in order, each bubble ahead of its own reply', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'start'));
    startTurn(log, 1);
    d.setBusy(true);
    for (const [id, t] of [['q1', 'one'], ['q2', 'two'], ['q3', 'three']]) await cmds.run(send(id, t));
    expect(store.state('c1')!.queue.map((q) => q.text)).toEqual(['one', 'two', 'three']);
    expect(d.send).toHaveBeenCalledTimes(1);

    // The fake backend: busy while a turn runs; each dispatch starts the next turn synchronously.
    let turn = 1;
    (d.send as any).mockImplementation(() => { turn += 1; d.setBusy(true); startTurn(log, turn); });
    for (let i = 0; i < 3; i++) {
      log.record({ type: 'assistant', projectPath: P, scope: 'c1', turnSeq: turn, message: { content: [{ type: 'text', text: `reply ${turn}` }] } });
      d.setBusy(false);
      endTurn(log, turn);
      await tick();
    }
    const prompts = (d.send as any).mock.calls.map((c: any[]) => c[1].prompt);
    expect(prompts).toEqual(['start', 'one', 'two', 'three']);
    expect(store.state('c1')!.queue).toEqual([]);
    const transcript = store.state('c1')!.messages.map((m) => `${m.role}:${m.content}`);
    expect(transcript).toEqual([
      'user:start', 'assistant:reply 1',
      'user:one', 'assistant:reply 2',
      'user:two', 'assistant:reply 3',
      'user:three',
    ]);
  });

  it('change the model mid-chat: the next turn uses it', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's0', projectPath: P, origin: 'desktop', settings: { provider: 'claude', model: 'sonnet', permMode: 'default', effort: 'high' } });
    await cmds.run(send('u1', 'first'));
    expect((d.send as any).mock.calls[0][1].settings.model).toBe('sonnet');
    startTurn(log, 1);
    // Picked while the turn runs.
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1', origin: 'desktop', settings: { model: 'opus' } });
    expect(store.state('c1')!.settings).toMatchObject({ provider: 'claude', model: 'opus', permMode: 'default', effort: 'high' });
    endTurn(log, 1);
    await cmds.run(send('u2', 'second'));
    expect((d.send as any).mock.calls[1][1].settings).toMatchObject({ provider: 'claude', model: 'opus', effort: 'high' });
  });

  it('quit with items queued and relaunch: the queue is still there and drains on the next turn end', async () => {
    const first = mk();
    await first.cmds.run(send('u1', 'long job'));
    startTurn(first.log, 1);
    first.d.setBusy(true);
    await first.cmds.run(send('u2', 'after'));
    first.store.close();

    // Relaunch while the backend still runs that chat's turn: repair leaves it open.
    const dir = first.dir;
    const store = new ChatLogStore({ dir });
    stores.push(store);
    const log = new ChatLogService({
      store, sendToRenderer: () => {}, bus: () => null,
      liveChats: () => ['c1'], providerOf: () => 'claude', devlog: () => {},
    });
    const { d } = fakeDispatch();
    const cmds = new ChatCommands({ log, store, dispatch: d, retryBaseMs: 2, inFlightTimeoutMs: 200 });
    wire(log, cmds);
    d.setBusy(true);
    log.startupRepair();
    cmds.resumeQueues(store.queuedChatIds());
    await new Promise((r) => setTimeout(r, 20));
    // Still shown (the queue strip reads state.queue), not sent: the turn is running.
    expect(store.state('c1')!.queue.map((q) => q.text)).toEqual(['after']);
    expect(d.send).not.toHaveBeenCalled();
    d.setBusy(false);
    endTurn(log, 1);
    await tick();
    expect(d.send).toHaveBeenCalledTimes(1);
    expect((d.send as any).mock.calls[0][1].prompt).toBe('after');
    expect(store.state('c1')!.queue).toEqual([]);
  });
});

describe('Task 9 fix round 1', () => {
  it('a queued send logs its user_message marked queued (an immediate one is not)', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'later', { label: 'short' }));
    const users = store.read('c1', 0).entries.filter((e) => e.ev.type === 'user_message');
    expect(users.map((e) => [e.ev.clientId, e.ev.queued === true])).toEqual([['u1', false], ['u2', true]]);
    expect(store.state('c1')!.queue[0]).toMatchObject({ clientId: 'u2', text: 'later', label: 'short' });
    expect(store.state('c1')!.messages.map((m) => m.id)).toEqual(['u1']);
  });

  it('a paused send to a new chat is marked queued too', async () => {
    const { store, d, cmds } = mk();
    d.setPaused(true);
    await cmds.run(send('u1', 'held'));
    const [user] = store.read('c1', 0).entries.filter((e) => e.ev.type === 'user_message');
    expect(user.ev.queued).toBe(true);
    expect(store.state('c1')!.messages).toEqual([]);
  });

  it('queueRemove fails for an item no longer queued (a drained item is not sent twice)', async () => {
    const { log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    startTurn(log, 1);
    d.setBusy(true);
    await cmds.run(send('u2', 'queued'));
    d.setBusy(false);
    endTurn(log, 1);
    await tick(); // drained: u2 was sent
    const r = await cmds.run({ kind: 'queueRemove', chatId: 'c1', clientId: 'rm1', target: 'u2' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not queued/);
  });

  it('opening a chat retries a persisted queue the bounded startup retry gave up on', async () => {
    const first = mk();
    first.d.setPaused(true);
    await first.cmds.run(send('u1', 'held'));
    first.store.close();
    const second = mk({ dir: first.dir });
    let ready = false;
    second.d.canDispatch = () => ready;
    second.cmds.resumeQueues(second.store.queuedChatIds());
    await new Promise((r) => setTimeout(r, 400)); // 6 retries at 2ms base: gave up
    expect(second.d.send).not.toHaveBeenCalled();
    ready = true;
    await new Promise((r) => setTimeout(r, 50));
    expect(second.d.send).not.toHaveBeenCalled(); // nothing polls any more
    // The renderer opens the chat (chatlog:open / bindLegacyScope → opened hook).
    second.log.notifyOpened('c1');
    await tick();
    expect(second.d.send).toHaveBeenCalledTimes(1);
    expect(second.store.state('c1')!.queue).toEqual([]);
  });

  it('opening a chat with no queue dispatches nothing', async () => {
    const { log, d, cmds } = mk();
    await cmds.run(send('u1', 'first'));
    runTurn(log);
    log.notifyOpened('c1');
    log.notifyOpened('nope');
    await tick();
    expect(d.send).toHaveBeenCalledTimes(1);
  });
});

describe('ChatCommands: clear, compact, clientEvent, stopTask', () => {
  it('clear command appends cleared once per clientId', async () => {
    const { store, log, cmds } = mk();
    await cmds.run(send('u1', 'hi'));
    runTurn(log);
    expect(store.state('c1')!.messages.length).toBeGreaterThan(0);
    const first = await cmds.run({ kind: 'clear', chatId: 'c1', clientId: 'cl1' });
    expect(first.ok).toBe(true);
    const again = await cmds.run({ kind: 'clear', chatId: 'c1', clientId: 'cl1' });
    expect(again).toMatchObject({ ok: true, duplicate: true, seq: first.seq });
    expect(store.read('c1', 0).entries.filter((e) => e.ev.type === 'cleared')).toHaveLength(1);
    expect(store.state('c1')!.messages).toEqual([]);
    // An unknown chat has nothing to clear.
    expect((await cmds.run({ kind: 'clear', chatId: 'nope', clientId: 'cl2' })).ok).toBe(false);
  });

  it('compact command dispatches for claude and errors for gemini', async () => {
    const { log, d, cmds } = mk({ ceiling: 'always-ask' });
    await cmds.run(send('u1', 'hi'));
    runTurn(log);
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1', settings: { model: 'opus', permMode: 'bypass', effort: 'high' } });
    const r = await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1' });
    expect(r.ok).toBe(true);
    expect((await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1' })).duplicate).toBe(true);
    expect(d.compact).toHaveBeenCalledTimes(1);
    expect((d.compact as any).mock.calls[0][0]).toBe('claude');
    expect((d.compact as any).mock.calls[0][1]).toMatchObject({ projectPath: P, scope: 'c1', settings: { model: 'opus', permMode: 'bypass', effort: 'high' } });
    // A remote compact runs with the ceiling-capped settings.
    await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k2', origin: 'remote' });
    expect((d.compact as any).mock.calls[1][1].settings.permMode).toBe('default');

    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's2', settings: { provider: 'gemini' } });
    const g = await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k3' });
    expect(g).toMatchObject({ ok: false, error: 'compact is not supported for gemini' });
    expect(d.compact).toHaveBeenCalledTimes(2);
  });

  it('clientEvent rejects backend event types', async () => {
    const { store, cmds } = mk();
    const ce = (clientId: string, ev: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      cmds.run({ kind: 'clientEvent', chatId: 'c1', clientId, ev: ev as any, projectPath: P, ...extra });
    for (const [i, type] of ['assistant', 'result', 'done', 'streaming_start', 'approval_needed', 'cleared', 'settings_changed', 'queue_added'].entries()) {
      const r = await ce(`b${i}`, { type });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not allowed/);
    }
    // A user_message that isn't local would look sent but never dispatch.
    expect((await ce('u0', { type: 'user_message', clientId: 'm0', text: 'hi' })).error).toMatch(/must be local/);
    expect(store.meta('c1')).toBeNull();

    // The /help pair: a local user_message and its local_note (creates the chat).
    expect((await ce('h1', { type: 'user_message', clientId: 'm1', text: '/help', origin: 'desktop', local: true, queued: true }, { origin: 'remote' })).ok).toBe(true);
    expect((await ce('h2', { type: 'local_note', noteId: 'help-m1', content: 'Commands…' })).ok).toBe(true);
    expect((await ce('h2', { type: 'local_note', noteId: 'help-m1', content: 'Commands…' })).duplicate).toBe(true);
    const evs = store.read('c1', 0).entries.map((e) => e.ev);
    // Only the type's own fields are kept (no `queued`); origin is the command's.
    expect(evs[0]).toEqual({ type: 'user_message', local: true, origin: 'remote', text: '/help', clientId: 'm1' });
    expect(evs.filter((e) => e.type === 'local_note')).toHaveLength(1);
    expect(store.state('c1')!.messages.map((m) => m.id)).toEqual(['m1', 'help-m1']);
  });

  it('stopTask maps to the backend stopTask and fails when nothing stopped', async () => {
    const { d, cmds } = mk();
    await cmds.run(send('u1', 'hi'));
    expect((await cmds.run({ kind: 'stopTask', chatId: 'c1', clientId: 't1', taskId: 'bg1' })).ok).toBe(true);
    expect(d.stopTask).toHaveBeenCalledWith('claude', { projectPath: P, scope: 'c1', taskId: 'bg1' });
    expect((await cmds.run({ kind: 'stopTask', chatId: 'c1', clientId: 't1', taskId: 'bg1' })).duplicate).toBe(true);
    expect(d.stopTask).toHaveBeenCalledTimes(1);
    expect(await cmds.run({ kind: 'stopTask', chatId: 'c1', clientId: 't2', taskId: 'gone' })).toMatchObject({ ok: false, error: 'task not stopped: gone' });
  });

  it('compact while load paused queues a /compact send and does not dispatch', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'hi'));
    runTurn(log);
    d.setPaused(true);
    const r = await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1', origin: 'remote' });
    expect(r.ok).toBe(true);
    expect((await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1', origin: 'remote' })).duplicate).toBe(true);
    expect(d.compact).not.toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledTimes(1); // only u1
    expect(store.state('c1')!.queue.map((q) => [q.clientId, q.text])).toEqual([['k1', '/compact']]);
    // Resumed: the queued /compact drains as a send with the chat's settings.
    d.setPaused(false);
    cmds.onLoadResumed();
    await tick();
    expect(d.send).toHaveBeenCalledTimes(2);
    expect((d.send as any).mock.calls[1][1]).toMatchObject({ prompt: '/compact', scope: 'c1', origin: 'remote' });
    expect(d.compact).not.toHaveBeenCalled();
  });

  it('compact while turn open queues (a queued compact, like the desktop palette/Ctrl+Enter)', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'hi'));
    startTurn(log);
    d.setBusy(true);
    expect((await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1', queue: true })).ok).toBe(true);
    expect(d.compact).not.toHaveBeenCalled();
    expect(store.state('c1')!.queue.map((q) => q.text)).toEqual(['/compact']);
    // Without queue (plain Enter on the desktop) a live turn doesn't hold it.
    expect((await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k2' })).ok).toBe(true);
    expect(d.compact).toHaveBeenCalledTimes(1);
  });

  it('compact when idle dispatches', async () => {
    const { store, log, d, cmds } = mk();
    await cmds.run(send('u1', 'hi'));
    runTurn(log);
    expect((await cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1', queue: true })).ok).toBe(true);
    expect(d.compact).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(store.state('c1')!.queue).toEqual([]);
    expect(store.read('c1', 0).entries.filter((e) => e.ev.type === 'user_message')).toHaveLength(1);
  });
});

describe('ChatCommands: resend after a desktop restart (the ledger is memory-only)', () => {
  it('a send whose clientId is already a logged message is acked duplicate without dispatching', async () => {
    const first = mk();
    await first.cmds.run(send('X', 'run the migration', { origin: 'remote' }));
    runTurn(first.log);
    first.store.close();
    // Restart: same log dir, fresh store/service/commands (empty ledger).
    const second = mk({ dir: first.dir });
    const r = await second.cmds.run(send('X', 'run the migration', { origin: 'remote' }));
    expect(r).toMatchObject({ clientId: 'X', ok: true, duplicate: true });
    expect(second.d.send).not.toHaveBeenCalled();
    expect(second.store.read('c1', 0).entries.filter((e) => e.ev.type === 'user_message')).toHaveLength(1);
    // A later repeat in the same process is still a duplicate (from the ledger).
    expect((await second.cmds.run(send('X', 'run the migration', { origin: 'remote' }))).duplicate).toBe(true);
    // A new clientId still sends.
    expect((await second.cmds.run(send('Y', 'next'))).duplicate).toBe(false);
    expect(second.d.send).toHaveBeenCalledTimes(1);
  });

  it('a send whose clientId is still waiting in the logged queue is acked duplicate', async () => {
    const first = mk();
    first.d.setPaused(true);
    await first.cmds.run(send('Q', 'held', { origin: 'remote' }));
    first.store.close();
    const second = mk({ dir: first.dir });
    const r = await second.cmds.run(send('Q', 'held', { origin: 'remote' }));
    expect(r).toMatchObject({ clientId: 'Q', ok: true, duplicate: true });
    expect(second.d.send).not.toHaveBeenCalled();
    expect(second.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['Q']);
    expect(second.store.read('c1', 0).entries.filter((e) => e.ev.type === 'queue_added')).toHaveLength(1);
  });

  it('a queued /compact resent after a restart is acked duplicate', async () => {
    const first = mk();
    await first.cmds.run(send('u1', 'hi'));
    runTurn(first.log);
    first.d.setPaused(true);
    await first.cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1', origin: 'remote' });
    first.store.close();
    const second = mk({ dir: first.dir });
    second.d.setPaused(true);
    expect(await second.cmds.run({ kind: 'compact', chatId: 'c1', clientId: 'k1', origin: 'remote' })).toMatchObject({ ok: true, duplicate: true });
    expect(second.store.state('c1')!.queue.map((q) => q.clientId)).toEqual(['k1']);
  });
});

describe('ChatCommands: clientEvent payload validation', () => {
  const run = { status: 'completed', conclusion: 'success', name: 'CI', displayTitle: 'fix', runNumber: 7, runAttempt: 1, headBranch: 'main', headSha: 'abcdef1234', event: 'push', actor: 'me', htmlUrl: 'https://github.com/o/r/actions/runs/1', startedAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:01:00Z' };
  const job = { id: 1, name: 'build', status: 'completed', conclusion: 'success', startedAt: '2026-11-19T00:00:00Z', completedAt: '2026-11-19T00:01:00Z', steps: [{ name: 'checkout', status: 'completed', conclusion: 'success', number: 1 }], needs: ['lint'], level: 0 };
  const snap = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
    url: 'https://github.com/o/r/actions/runs/1', kind: 'run', phase: 'success', capturedAt: 123,
    data: { ...run, __jobs: [job], ...data }, ...over,
  });
  async function withMessage() {
    const t = mk();
    await t.cmds.run(send('u1', 'watch it'));
    runTurn(t.log);
    const ce = (clientId: string, ev: Record<string, unknown>) =>
      t.cmds.run({ kind: 'clientEvent', chatId: 'c1', clientId, ev: ev as any, origin: 'remote' });
    return { ...t, ce };
  }

  it('accepts a well-formed watcher_snapshot and keeps only known fields', async () => {
    const { store, ce } = await withMessage();
    const r = await ce('w1', { type: 'watcher_snapshot', messageId: 'u1', snapshot: { ...snap({}, { evil: { x: 1 } }), extra: 1 } });
    expect(r.ok).toBe(true);
    const ev = store.read('c1', 0).entries.map((e) => e.ev).find((e) => e.type === 'watcher_snapshot') as any;
    expect(ev.snapshot).toEqual(snap());
  });

  it.each([
    ['non-string url', snap({ url: 42 })],
    ['missing phase', snap({ phase: undefined })],
    ['unknown phase', snap({ phase: 'exploded' })],
    ['non-number capturedAt', snap({ capturedAt: 'now' })],
    ['non-object data', snap({ data: 'x' })],
    ['object run name', snap({}, { name: { toString: 1 } })],
    ['numeric headSha', snap({}, { headSha: 1234567 })],
    ['jobs not an array', snap({}, { __jobs: { 0: job } })],
    ['job without steps', snap({}, { __jobs: [{ ...job, steps: undefined }] })],
    ['step with object name', snap({}, { __jobs: [{ ...job, steps: [{ name: {}, status: 'completed', conclusion: null, number: 1 }] }] })],
    ['needs not strings', snap({}, { __jobs: [{ ...job, needs: [1] }] })],
  ])('rejects a watcher_snapshot with %s', async (_label, bad) => {
    const { store, ce } = await withMessage();
    const r = await ce('w1', { type: 'watcher_snapshot', messageId: 'u1', snapshot: bad });
    expect(r.ok).toBe(false);
    expect(store.read('c1', 0).entries.some((e) => e.ev.type === 'watcher_snapshot')).toBe(false);
  });

  it('local_note.error keeps only its typed fields and rejects a malformed error', async () => {
    const { store, ce } = await withMessage();
    expect((await ce('n1', { type: 'local_note', noteId: 'e1', content: 'boom', error: { title: 'Overloaded', message: 'boom', status: 529, requestId: 'req_1', evil: { a: 1 } } })).ok).toBe(true);
    const ev = store.read('c1', 0).entries.map((e) => e.ev).find((e) => e.type === 'local_note') as any;
    expect(ev.error).toEqual({ title: 'Overloaded', message: 'boom', status: 529, requestId: 'req_1' });
    for (const [i, error] of [{ message: 5 }, { title: 'x' }, { message: 'm', title: {} }, { message: 'm', status: '529' }, 'boom'].entries()) {
      const r = await ce(`bad${i}`, { type: 'local_note', noteId: `b${i}`, content: 'x', error });
      expect(r.ok).toBe(false);
    }
    expect(store.read('c1', 0).entries.filter((e) => e.ev.type === 'local_note')).toHaveLength(1);
  });
});
