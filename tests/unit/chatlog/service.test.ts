// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatLogStore } from '../../../electron/services/chatlog/store';
import { ChatLogService, liveChatIds, type ChatLogServiceOpts } from '../../../electron/services/chatlog/service';
import { SessionBus } from '../../../electron/services/remote/session-bus';
import type { ChatLogEntry } from '../../../src/lib/chat/types';
import { assistant, toolUse, toolResult } from '../chat/helpers';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mk(over: Partial<ChatLogServiceOpts> = {}) {
  const store = new ChatLogStore({ dir: tmp() });
  stores.push(store);
  const sent: ChatLogEntry[] = [];
  const bus = new SessionBus();
  const devlog = vi.fn();
  const live = new Map<string, string[]>();
  const svc = new ChatLogService({
    store,
    sendToRenderer: (_ch, e) => { sent.push(e); },
    bus: () => bus,
    liveChats: (provider) => live.get(provider) ?? [],
    providerOf: () => 'claude',
    devlog,
    ...over,
  });
  return { svc, store, sent, bus, devlog, live };
}

describe('ChatLogService.record', () => {
  it('records a scoped event, assigns seq, sends chatlog:event and publishes chatlog:<id>', () => {
    const { svc, store, sent, bus } = mk();
    const published: unknown[] = [];
    bus.subscribe('chatlog:c1', (e) => published.push(e));
    const out = svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ chatId: 'c1', seq: 1, ev: { type: 'streaming_start' } });
    expect(sent).toEqual(out);
    expect(published).toEqual(out);
    expect(store.meta('c1')).toMatchObject({ projectPath: '/p', provider: 'claude', headSeq: 1 });
  });

  it('concurrent chats get independent seqs', () => {
    const { svc } = mk();
    const seqs: Array<[string, number]> = [];
    for (const scope of ['c1', 'c2', 'c1', 'c1', 'c2']) {
      const [e] = svc.record({ type: 'status', projectPath: '/p', scope });
      seqs.push([e.chatId, e.seq]);
    }
    expect(seqs).toEqual([['c1', 1], ['c2', 1], ['c1', 2], ['c1', 3], ['c2', 2]]);
  });

  it("'*' load_guard fans out to liveChats with one entry each, same card id", () => {
    const { svc, store, live } = mk();
    svc.record({ type: 'status', projectPath: '/p', scope: 'c1' });
    svc.record({ type: 'status', projectPath: '/p', scope: 'c2' });
    live.set('kimi', ['c1', 'c2', 'c1']);
    const msg = { type: 'load_guard', id: 'lg-1', projectPath: '/p', scope: '*', provider: 'kimi', loadGuard: { kind: 'killed' } };
    const out = svc.record(msg);
    expect(out.map(e => e.chatId).sort()).toEqual(['c1', 'c2']);
    expect(out.every(e => (e.ev as any).id === 'lg-1')).toBe(true);
    // The same card re-emitted is deduped by id.
    expect(svc.record(msg)).toEqual([]);
    expect(store.meta('c1')!.headSeq).toBe(2);
  });

  it("'*' skips live scopes that have no chat in the log", () => {
    const { svc, store, live } = mk();
    live.set('codex', ['ghost']);
    expect(svc.record({ type: 'load_guard', id: 'x', projectPath: '*', scope: '*', provider: 'codex' })).toEqual([]);
    expect(store.meta('ghost')).toBeNull();
  });

  it("'chat' scope routes to the bound chat id, matched through a symlinked projectPath", () => {
    const { svc, store } = mk();
    const real = tmp();
    const link = path.join(tmp(), 'link');
    fs.symlinkSync(real, link);
    svc.bindLegacyScope(link, 'c9');
    const out = svc.record({ type: 'status', projectPath: real, scope: 'chat' });
    expect(out).toHaveLength(1);
    expect(out[0].chatId).toBe('c9');
    expect(store.meta('c9')!.projectPath).toBe(real);
  });

  it("unbound 'chat' scope is dropped with a chatlog.unroutable devlog", () => {
    const { svc, devlog } = mk();
    expect(svc.record({ type: 'status', projectPath: '/p' })).toEqual([]);
    expect(devlog).toHaveBeenCalledWith('chatlog.unroutable', expect.objectContaining({ type: 'status', projectPath: '/p', scope: 'chat' }));
  });

  it('prefers a valid msg.provider over providerOf for a new chat', () => {
    const { svc, store } = mk({ providerOf: () => 'claude' });
    svc.record({ type: 'status', projectPath: '/p', scope: 'c1', provider: 'codex' });
    expect(store.meta('c1')!.provider).toBe('codex');
  });

  it('skips a user_message the command path already logged (logged: true); v1 delivery is not its job', () => {
    const { svc, store, sent } = mk();
    svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    expect(svc.record({ type: 'user_message', projectPath: '/p', scope: 'c1', text: 'hi', logged: true })).toEqual([]);
    expect(store.read('c1', 0).entries.map(e => e.ev.type)).toEqual(['streaming_start']);
    expect(sent).toHaveLength(1);
    // An unlogged one (legacy desktop/v1 path) is still recorded.
    expect(svc.record({ type: 'user_message', projectPath: '/p', scope: 'c1', text: 'hi' })).toHaveLength(1);
  });

  it('turn hooks: started on streaming_start, ended once on the flip, idleDone on a done with no open turn', () => {
    const { svc } = mk();
    const ended: string[] = [];
    const started: string[] = [];
    const idle: string[] = [];
    svc.setTurnHooks({
      started: (id) => started.push(id),
      ended: (id, ev) => ended.push(`${id}:${ev.type}`),
      idleDone: (id) => idle.push(id),
    });
    svc.record({ type: 'done', projectPath: '/p', scope: 'c1', turnSeq: null });
    expect(ended).toEqual([]); // not streaming: no flip
    expect(idle).toEqual(['c1']);
    svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    expect(started).toEqual(['c1']);
    svc.record({ type: 'status', projectPath: '/p', scope: 'c1' });
    expect(ended).toEqual([]);
    svc.record({ type: 'done', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    expect(ended).toEqual(['c1:done']);
    svc.record({ type: 'done', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    expect(ended).toEqual(['c1:done']);
    expect(idle).toEqual(['c1', 'c1']);
  });

  it('a throwing turn hook never breaks recording', () => {
    const { svc, devlog } = mk();
    svc.setTurnHooks({ ended: () => { throw new Error('boom'); } });
    svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    expect(svc.record({ type: 'done', projectPath: '/p', scope: 'c1', turnSeq: 1 })).toHaveLength(1);
    expect(devlog).toHaveBeenCalledWith('chatlog.turnHookError', expect.objectContaining({ chatId: 'c1' }));
  });
});

describe('ChatLogService.appendClient', () => {
  it('appendClient rejects backend event types (e.g. assistant)', () => {
    const { svc } = mk();
    svc.record({ type: 'status', projectPath: '/p', scope: 'c1' });
    expect(() => svc.appendClient('c1', { type: 'assistant', message: { content: [] } })).toThrow(/client event/);
  });

  it('appends a client event and fans it out', () => {
    const { svc, sent } = mk();
    svc.record({ type: 'status', projectPath: '/p', scope: 'c1' });
    const e = svc.appendClient('c1', { type: 'user_message', clientId: 'u1', text: 'hi' });
    expect(e.seq).toBe(2);
    expect(sent.at(-1)).toEqual(e);
  });

  it('creates a chat from an init projectPath', () => {
    const { svc, store } = mk();
    svc.appendClient('c5', { type: 'user_message', clientId: 'u1', text: 'hi' }, { projectPath: '/p', provider: 'kimi' });
    expect(store.meta('c5')).toMatchObject({ projectPath: '/p', provider: 'kimi' });
  });
});

describe('ChatLogService.startupRepair', () => {
  it('startup repair closes open turns with no live backend', () => {
    const { svc, store, sent } = mk();
    svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    expect(store.state('c1')!.turn.streaming).toBe(true);
    svc.startupRepair();
    expect(store.state('c1')!.turn.streaming).toBe(false);
    expect(sent.at(-1)!.ev).toEqual({ type: 'done', turnSeq: null, reason: 'app_restart', subagentsAborted: true });
    expect(store.openTurnChatIds()).toEqual([]);
  });

  it('startup repair clears child activity the dead run left behind', () => {
    const { svc, store } = mk();
    svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    svc.record({ type: 'subagent_activity', projectPath: '/p', scope: 'c1', agentId: 'a1', status: 'running', turnSeq: 1 });
    expect(Object.keys(store.state('c1')!.activeSubagents)).toEqual(['a1']);
    svc.startupRepair();
    expect(store.state('c1')!.activeSubagents).toEqual({});
  });

  it('startup repair leaves chats with a live backend alone', () => {
    const { svc, store, live } = mk();
    svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c1', turnSeq: 1 });
    live.set('claude', ['c1']);
    svc.startupRepair();
    expect(store.state('c1')!.turn.streaming).toBe(true);
    expect(store.meta('c1')!.headSeq).toBe(1);
  });
});

describe('ChatLogService delivery isolation', () => {
  it('a throwing renderer send or bus subscriber does not stop the append', () => {
    const { svc, store } = mk({ sendToRenderer: () => { throw new Error('window gone'); } });
    expect(svc.record({ type: 'status', projectPath: '/p', scope: 'c1' })).toHaveLength(1);
    expect(store.meta('c1')!.headSeq).toBe(1);
  });
});

describe('ChatLogService GC references', () => {
  it('collects image basenames and model version keys from logs and snapshots', () => {
    const { svc, store } = mk();
    const img = 'a'.repeat(32) + '.png';
    const key = 'b'.repeat(32);
    svc.record({
      type: 'user', projectPath: '/p', scope: 'c1',
      message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { type: 'sai-file', path: `/home/u/tool-result-images/${img}` } }] }] },
    });
    svc.record({ type: 'streaming_start', projectPath: '/p', scope: 'c2', turnSeq: 1 });
    svc.record({ ...assistant(1, toolUse('t1', 'mcp__sai__sai_render_model', { path: 'x.glb' })), projectPath: '/p', scope: 'c2' });
    svc.record({ ...toolResult(1, 't1', JSON.stringify({ ok: true, model: { versionKey: key, path: 'x.glb' } })), projectPath: '/p', scope: 'c2' });
    svc.record({ type: 'done', projectPath: '/p', scope: 'c2', turnSeq: 1 });
    store.compact('c2');
    // After compaction the key lives only in the snapshot.
    expect(fs.readFileSync(path.join(store['dir'], 'c2.jsonl'), 'utf8')).toBe('');
    expect(svc.referencedImageFiles()).toEqual([img]);
    expect(svc.referencedModelKeys()).toEqual([key]);
  });
});

describe('liveChatIds', () => {
  it('filters by realpath project and maps the legacy chat scope', () => {
    const real = tmp();
    const link = path.join(tmp(), 'link');
    fs.symlinkSync(real, link);
    const entries = [
      { projectPath: real, scope: 'c1' },
      { projectPath: real, scope: 'chat' },
      { projectPath: '/elsewhere', scope: 'c3' },
    ];
    const legacy = (p: string) => (p === real ? 'c2' : null);
    expect(liveChatIds(entries, link, legacy).sort()).toEqual(['c1', 'c2']);
    expect(liveChatIds(entries, '*', legacy).sort()).toEqual(['c1', 'c2', 'c3']);
  });
});
