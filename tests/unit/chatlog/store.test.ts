// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatLogStore } from '../../../electron/services/chatlog/store';
import { emptyChatState, reduceMany } from '../../../src/lib/chat/reducer';
import type { ChatEvent, ChatLogEntry } from '../../../src/lib/chat/types';
import { delta, assistant } from '../chat/helpers';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-'));
  dirs.push(d);
  return d;
}
function mk(dir = tmp(), opts: Partial<ConstructorParameters<typeof ChatLogStore>[0]> = {}) {
  const s = new ChatLogStore({ dir, ...opts });
  stores.push(s);
  return { s, dir };
}
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const init = { projectPath: '/proj', provider: 'claude' as const };
const um = (t: string): ChatEvent => ({ type: 'user_message', text: t });
const dl = (t: string): ChatEvent => assistant(1, delta(t));
const done: ChatEvent = { type: 'done' };

describe('ChatLogStore', () => {
  it('assigns seq 1..n per chat, independently per chat', () => {
    const { s } = mk();
    expect(s.append('c1', um('a'), init).seq).toBe(1);
    expect(s.append('c1', um('b')).seq).toBe(2);
    expect(s.append('c2', um('a'), init).seq).toBe(1);
  });

  it('read(after) returns entries with seq > after and headSeq', () => {
    const { s } = mk();
    for (let i = 0; i < 4; i++) s.append('c1', um('m' + i), init);
    const r = s.read('c1', 2);
    expect(r.entries.map(e => e.seq)).toEqual([3, 4]);
    expect(r.headSeq).toBe(4);
    expect(r.snapshot).toBeNull();
    expect(r.meta?.chatId).toBe('c1');
  });

  it('appends survive a new store instance after flush()', () => {
    const { s, dir } = mk();
    for (let i = 0; i < 5; i++) s.append('c1', um('m' + i), init);
    s.flush();
    const { s: s2 } = mk(dir);
    expect(s2.read('c1', 0).entries.length).toBe(5);
    expect(s2.meta('c1')?.projectPath).toBe('/proj');
    expect(s2.append('c1', um('x')).seq).toBe(6);
  });

  it('buffered deltas survive flush on close', () => {
    const { s, dir } = mk(undefined, { flushMs: 100000 });
    s.append('c1', um('hi'), init);
    for (let i = 0; i < 50; i++) s.append('c1', dl('d' + i));
    s.close();
    const { s: s2 } = mk(dir);
    expect(s2.read('c1', 0).entries.length).toBe(51);
    expect(s2.read('c1', 0).headSeq).toBe(51);
  });

  it('non-delta events are written synchronously', () => {
    const { s, dir } = mk(undefined, { flushMs: 100000 });
    s.append('c1', dl('a'), init);
    s.append('c1', done);
    const raw = fs.readFileSync(path.join(dir, 'c1.jsonl'), 'utf8').trim().split('\n');
    expect(raw.length).toBe(2);
    expect(JSON.parse(raw[1]).ev.type).toBe('done');
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    expect(idx.c1.headSeq).toBe(2);
  });

  it('compaction folds and truncates', () => {
    const { s, dir } = mk(undefined, { compactAfter: 500, now: () => 5000 });
    s.append('c1', um('start'), init);
    for (let i = 0; i < 599; i++) s.append('c1', dl('w'));
    s.append('c1', done);
    expect(fs.readFileSync(path.join(dir, 'c1.jsonl'), 'utf8')).toBe('');
    const m = s.meta('c1')!;
    expect(m.snapshotSeq).toBe(m.headSeq);
    expect(m.headSeq).toBe(601);
    const all: ChatLogEntry[] = [];
    // Rebuild the expected state from an uncompacted store.
    const { s: ref } = mk(undefined, { compactAfter: 1e9, now: () => 5000 });
    ref.append('c1', um('start'), init);
    for (let i = 0; i < 599; i++) ref.append('c1', dl('w'));
    ref.append('c1', done);
    all.push(...ref.read('c1', 0).entries);
    expect(s.state('c1')).toEqual(reduceMany(emptyChatState({ provider: 'claude' }), all));
    // A fresh instance rebuilds the same state from the snapshot.
    s.close();
    const { s: s2 } = mk(dir);
    expect(s2.state('c1')!.lastSeq).toBe(601);
    expect(s2.state('c1')!.messages.length).toBe(s.state('c1')!.messages.length);
    expect(s2.state('c1')).toEqual(s.state('c1'));
  });

  it('a stale done during an open turn does not auto-compact and the turn stays open across reopen', () => {
    const { s, dir } = mk(undefined, { compactAfter: 5, now: () => 5000 });
    s.append('c1', um('go'), init);
    s.append('c1', { type: 'streaming_start', turnSeq: 2 });
    for (let i = 0; i < 10; i++) s.append('c1', um('m' + i));
    s.append('c1', { type: 'done', turnSeq: 1 }); // stale
    expect(s.state('c1')!.turn.streaming).toBe(true);
    expect(s.meta('c1')!.snapshotSeq).toBe(0);
    expect(fs.existsSync(path.join(dir, 'c1.snap.json'))).toBe(false);
    expect(s.openTurnChatIds()).toEqual(['c1']);
    s.close();
    const { s: s2 } = mk(dir);
    expect(s2.openTurnChatIds()).toEqual(['c1']);
    expect(s2.state('c1')!.turn.streaming).toBe(true);
  });

  it('a manual compact() mid-turn keeps the exact state, including a pending approval, across reopen', () => {
    const { s, dir } = mk(undefined, { now: () => 5000 });
    s.append('c1', um('go'), init);
    s.append('c1', { type: 'streaming_start', turnSeq: 1 });
    s.append('c1', { type: 'approval_needed', toolName: 'Bash', toolUseId: 't1', command: 'ls', description: 'd', input: {} });
    expect(s.state('c1')!.pendingApproval).not.toBeNull();
    s.compact('c1');
    const live = s.state('c1');
    s.close();
    const { s: s2 } = mk(dir);
    expect(s2.state('c1')).toEqual(live);
    expect(s2.state('c1')!.pendingApproval?.toolUseId).toBe('t1');
    expect(s2.meta('c1')!.openTurn).toBe(true);
    expect(s2.openTurnChatIds()).toEqual(['c1']);
    const r = s2.read('c1', 0);
    expect(r.snapshot?.state.turn.streaming).toBe(true);
    expect(r.snapshot?.state.pendingApproval?.toolUseId).toBe('t1');
  });

  it('read returns snapshot when after predates compaction', () => {
    const { s } = mk(undefined, { compactAfter: 5 });
    for (let i = 0; i < 12; i++) s.append('c1', um('m' + i), init);
    s.append('c1', done); // seq 13 compacts
    s.append('c1', um('after')); // seq 14
    const r = s.read('c1', 10);
    expect(r.snapshot).not.toBeNull();
    expect(r.snapshot!.seq).toBe(13);
    expect(r.entries.map(e => e.seq)).toEqual([14]);
    const r2 = s.read('c1', 13);
    expect(r2.snapshot).toBeNull();
    expect(r2.entries.map(e => e.seq)).toEqual([14]);
  });

  it('read(0) on an uncompacted chat returns no snapshot and all entries', () => {
    const { s } = mk();
    s.append('c1', um('a'), init);
    s.append('c1', um('b'));
    const r = s.read('c1', 0);
    expect(r.snapshot).toBeNull();
    expect(r.entries.length).toBe(2);
  });

  it('importMessages writes a seq-0 snapshot and refuses a second import', () => {
    const { s } = mk();
    const msgs = [{ id: 'm1', role: 'user', content: 'hello', timestamp: 5 }] as any;
    const ii = { ...init, title: 'T', createdAt: 10, updatedAt: 20 };
    expect(s.importMessages('c1', ii, msgs)).toBe('created');
    expect(s.importMessages('c1', ii, msgs)).toBe(false);
    expect(s.meta('c1')).toMatchObject({ title: 'T', createdAt: 10, updatedAt: 20, headSeq: 0, snapshotSeq: 0, openTurn: false });
    expect(s.state('c1')!.messages).toHaveLength(1);
    // R1: read(0) returns the seq-0 snapshot.
    const r = s.read('c1', 0);
    expect(r.snapshot?.seq).toBe(0);
    expect(r.snapshot?.state.messages).toHaveLength(1);
    expect(r.entries).toEqual([]);
    s.append('c1', um('next'));
    const r2 = s.read('c1', 0);
    expect(r2.snapshot?.seq).toBe(0);
    expect(r2.entries.map(e => e.seq)).toEqual([1]);
    expect(s.read('c1', 1).snapshot).toBeNull();
  });

  it('list matches projectPath through a symlink', () => {
    const base = tmp();
    const real = path.join(base, 'real');
    const link = path.join(base, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    let t = 100;
    const { s } = mk(undefined, { now: () => ++t });
    s.append('c1', um('a'), { projectPath: real, provider: 'claude' });
    s.append('c2', um('a'), { projectPath: real, provider: 'codex' });
    s.append('c3', um('a'), { projectPath: '/somewhere/else', provider: 'claude' });
    s.append('c1', um('b'));
    expect(s.list(link).map(m => m.chatId)).toEqual(['c1', 'c2']);
    expect(s.list(real).map(m => m.chatId)).toEqual(['c1', 'c2']);
  });

  it('unsafe chat ids are hashed on disk but round-trip in meta', () => {
    const { s, dir } = mk();
    s.append('../evil', um('a'), init);
    s.flush();
    const files = fs.readdirSync(dir);
    expect(files.some(f => f.startsWith('x-') && f.endsWith('.jsonl'))).toBe(true);
    expect(files.some(f => f.includes('evil'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '..', 'evil.jsonl'))).toBe(false);
    const { s: s2 } = mk(dir);
    expect(s2.meta('../evil')?.chatId).toBe('../evil');
    expect(s2.read('../evil', 0).entries).toHaveLength(1);
  });

  it('delete removes files and meta', () => {
    const { s, dir } = mk();
    s.append('c1', um('a'), init);
    s.flush();
    s.delete('c1');
    expect(s.meta('c1')).toBeNull();
    expect(s.state('c1')).toBeNull();
    expect(fs.readdirSync(dir).filter(f => f.startsWith('c1'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).c1).toBeUndefined();
  });

  it('openTurnChatIds lists chats with an unfinished turn', () => {
    const { s, dir } = mk();
    s.append('open', um('go'), init);
    s.append('open', { type: 'streaming_start', turnSeq: 1 });
    s.append('closed', um('go'), init);
    s.append('closed', { type: 'streaming_start', turnSeq: 1 });
    s.append('closed', done);
    expect(s.openTurnChatIds()).toEqual(['open']);
    expect(s.meta('open')!.openTurn).toBe(true);
    expect(s.meta('closed')!.openTurn).toBe(false);
    s.close();
    const { s: s2 } = mk(dir);
    expect(s2.openTurnChatIds()).toEqual(['open']);
  });

  it('referencedStrings finds image paths in both snapshots and logs', () => {
    const { s } = mk();
    s.append('c1', um('see /img/one.png'), init);
    s.compact('c1');
    s.append('c1', um('and /img/two.png'));
    const found = s.referencedStrings(/\/img\/\w+\.png/);
    expect([...found].sort()).toEqual(['/img/one.png', '/img/two.png']);
  });

  it('a torn last line (crash mid-write) is skipped on load, later appends continue the seq', () => {
    const { s, dir } = mk();
    s.append('c1', um('a'), init);
    s.append('c1', um('b'));
    s.flush();
    s.close();
    fs.appendFileSync(path.join(dir, 'c1.jsonl'), '{"chatId":"c1","seq":3,"ts":1,"ev":{"ty');
    const { s: s2 } = mk(dir);
    expect(s2.read('c1', 0).entries.map(e => e.seq)).toEqual([1, 2]);
    expect(s2.append('c1', um('c')).seq).toBe(3);
    s2.flush();
    const { s: s3 } = mk(dir);
    expect(s3.read('c1', 0).entries.map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('a disk error in the timer flush goes to onError instead of throwing', async () => {
    const errors: unknown[] = [];
    const { s, dir } = mk(tmp(), { flushMs: 5, onError: (err) => errors.push(err) });
    s.append('c1', um('hi'), init);
    s.append('c1', dl('a'));
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise(r => setTimeout(r, 30));
    expect(errors).toHaveLength(1);
    fs.mkdirSync(dir, { recursive: true });
  });
});
