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
import { emptyChatState, persistableState, reduceChat, reduceMany, stateFromMessages } from '../../../src/lib/chat/reducer';

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

function realPathOf(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

interface Loaded { state: ChatState; headSeq: number }

export class ChatLogStore {
  private dir: string;
  private now: () => number;
  private flushMs: number;
  private compactAfter: number;
  private index: Record<string, ChatMeta> = {};
  private loaded = new Map<string, Loaded>();
  private buffers = new Map<string, string[]>();
  private indexDirty = false;
  private timer: NodeJS.Timeout | null = null;
  private realCache = new Map<string, string>();

  constructor(opts: { dir: string; now?: () => number; flushMs?: number; compactAfter?: number }) {
    this.dir = opts.dir;
    this.now = opts.now ?? Date.now;
    this.flushMs = opts.flushMs ?? 100;
    this.compactAfter = opts.compactAfter ?? 500;
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8'));
      if (parsed && typeof parsed === 'object') this.index = parsed;
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

  private writeIndex() {
    this.writeAtomic(this.indexPath(), JSON.stringify(this.index));
    this.indexDirty = false;
  }

  private readSnapshot(chatId: string): ChatSnapshot | null {
    try { return JSON.parse(fs.readFileSync(this.snapPath(chatId), 'utf8')) as ChatSnapshot; } catch { return null; }
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
    if (cached) return cached;
    const meta = this.index[chatId];
    if (!meta) return null;
    const snap = this.readSnapshot(chatId);
    const base = snap ? snap.state : emptyChatState({ provider: meta.provider });
    const snapSeq = snap ? snap.seq : 0;
    const tail = this.readLog(chatId).filter(e => e.seq > snapSeq);
    const state = reduceMany(base, tail);
    const headSeq = Math.max(snapSeq, tail.length ? tail[tail.length - 1].seq : 0);
    meta.headSeq = headSeq;
    meta.snapshotSeq = snapSeq;
    meta.openTurn = state.turn.streaming;
    const l = { state, headSeq };
    this.loaded.set(chatId, l);
    return l;
  }

  private flushBuffers() {
    for (const [chatId, lines] of this.buffers) {
      if (lines.length) fs.appendFileSync(this.logPath(chatId), lines.join(''));
    }
    this.buffers.clear();
  }

  private scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.flushMs);
    this.timer.unref?.();
  }

  append(chatId: string, ev: ChatEvent, init?: { projectPath: string; provider: ChatSettings['provider'] }): ChatLogEntry {
    let meta = this.index[chatId];
    const ts = this.now();
    if (!meta) {
      if (!init) throw new Error(`ChatLogStore.append: unknown chat ${chatId} and no init`);
      meta = { chatId, projectPath: init.projectPath, createdAt: ts, updatedAt: ts, headSeq: 0, snapshotSeq: 0, provider: init.provider, openTurn: false };
      this.index[chatId] = meta;
    }
    const l = this.load(chatId) ?? { state: emptyChatState({ provider: meta.provider }), headSeq: 0 };
    this.loaded.set(chatId, l);
    const entry: ChatLogEntry = { chatId, seq: l.headSeq + 1, ts, ev };
    l.headSeq = entry.seq;
    l.state = reduceChat(l.state, entry);
    meta.headSeq = entry.seq;
    meta.updatedAt = ts;
    meta.openTurn = l.state.turn.streaming;
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
      if (ev.type === 'done' && meta.headSeq - meta.snapshotSeq >= this.compactAfter) this.compact(chatId);
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
    if (r === undefined) { r = realPathOf(p); this.realCache.set(p, r); }
    return r;
  }

  patchMeta(chatId: string, patch: Partial<Pick<ChatMeta, 'title' | 'provider'>>): void {
    const m = this.index[chatId];
    if (!m) return;
    if (patch.title !== undefined) m.title = patch.title;
    if (patch.provider !== undefined) m.provider = patch.provider;
    this.writeIndex();
  }

  importMessages(
    chatId: string,
    init: { projectPath: string; provider: ChatSettings['provider']; title?: string; createdAt: number; updatedAt: number },
    messages: ChatMessage[],
  ): boolean {
    if (this.index[chatId] || fs.existsSync(this.logPath(chatId)) || fs.existsSync(this.snapPath(chatId))) return false;
    const state = stateFromMessages(messages, { provider: init.provider });
    const snap: ChatSnapshot = { chatId, seq: 0, state: persistableState(state) };
    this.writeAtomic(this.snapPath(chatId), JSON.stringify(snap));
    fs.writeFileSync(this.logPath(chatId), '');
    this.index[chatId] = {
      chatId, projectPath: init.projectPath, title: init.title,
      createdAt: init.createdAt, updatedAt: init.updatedAt,
      headSeq: 0, snapshotSeq: 0, provider: init.provider, openTurn: false,
    };
    this.loaded.set(chatId, { state, headSeq: 0 });
    this.writeIndex();
    return true;
  }

  compact(chatId: string): void {
    const meta = this.index[chatId];
    if (!meta) return;
    const l = this.load(chatId)!;
    this.flushBuffers();
    const snap: ChatSnapshot = { chatId, seq: l.headSeq, state: persistableState(l.state) };
    this.writeAtomic(this.snapPath(chatId), JSON.stringify(snap));
    fs.writeFileSync(this.logPath(chatId), '');
    meta.snapshotSeq = l.headSeq;
    meta.headSeq = l.headSeq;
    meta.openTurn = l.state.turn.streaming;
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
        try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
        for (const m of text.matchAll(new RegExp(re.source, flags))) out.add(m[0]);
      }
    }
    return out;
  }

  openTurnChatIds(): string[] {
    return Object.values(this.index).filter(m => m.openTurn).map(m => m.chatId);
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
