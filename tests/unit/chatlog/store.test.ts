// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
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

  it('a history fold snapshots at the history_imported seq, so read(after=H) returns it (R15.2)', () => {
    const { s, dir } = mk();
    s.append('c1', um('new'), init); // backend-created log, not imported
    s.append('c1', done);            // H = 2
    const folded: ChatLogEntry[] = [];
    const msgs = [{ id: 'h1', role: 'user', content: 'old', timestamp: 1 }] as any;
    expect(s.importMessages('c1', { ...init, createdAt: 1, updatedAt: 2 }, msgs, (e) => folded.push(e))).toBe('folded');
    expect(folded.map(e => [e.seq, e.ev.type])).toEqual([[3, 'history_imported']]);
    expect(s.meta('c1')).toMatchObject({ headSeq: 3, snapshotSeq: 3, imported: true });
    // A client that held seq 2 recovers with after=2: it must get the folded snapshot.
    const r = s.read('c1', 2);
    expect(r.snapshot?.seq).toBe(3);
    expect(r.snapshot!.state.messages.map(m => m.id)).toEqual(['h1', 'm1']);
    expect(r.snapshot!.state.lastSeq).toBe(3);
    expect(r.entries).toEqual([]);
    expect(s.read('c1', 0).snapshot?.seq).toBe(3);
    expect(s.read('c1', 3).snapshot).toBeNull();
    // Survives a restart; the next append continues from the fold seq.
    s.close();
    const again = mk(dir).s;
    expect(again.state('c1')!.messages.map(m => m.id)).toEqual(['h1', 'm1']);
    expect(again.append('c1', um('later')).seq).toBe(4);
  });

  it('a fold whose snapshot write fails leaves the chat unimported (R15.3)', () => {
    const { s, dir } = mk();
    s.append('c1', um('new'), init);
    fs.mkdirSync(path.join(dir, 'c1.snap.json')); // the rename onto it fails
    const msgs = [{ id: 'h1', role: 'user', content: 'old', timestamp: 1 }] as any;
    expect(() => s.importMessages('c1', { ...init, createdAt: 1, updatedAt: 2 }, msgs)).toThrow();
    expect(s.meta('c1')!.imported).toBeFalsy();
    fs.rmSync(path.join(dir, 'c1.snap.json'), { recursive: true });
    fs.rmSync(path.join(dir, 'c1.snap.json.tmp'), { force: true });
    expect(s.importMessages('c1', { ...init, createdAt: 1, updatedAt: 2 }, msgs)).toBe('folded');
    expect(s.meta('c1')!.imported).toBe(true);
    expect(s.state('c1')!.messages.map(m => m.id)).toEqual(['h1', 'm1']);
  });

  it('a chat id like __proto__ never touches Object.prototype', () => {
    const { s, dir } = mk();
    for (const id of ['__proto__', 'constructor', 'toString']) {
      expect(s.meta(id)).toBeNull();
      expect(s.read(id, 0).meta).toBeNull();
      s.append(id, um('a'), init);
      s.append(id, done);
      expect(s.meta(id)).toMatchObject({ chatId: id, headSeq: 2 });
    }
    const probe = {} as Record<string, unknown>;
    for (const k of ['headSeq', 'snapshotSeq', 'openTurn', 'updatedAt', 'chatId']) expect(probe[k]).toBeUndefined();
    expect(s.list('/proj').map(m => m.chatId).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    s.close();
    const again = mk(dir).s;
    expect(again.meta('__proto__')).toMatchObject({ headSeq: 2 });
    expect(({} as any).headSeq).toBeUndefined();
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

describe('ChatLogStore memory bound (LRU of loaded chats)', () => {
  const closedTurn = (s: ChatLogStore, id: string, withInit = true) => {
    s.append(id, um('hi ' + id), withInit ? init : undefined);
    s.append(id, { type: 'streaming_start', turnSeq: 1 });
    s.append(id, assistant(1, { type: 'text', text: 'reply ' + id }));
    s.append(id, done);
  };

  it('importMessages "created" does not pin the chat in memory', () => {
    const { s } = mk(tmp(), { maxLoaded: 4 });
    const msgs = [{ id: 'm1', role: 'user', content: 'hello', timestamp: 5 }] as any;
    for (let i = 0; i < 10; i++) s.importMessages('i' + i, { ...init, createdAt: 1, updatedAt: 2 }, msgs);
    expect(s.loadedChatIds()).toEqual([]);
    expect(s.state('i3')!.messages.map(m => m.id)).toEqual(['m1']);
    expect(s.loadedChatIds()).toEqual(['i3']);
  });

  it('reading more chats than the cap keeps at most N loaded', () => {
    const { s } = mk(tmp(), { maxLoaded: 3 });
    for (let i = 0; i < 8; i++) closedTurn(s, 'c' + i);
    expect(s.loadedChatIds().length).toBeLessThanOrEqual(3);
    for (let i = 0; i < 8; i++) s.read('c' + i, 0);
    expect(s.loadedChatIds().length).toBeLessThanOrEqual(3);
    // Most recently used survive.
    expect(s.loadedChatIds()).toEqual(['c5', 'c6', 'c7']);
  });

  it('an evicted chat reloads with an identical state and continues its seq', () => {
    const { s } = mk(tmp(), { maxLoaded: 2 });
    closedTurn(s, 'a');
    s.compact('a');
    s.append('a', um('after compaction'));
    const before = structuredClone(s.state('a'));
    const head = s.meta('a')!.headSeq;
    closedTurn(s, 'b');
    closedTurn(s, 'c');
    expect(s.loadedChatIds()).not.toContain('a');
    expect(s.state('a')).toEqual(before);
    expect(s.append('a', um('next')).seq).toBe(head + 1);
  });

  it('never evicts a chat with an open turn, a queue, or buffered deltas', () => {
    const { s } = mk(tmp(), { maxLoaded: 2, flushMs: 60_000 });
    for (let i = 0; i < 6; i++) closedTurn(s, 'x' + i);
    s.append('open', um('go'), init);
    s.append('open', { type: 'streaming_start', turnSeq: 1 });
    s.append('queued', um('go'), init);
    s.append('queued', { type: 'queue_added', item: { clientId: 'q1', text: 'later', queuedAt: 1 } });
    closedTurn(s, 'buffered');
    s.append('buffered', dl('partial')); // buffered, not yet on disk
    for (let i = 0; i < 6; i++) s.state('x' + i); // churn without flushing
    const ids = s.loadedChatIds();
    expect(ids).toEqual(expect.arrayContaining(['open', 'queued', 'buffered']));
    expect(ids.length).toBeLessThanOrEqual(2 + 3);
    // Once unpinned the chats become evictable again.
    s.append('open', done);
    s.append('queued', { type: 'queue_cleared' });
    s.flush();
    for (let i = 0; i < 6; i++) s.state('x' + i);
    expect(s.loadedChatIds()).toEqual(['x4', 'x5']);
    expect(s.state('buffered')!.messages.at(-1)).toMatchObject({ role: 'assistant' });
  });
});

describe('ChatLogStore GC references fail safe', () => {
  it('referencedStrings skips a missing file but throws on any other read error', () => {
    const { s, dir } = mk();
    s.append('c1', um('see /img/one.png'), init);
    s.append('c2', um('see /img/two.png'), init);
    // c1 has no snapshot (ENOENT): fine.
    expect([...s.referencedStrings(/\/img\/\w+\.png/)].sort()).toEqual(['/img/one.png', '/img/two.png']);
    // A log path that can't be read as a file (EISDIR) must abort the scan.
    fs.rmSync(path.join(dir, 'c2.jsonl'));
    fs.mkdirSync(path.join(dir, 'c2.jsonl'));
    expect(() => s.referencedStrings(/\/img\/\w+\.png/)).toThrow();
  });
});

describe('ChatLogStore snapshot durability and recovery', () => {
  function recordFsOrder() {
    const calls: string[] = [];
    const realRename = fs.renameSync;
    const realWrite = fs.writeFileSync;
    const realFsync = fs.fsyncSync;
    const spies = [
      vi.spyOn(fs, 'renameSync').mockImplementation(((a: fs.PathLike, b: fs.PathLike) => {
        calls.push('rename:' + path.basename(String(b)));
        return realRename(a, b);
      }) as typeof fs.renameSync),
      vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: any, d: any, o?: any) => {
        calls.push('write:' + path.basename(String(f)));
        return realWrite(f, d, o);
      }) as typeof fs.writeFileSync),
      vi.spyOn(fs, 'fsyncSync').mockImplementation(((fd: number) => {
        calls.push('fsync');
        return realFsync(fd);
      }) as typeof fs.fsyncSync),
    ];
    return { calls, restore: () => spies.forEach(sp => sp.mockRestore()) };
  }
  function assertDurableOrder(calls: string[]) {
    const snapRename = calls.indexOf('rename:c1.snap.json');
    // (appendFileSync goes through writeFileSync too: the truncate is the last write.)
    const truncate = calls.lastIndexOf('write:c1.jsonl');
    expect(snapRename).toBeGreaterThan(0);
    expect(calls.slice(0, snapRename)).toContain('fsync');
    expect(truncate).toBeGreaterThan(snapRename);
  }

  it('compaction fsyncs the snapshot temp file before the rename, and both before truncating the log', () => {
    const { s, dir } = mk();
    s.append('c1', um('a'), init);
    const rec = recordFsOrder();
    try { s.compact('c1'); } finally { rec.restore(); }
    assertDurableOrder(rec.calls);
    expect(fs.readFileSync(path.join(dir, 'c1.jsonl'), 'utf8')).toBe('');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'c1.snap.json'), 'utf8')).seq).toBe(1);
  });

  it('a history fold fsyncs its snapshot before truncating the log', () => {
    const { s } = mk();
    s.append('c1', um('new'), init);
    const msgs = [{ id: 'h1', role: 'user', content: 'old', timestamp: 1 }] as any;
    const rec = recordFsOrder();
    try { expect(s.importMessages('c1', { ...init, createdAt: 1, updatedAt: 2 }, msgs)).toBe('folded'); } finally { rec.restore(); }
    assertDurableOrder(rec.calls);
  });

  function compacted() {
    const { s, dir } = mk();
    s.append('c1', um('one'), init);
    s.append('c1', um('two'));
    s.compact('c1');                 // snapshotSeq 2
    s.append('c1', um('three'));     // seq 3 in the log tail
    s.importMessages('c1', { ...init, createdAt: 1, updatedAt: 2 }, []); // marks imported
    expect(s.meta('c1')!.imported).toBe(true);
    s.close();
    return dir;
  }

  for (const kind of ['missing', 'corrupt'] as const) {
    it(`a ${kind} snapshot after compaction keeps seqs monotonic and clears imported for a re-fold`, () => {
      const dir = compacted();
      const snap = path.join(dir, 'c1.snap.json');
      if (kind === 'missing') fs.rmSync(snap); else fs.writeFileSync(snap, '{"chatId":"c1","seq":2,"sta');
      const errors: unknown[] = [];
      const { s } = mk(dir, { onError: (e) => errors.push(e) });
      const r = s.read('c1', 0);
      expect(r.headSeq).toBeGreaterThanOrEqual(3);
      expect(r.meta!.headSeq).toBe(3);
      expect(r.meta!.imported).toBeFalsy();
      expect(errors.length).toBe(1);
      expect(s.append('c1', um('four')).seq).toBe(4);
      // Persisted: a restart still sees the chat unimported and the seq continues.
      s.close();
      const { s: s2 } = mk(dir);
      expect(s2.meta('c1')!.imported).toBeFalsy();
      expect(s2.append('c1', um('five')).seq).toBe(5);
      // The re-fold puts the mirror's history back in front of the surviving tail.
      const msgs = [
        { id: 'h1', role: 'user', content: 'one', timestamp: 1 },
        { id: 'h2', role: 'user', content: 'two', timestamp: 2 },
      ] as any;
      expect(s2.importMessages('c1', { ...init, createdAt: 1, updatedAt: 2 }, msgs)).toBe('folded');
      const st = s2.state('c1')!;
      expect(st.messages.slice(0, 2).map(m => m.id)).toEqual(['h1', 'h2']);
      expect(st.messages.length).toBe(5);
      expect(s2.meta('c1')).toMatchObject({ imported: true, headSeq: 6, snapshotSeq: 6 });
    });
  }
});

describe('ChatLogStore lost snapshot: what a client sees', () => {
  for (const withTail of [true, false]) {
    it(`a client reducing read(0) lands on headSeq, so the next live entry is in order (${withTail ? 'with' : 'empty'} tail)`, () => {
      const { s, dir } = mk();
      s.append('c1', um('one'), init);
      s.append('c1', um('two'));
      s.compact('c1');
      if (withTail) s.append('c1', um('three'));
      s.close();
      fs.rmSync(path.join(dir, 'c1.snap.json'));
      const { s: s2 } = mk(dir, { onError: () => {} });
      const r = s2.read('c1', 0);
      const head = withTail ? 3 : 2;
      expect(r.headSeq).toBe(head);
      const client = reduceMany(r.snapshot ? r.snapshot.state : emptyChatState({ provider: 'claude' }), r.entries);
      expect(client.lastSeq).toBe(head);
      expect(s2.state('c1')!.lastSeq).toBe(head);
      // A client that held the old head gets nothing new and no stale snapshot.
      expect(s2.read('c1', head).entries).toEqual([]);
      expect(s2.append('c1', um('next')).seq).toBe(head + 1);
    });
  }
});

describe('ChatLogStore realpath cache bound', () => {
  it('list() with many distinct paths keeps the realpath cache bounded', () => {
    const { s } = mk();
    for (let i = 0; i < 1000; i++) s.list('/nope/' + i);
    expect(s.realCacheSize()).toBeLessThanOrEqual(256);
  });
});
