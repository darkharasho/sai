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

function mk(opts: { ceiling?: 'auto' | 'auto-read' | 'always-ask' | null; provider?: ChatSettings['provider'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcmd-'));
  dirs.push(dir);
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
  const cmds = new ChatCommands({ log, store, dispatch: d, getRemoteCeiling: () => opts.ceiling ?? null });
  log.setOnTurnEnded((chatId) => cmds.onTurnEnded(chatId));
  return { store, log, d, calls, cmds };
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

describe('ChatCommands', () => {
  it('send logs user_message before dispatching, with the chat settings', async () => {
    const { store, d, cmds } = mk();
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

  it('remote settings are capped by the remote ceiling', async () => {
    const { store, d, cmds } = mk({ ceiling: 'always-ask' });
    await cmds.run(send('u1', 'hi'));
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's1', origin: 'remote', settings: { permMode: 'auto', model: 'm' } });
    expect(store.state('c1')!.settings).toMatchObject({ permMode: 'always-ask', model: 'm' });
    // Desktop settings are not capped.
    await cmds.run({ kind: 'settings', chatId: 'c1', clientId: 's2', settings: { permMode: 'auto' } });
    expect(store.state('c1')!.settings.permMode).toBe('auto');
    // A remote send dispatches with origin remote (the backend clamps too).
    await cmds.run(send('u2', 'x', { origin: 'remote' }));
    expect((d.send as any).mock.calls.at(-1)[1].origin).toBe('remote');
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
    const { d, cmds } = mk({ provider: 'codex' });
    await cmds.run(send('u1', 'hi'));
    expect((d.send as any).mock.calls[0][0]).toBe('codex');
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
});
