// A read-only mirror of each open chat's ChatState, for the shell (header
// status dot, ChatPanel's isStreaming / waiting / followUp props).
//
// ChatPanel's own useChatLog is the only reader that subscribes. The mirror
// taps what that reader receives (its chatlog.open results and the live
// entries) and reduces them the same way, so the shell never opens a second
// subscription per chat. A gap is left to the reader: it re-opens, and the
// mirror resets from that open's result.
import { emptyChatState, reduceMany } from '../../../src/lib/chat/reducer';
import type { ChatLogEntry, ChatSettings, ChatState } from '../../../src/lib/chat/types';

interface OpenResult {
  snapshot: { seq: number; state: ChatState } | null;
  entries: ChatLogEntry[];
}

interface Rec {
  state: ChatState | null;
  /** Opens in flight: live entries wait in `held` until they settle. */
  pending: number;
  held: ChatLogEntry[];
  listeners: Set<() => void>;
}

export interface ChatMirror {
  /** The chat's latest state, or null before its first open resolves. Stable between changes. */
  get(chatId: string): ChatState | null;
  subscribe(chatId: string, cb: () => void): () => void;
  /** Wraps a chatlog.open(chatId, after) promise; returns it unchanged. */
  tapOpen<T>(chatId: string, after: number, open: Promise<T>): Promise<T>;
  /** A live entry (chatlog.onEvent). */
  ingest(entry: ChatLogEntry): void;
  /** The chat was closed: drop its state. */
  forget(chatId: string): void;
}

/**
 * `fallback` is the settings a chat with no log yet reduces from: the same
 * `{ provider }` ChatPanel hands its useChatLog (the desktop's default
 * provider), so the mirror and the reader agree on a new chat's provider.
 */
export function createChatMirror(fallback: () => ChatSettings = () => ({ provider: 'claude' })): ChatMirror {
  const recs = new Map<string, Rec>();

  const rec = (chatId: string): Rec => {
    let r = recs.get(chatId);
    if (!r) { r = { state: null, pending: 0, held: [], listeners: new Set() }; recs.set(chatId, r); }
    return r;
  };

  const notify = (r: Rec) => {
    for (const cb of [...r.listeners]) { try { cb(); } catch (err) { console.error('[mirror] listener failed', err); } }
  };

  /** Applies in-order entries past the state's lastSeq; stops at a gap (the reader re-opens). */
  const apply = (r: Rec, entries: ChatLogEntry[]): boolean => {
    if (!r.state) return false;
    let next = r.state;
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
      if (e.seq <= next.lastSeq) continue;
      if (e.seq !== next.lastSeq + 1) break;
      next = reduceMany(next, [e]);
    }
    if (next === r.state) return false;
    r.state = next;
    return true;
  };

  return {
    get: (chatId) => recs.get(chatId)?.state ?? null,

    subscribe(chatId, cb) {
      const r = rec(chatId);
      r.listeners.add(cb);
      return () => { r.listeners.delete(cb); };
    },

    tapOpen(chatId, after, open) {
      const r = rec(chatId);
      r.pending++;
      open.then((raw) => {
        const res = raw as unknown as OpenResult;
        const cur = recs.get(chatId);
        if (cur !== r) return;
        r.pending--;
        // Same rule as useChatLog: a full open (after 0) or a newer snapshot replaces the state.
        if (!(after > 0) || !r.state) {
          r.state = reduceMany(res.snapshot ? res.snapshot.state : emptyChatState(fallback()), res.entries);
        } else if (res.snapshot && res.snapshot.seq > after) {
          r.state = reduceMany(res.snapshot.state, res.entries);
        } else {
          apply(r, res.entries);
        }
        if (r.pending === 0 && r.held.length) { const held = r.held; r.held = []; apply(r, held); }
        notify(r);
      }, () => {
        if (recs.get(chatId) !== r) return;
        r.pending--;
        if (r.pending === 0 && r.held.length && r.state) { const held = r.held; r.held = []; if (apply(r, held)) notify(r); }
      });
      return open;
    },

    ingest(entry) {
      if (!entry || typeof entry.chatId !== 'string') return;
      const r = recs.get(entry.chatId);
      if (!r) return;
      if (r.pending > 0 || !r.state) { r.held.push(entry); return; }
      if (apply(r, [entry])) notify(r);
    },

    forget(chatId) {
      const r = recs.get(chatId);
      if (!r) return;
      recs.delete(chatId);
      r.state = null;
      notify(r);
    },
  };
}
