// Durable per-chat append-only log (main process). Layout under `dir`:
//   <id>.jsonl      one ChatLogEntry per line
//   <id>.snap.json  ChatSnapshot (state at snapshotSeq), written by compaction/import
//   index.json      Record<chatId, ChatMeta>, written via temp file + rename
// Pure text/reasoning deltas are buffered and flushed on a timer; everything
// else flushes the buffer and is written synchronously.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChatMessage } from '../../../src/types';
import type { ChatEvent, ChatLogEntry, ChatMeta, ChatSettings, ChatSnapshot, ChatState } from '../../../src/lib/chat/types';
import { emptyChatState, normalizeChatState, persistableState, reduceChat, reduceMany, stateFromMessages } from '../../../src/lib/chat/reducer';

export interface ReadResult { snapshot: ChatSnapshot | null; entries: ChatLogEntry[]; headSeq: number; meta: ChatMeta | null }

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Same predicate as ChatPanel's isPureTextDelta, plus reasoning_delta. */
function isDeltaEvent(ev: ChatEvent): boolean {
  if (ev.type === 'reasoning_delta') return true;
  if (ev.type !== 'assistant') return false;
  const content = (ev as any).message?.content;
  return Array.isArray(content) && content.length > 0
    && content.every((b: any) => b && b.type === 'text' && b.delta && typeof b.text === 'string');
}

function fileId(chatId: string): string {
  return SAFE_ID.test(chatId) ? chatId : 'x-' + crypto.createHash('sha256').update(chatId).digest('hex');
}

/** Keeps meta.queued in step with the state's queue (absent when empty). */
function setQueued(meta: ChatMeta, n: number): void {
  if (n > 0) meta.queued = n;
  else delete meta.queued;
}

/** Default number of chats kept reduced in memory (chats mid-turn, queued or with buffered deltas are extra). */
const DEFAULT_MAX_LOADED = 16;
/** realpath memo for list(): a phone can ask for arbitrary paths, so it is cleared at this size. */
const REAL_CACHE_MAX = 256;

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function realPathOf(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

interface Loaded { state: ChatState; headSeq: number }

export class ChatLogStore {
  private dir: string;
  private now: () => number;
  private flushMs: number;
  private compactAfter: number;
  /** Null-prototype: chat ids like '__proto__' are plain keys, never Object.prototype. */
  private index: Record<string, ChatMeta> = Object.create(null);
  /**
   * Reduced chats, least recently used first. Bounded by maxLoaded: load()
   * rebuilds an evicted chat from its snapshot + log tail. A chat mid-turn,
   * with a queue, or with deltas still in the write buffer is never evicted.
   */
  private loaded = new Map<string, Loaded>();
  private maxLoaded: number;
  private buffers = new Map<string, string[]>();
  private indexDirty = false;
  private timer: NodeJS.Timeout | null = null;
  private realCache = new Map<string, string>();
  private onError: (err: unknown) => void;

  constructor(opts: { dir: string; now?: () => number; flushMs?: number; compactAfter?: number; maxLoaded?: number; onError?: (err: unknown) => void }) {
    this.dir = opts.dir;
    this.maxLoaded = Math.max(1, opts.maxLoaded ?? DEFAULT_MAX_LOADED);
    // eslint-disable-next-line no-console
    this.onError = opts.onError ?? ((err) => console.error('[chatlog] flush failed:', err));
    this.now = opts.now ?? Date.now;
    this.flushMs = opts.flushMs ?? 100;
    this.compactAfter = opts.compactAfter ?? 500;
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8'));
      if (parsed && typeof parsed === 'object') this.index = Object.assign(Object.create(null), parsed);
    } catch { /* missing or corrupt index starts empty */ }
  }

  private indexPath() { return path.join(this.dir, 'index.json'); }
  private logPath(chatId: string) { return path.join(this.dir, fileId(chatId) + '.jsonl'); }
  private snapPath(chatId: string) { return path.join(this.dir, fileId(chatId) + '.snap.json'); }

  private writeAtomic(file: string, data: string) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  /**
   * writeAtomic for a snapshot whose log is about to be truncated: the temp
   * file is fsynced before the rename and the directory after it, so a crash
   * can't leave an empty log behind a snapshot that never reached the disk.
   */
  private writeDurable(file: string, data: string) {
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    // Directory fsync makes the rename durable; unsupported on some platforms (Windows).
    try {
      const dfd = fs.openSync(this.dir, 'r');
      try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    } catch { /* best effort */ }
  }

  private writeIndex() {
    this.writeAtomic(this.indexPath(), JSON.stringify(this.index));
    this.indexDirty = false;
  }

  private readSnapshot(chatId: string): ChatSnapshot | null {
    return this.readSnapshotChecked(chatId).snap;
  }

  /** The snapshot, or why there is none: 'missing' (no file) or 'corrupt' (unreadable / unparsable). */
  private readSnapshotChecked(chatId: string): { snap: ChatSnapshot | null; problem: 'missing' | 'corrupt' | null; error?: unknown } {
    let raw: string;
    try { raw = fs.readFileSync(this.snapPath(chatId), 'utf8'); } catch (err) {
      return { snap: null, problem: isEnoent(err) ? 'missing' : 'corrupt', error: err };
    }
    try {
      const snap = JSON.parse(raw) as ChatSnapshot;
      if (snap && typeof snap === 'object' && typeof snap.seq === 'number' && snap.state && typeof snap.state === 'object') {
        return { snap: { ...snap, state: normalizeChatState(snap.state) }, problem: null };
      }
      return { snap: null, problem: 'corrupt', error: new Error('snapshot has no seq/state') };
    } catch (err) {
      return { snap: null, problem: 'corrupt', error: err };
    }
  }

  /** Parses the log, dropping unparsable lines; rewrites the file if any were dropped or the tail is torn. */
  private readLog(chatId: string): ChatLogEntry[] {
    let raw: string;
    try { raw = fs.readFileSync(this.logPath(chatId), 'utf8'); } catch { return []; }
    if (!raw) return [];
    const entries: ChatLogEntry[] = [];
    let bad = !raw.endsWith('\n');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e.seq === 'number') entries.push(e); else bad = true;
      } catch { bad = true; }
    }
    if (bad) this.writeAtomic(this.logPath(chatId), entries.map(e => JSON.stringify(e) + '\n').join(''));
    return entries;
  }

  private load(chatId: string): Loaded | null {
    const cached = this.loaded.get(chatId);
    if (cached) {
      // Most recently used goes last.
      this.loaded.delete(chatId);
      this.loaded.set(chatId, cached);
      return cached;
    }
    const meta = this.index[chatId];
    if (!meta) return null;
    const { snap, problem, error } = this.readSnapshotChecked(chatId);
    // A compacted (or folded) chat whose snapshot is gone or unreadable lost
    // everything before snapshotSeq. A seq-0 snapshot can legitimately be
    // absent (a chat created by an append), but never unparsable.
    const lost = !snap && (problem === 'corrupt' || (problem === 'missing' && meta.snapshotSeq > 0));
    const base = snap ? snap.state : emptyChatState({ provider: meta.provider });
    let snapSeq = snap ? snap.seq : 0;
    const tail = this.readLog(chatId).filter(e => e.seq > snapSeq);
    let state = reduceMany(base, tail);
    let headSeq = Math.max(snapSeq, tail.length ? tail[tail.length - 1].seq : 0);
    if (lost) {
      // Clients rely on seqs never going backwards; and the history before the
      // snapshot is re-folded from the IndexedDB mirror (ensureChatInLog sees
      // imported unset and imports it in front of the surviving tail).
      headSeq = Math.max(headSeq, meta.headSeq);
      this.onError(new Error(`chatlog: snapshot ${problem} for chat ${chatId} (snapshotSeq ${meta.snapshotSeq}); `
        + `recovering from the log tail, history will be re-imported: ${error instanceof Error ? error.message : String(error)}`));
      delete meta.imported;
      // A replacement snapshot AT headSeq: a client reducing read(0) must land on
      // headSeq (not the tail's last seq, or 0 for an empty tail), or the next
      // live entry would look like a gap it can never fill.
      state = { ...state, lastSeq: headSeq };
      try {
        this.writeDurable(this.snapPath(chatId), JSON.stringify({ chatId, seq: headSeq, state } satisfies ChatSnapshot));
        snapSeq = headSeq;
      } catch (err) {
        this.onError(err);
      }
    }
    meta.headSeq = headSeq;
    meta.snapshotSeq = snapSeq;
    meta.openTurn = state.turn.streaming;
    setQueued(meta, state.queue.length);
    if (lost) this.writeIndex();
    const l = { state, headSeq };
    this.remember(chatId, l);
    return l;
  }

  /** Caches a reduced chat as most recently used, then evicts down to maxLoaded. */
  private remember(chatId: string, l: Loaded) {
    this.loaded.delete(chatId);
    this.loaded.set(chatId, l);
    if (this.loaded.size <= this.maxLoaded) return;
    for (const id of this.loaded.keys()) {
      if (this.loaded.size <= this.maxLoaded) break;
      if (id === chatId || this.pinned(id)) continue;
      this.loaded.delete(id);
    }
  }

  /** In-memory state that isn't fully reflected on disk yet, or is hot: never evicted. */
  private pinned(chatId: string): boolean {
    const m = this.index[chatId];
    if (m?.openTurn || (m?.queued ?? 0) > 0) return true;
    return (this.buffers.get(chatId)?.length ?? 0) > 0;
  }

  /** Chat ids currently reduced in memory, least recently used first (diagnostics/tests). */
  loadedChatIds(): string[] {
    return [...this.loaded.keys()];
  }

  /** Size of the realpath memo (diagnostics/tests). */
  realCacheSize(): number {
    return this.realCache.size;
  }

  private flushBuffers() {
    for (const [chatId, lines] of this.buffers) {
      if (lines.length) fs.appendFileSync(this.logPath(chatId), lines.join(''));
    }
    this.buffers.clear();
  }

  private scheduleFlush() {
    if (this.timer) return;
    // A disk error here would otherwise be an uncaught exception in main.
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); } catch (err) { this.onError(err); }
    }, this.flushMs);
    this.timer.unref?.();
  }

  append(chatId: string, ev: ChatEvent, init?: { projectPath: string; provider: ChatSettings['provider']; imported?: boolean }): ChatLogEntry {
    let meta = this.index[chatId];
    const ts = this.now();
    if (!meta) {
      if (!init) throw new Error(`ChatLogStore.append: unknown chat ${chatId} and no init`);
      meta = {
        chatId, projectPath: init.projectPath, createdAt: ts, updatedAt: ts, headSeq: 0, snapshotSeq: 0, provider: init.provider, openTurn: false,
        ...(init.imported ? { imported: true } : {}),
      };
      this.index[chatId] = meta;
    }
    const l = this.load(chatId) ?? { state: emptyChatState({ provider: meta.provider }), headSeq: 0 };
    const entry: ChatLogEntry = { chatId, seq: l.headSeq + 1, ts, ev };
    l.headSeq = entry.seq;
    l.state = reduceChat(l.state, entry);
    meta.headSeq = entry.seq;
    meta.updatedAt = ts;
    meta.openTurn = l.state.turn.streaming;
    setQueued(meta, l.state.queue.length);
    this.remember(chatId, l);
    const line = JSON.stringify(entry) + '\n';
    if (isDeltaEvent(ev)) {
      let buf = this.buffers.get(chatId);
      if (!buf) { buf = []; this.buffers.set(chatId, buf); }
      buf.push(line);
      this.indexDirty = true;
      this.scheduleFlush();
    } else {
      this.flushBuffers();
      fs.appendFileSync(this.logPath(chatId), line);
      this.writeIndex();
      if (ev.type === 'done' && !l.state.turn.streaming && meta.headSeq - meta.snapshotSeq >= this.compactAfter) this.compact(chatId);
    }
    return entry;
  }

  read(chatId: string, after: number): ReadResult {
    const meta = this.index[chatId];
    if (!meta) return { snapshot: null, entries: [], headSeq: 0, meta: null };
    const l = this.load(chatId)!;
    this.flushBuffers();
    let snapshot: ChatSnapshot | null = null;
    if (after < meta.snapshotSeq || after === 0) {
      const snap = this.readSnapshot(chatId);
      if (snap && (after < snap.seq || after === 0)) snapshot = snap;
    }
    const floor = Math.max(after, snapshot ? snapshot.seq : 0);
    const entries = this.readLog(chatId).filter(e => e.seq > floor);
    return { snapshot, entries, headSeq: l.headSeq, meta: { ...meta } };
  }

  state(chatId: string): ChatState | null {
    return this.load(chatId)?.state ?? null;
  }

  meta(chatId: string): ChatMeta | null {
    const m = this.index[chatId];
    return m ? { ...m } : null;
  }

  list(projectPath: string): ChatMeta[] {
    const want = this.real(projectPath);
    return Object.values(this.index)
      .filter(m => this.real(m.projectPath) === want)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(m => ({ ...m }));
  }

  private real(p: string): string {
    let r = this.realCache.get(p);
    if (r === undefined) {
      if (this.realCache.size >= REAL_CACHE_MAX) this.realCache.clear();
      r = realPathOf(p);
      this.realCache.set(p, r);
    }
    return r;
  }

  patchMeta(chatId: string, patch: Partial<Pick<ChatMeta, 'title' | 'provider'>>): void {
    const m = this.index[chatId];
    if (!m) return;
    if (patch.title !== undefined) m.title = patch.title;
    if (patch.provider !== undefined) m.provider = patch.provider;
    this.writeIndex();
  }

  /**
   * Imports a chat's pre-log history. A new chat gets a seq-0 snapshot of it.
   * A chat already logged but never imported (a backend event or a client
   * command created it first) gets the history folded in FRONT of its state —
   * messages it already holds (same id) are skipped. The fold appends a
   * `history_imported` entry (handed to `onFolded` for fan-out), then writes the
   * folded state as a snapshot AT that entry's seq (temp+rename), then
   * truncates the log, so a reader resuming from the pre-fold head gets the
   * snapshot. `imported` is set only once the snapshot is on disk. Returns
   * 'created' | 'folded' | 'marked' (logged, nothing new to fold) | false
   * (already imported, or no project to create it).
   */
  importMessages(
    chatId: string,
    init: { projectPath: string; provider: ChatSettings['provider']; title?: string; createdAt: number; updatedAt: number },
    messages: ChatMessage[],
    onFolded?: (entry: ChatLogEntry) => void,
  ): 'created' | 'folded' | 'marked' | false {
    const meta = this.index[chatId];
    if (meta) {
      if (meta.imported) return false;
      const l = this.load(chatId)!;
      this.flushBuffers();
      const have = new Set(l.state.messages.map(m => m.id));
      const prefix = messages.filter(m => m && !have.has(m.id));
      if (init.title && !meta.title) meta.title = init.title;
      if (init.createdAt && init.createdAt < meta.createdAt) meta.createdAt = init.createdAt;
      if (prefix.length === 0) {
        meta.imported = true;
        this.writeIndex();
        return 'marked';
      }
      const entry = this.append(chatId, { type: 'history_imported' });
      const turn = l.state.turn.startIndex != null
        ? { ...l.state.turn, startIndex: l.state.turn.startIndex + prefix.length } : l.state.turn;
      const state: ChatState = { ...l.state, messages: [...prefix, ...l.state.messages], turn };
      const snap: ChatSnapshot = { chatId, seq: entry.seq, state };
      this.writeDurable(this.snapPath(chatId), JSON.stringify(snap));
      fs.writeFileSync(this.logPath(chatId), '');
      l.state = state;
      meta.snapshotSeq = entry.seq;
      meta.imported = true;
      this.writeIndex();
      onFolded?.(entry);
      return 'folded';
    }
    if (!init?.projectPath || fs.existsSync(this.logPath(chatId)) || fs.existsSync(this.snapPath(chatId))) return false;
    const state = stateFromMessages(messages, { provider: init.provider });
    const snap: ChatSnapshot = { chatId, seq: 0, state: persistableState(state) };
    this.writeDurable(this.snapPath(chatId), JSON.stringify(snap));
    fs.writeFileSync(this.logPath(chatId), '');
    this.index[chatId] = {
      chatId, projectPath: init.projectPath, title: init.title,
      createdAt: init.createdAt, updatedAt: init.updatedAt,
      headSeq: 0, snapshotSeq: 0, provider: init.provider, openTurn: false, imported: true,
    };
    // Not cached: a first-launch migration imports every chat, and none of them
    // should stay reduced in memory. load() reads the snapshot when it's used.
    this.writeIndex();
    return 'created';
  }

  compact(chatId: string): void {
    const meta = this.index[chatId];
    if (!meta) return;
    const l = this.load(chatId)!;
    this.flushBuffers();
    // Exact live state: a snapshot must agree with the entries that follow it.
    const snap: ChatSnapshot = { chatId, seq: l.headSeq, state: l.state };
    this.writeDurable(this.snapPath(chatId), JSON.stringify(snap));
    fs.writeFileSync(this.logPath(chatId), '');
    meta.snapshotSeq = l.headSeq;
    meta.headSeq = l.headSeq;
    meta.openTurn = l.state.turn.streaming;
    setQueued(meta, l.state.queue.length);
    this.writeIndex();
  }

  delete(chatId: string): void {
    this.buffers.delete(chatId);
    this.loaded.delete(chatId);
    for (const p of [this.logPath(chatId), this.snapPath(chatId)]) fs.rmSync(p, { force: true });
    if (this.index[chatId]) {
      delete this.index[chatId];
      this.writeIndex();
    }
  }

  referencedStrings(re: RegExp): Set<string> {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const out = new Set<string>();
    this.flushBuffers();
    for (const chatId of Object.keys(this.index)) {
      for (const p of [this.snapPath(chatId), this.logPath(chatId)]) {
        let text: string;
        // Only a missing file is skippable: any other read error throws, so the
        // image/model GC aborts instead of deleting what this file references.
        try { text = fs.readFileSync(p, 'utf8'); } catch (err) { if (isEnoent(err)) continue; throw err; }
        for (const m of text.matchAll(new RegExp(re.source, flags))) out.add(m[0]);
      }
    }
    return out;
  }

  openTurnChatIds(): string[] {
    return Object.values(this.index).filter(m => m.openTurn).map(m => m.chatId);
  }

  /** Chats holding queued sends (from the index; no log is reduced). */
  queuedChatIds(): string[] {
    return Object.values(this.index).filter(m => (m.queued ?? 0) > 0).map(m => m.chatId);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.flushBuffers();
    if (this.indexDirty) this.writeIndex();
  }

  close(): void {
    this.flush();
  }
}
