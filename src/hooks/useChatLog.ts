import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import type { ChatLogEntry, ChatMeta, ChatSettings, ChatState } from '../lib/chat/types';
import { isChatLogUnavailable } from '../lib/chat/types';
import { emptyChatState, reduceMany } from '../lib/chat/reducer';
import { ensureChatInLog, forgetChatImported, isChatImported } from '../lib/chat/migrateToLog';

export interface UseChatLog {
  /** null until the first open resolves */
  state: ChatState | null;
  meta: ChatMeta | null;
  /**
   * Entries applied since the consumer last drained it. The hook APPENDS (never replaces) when a batch's
   * state update is scheduled; the consumer drains it by setting `lastApplied.current = []`. Initial-open
   * history is never added (loading history must not trigger side effects). Reset on chatId change.
   */
  lastApplied: React.MutableRefObject<ChatLogEntry[]>;
  /** Set when main's chat storage failed to start ("Chat storage unavailable: …"); the hook stops retrying. */
  error: string | null;
  /** Messages older than the loaded window that main still holds (phone only; 0 on desktop). */
  olderCount: number;
  /** Fetch and prepend the next page of older messages. No-op while one is in flight, or when there is nothing older. */
  loadOlder(): Promise<void>;
}

/** Page size for loadOlder. */
export const OLDER_PAGE_LIMIT = 200;

/** Stitch an older page in front of a state's messages; turn.startIndex shifts by the number prepended. */
export function prependOlder(state: ChatState, older: ChatMessage[]): ChatState {
  if (older.length === 0) return state;
  const si = state.turn.startIndex;
  return {
    ...state,
    messages: [...older, ...state.messages],
    turn: si == null ? state.turn : { ...state.turn, startIndex: si + older.length },
  };
}

/** The unavailable-storage toast shows once per renderer, however many panels hit it. */
let unavailableToastShown = false;
/** Test hook. */
export function _resetUnavailableToastForTests(): void { unavailableToastShown = false; }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Renders a chat from the durable main-process log: subscribe first (buffering), open, reduce,
 * then follow live entries with seq dedupe, per-frame batching and gap recovery.
 */
const backoff = (attempt: number) => Math.min(250 * 2 ** attempt, 5000);
/** A hidden (throttled) window never runs animation frames: batches still apply after this long. */
export const HIDDEN_FLUSH_MS = 250;

export function useChatLog(chatId: string | null, fallbackSettings: ChatSettings): UseChatLog {
  const [held, setHeld] = useState<{ chatId: string; state: ChatState | null; meta: ChatMeta | null; olderCount: number } | null>(null);
  const [failure, setFailure] = useState<{ chatId: string; message: string } | null>(null);
  const setState = (st: ChatState | null) => setHeld((h) => ({ chatId: chatId as string, meta: null, olderCount: 0, ...(h && h.chatId === chatId ? h : {}), state: st }));
  const setMeta = (m: ChatMeta | null) => setHeld((h) => ({ chatId: chatId as string, state: null, olderCount: 0, ...(h && h.chatId === chatId ? h : {}), meta: m }));
  const setOlder = (n: number) => setHeld((h) => ({ chatId: chatId as string, state: null, meta: null, ...(h && h.chatId === chatId ? h : {}), olderCount: n }));
  const loadOlderRef = useRef<() => Promise<void>>(async () => {});
  const loadOlder = useCallback(() => loadOlderRef.current(), []);
  const lastApplied = useRef<ChatLogEntry[]>([]);
  const settingsRef = useRef(fallbackSettings);
  settingsRef.current = fallbackSettings;

  useEffect(() => {
    lastApplied.current = [];
    loadOlderRef.current = async () => {};
    const api = window.sai?.chatlog;
    if (!chatId || !api) return;

    let alive = true;
    let ready = false;       // initial open resolved
    let recovering = false;  // a gap-recovery open is pending
    let current: ChatState | null = null; // reduced state, including flushed batches
    let head = 0;            // highest seq applied or queued
    let queue: ChatLogEntry[] = [];
    let buffer: ChatLogEntry[] = []; // live entries held while an open is pending
    let raf: number | null = null;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let recoverFails = 0;
    let initialFails = 0;
    let initialFailed = false; // initial open is failing: live entries are dropped (open(0) re-reads them)
    let older = 0;             // messages main holds before current.messages[0]
    let paging = false;        // a page request is in flight
    let pageGen = 0;           // bumped when current is replaced by a snapshot: older pages are stale
    let epoch = 0;             // bumped by a history_imported reload: older recovery opens are stale

    const flush = () => {
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      if (fallback !== null) { clearTimeout(fallback); fallback = null; }
      if (!current || queue.length === 0) return;
      const batch = queue;
      queue = [];
      current = reduceMany(current, batch);
      lastApplied.current = [...lastApplied.current, ...batch];
      const next = current;
      setState(next);
    };

    const recover = () => {
      flush();
      recovering = true;
      const after = current ? current.lastSeq : 0;
      const mine = epoch;
      api.open(chatId, after).then((res) => {
        if (!alive || mine !== epoch) return;
        let applied: ChatLogEntry[];
        if (res.snapshot && res.snapshot.seq > after) {
          current = reduceMany(res.snapshot.state, res.entries);
          applied = res.entries;
          pageGen++;
          older = res.olderCount ?? 0;
          setOlder(older);
        } else {
          applied = res.entries.filter((e) => e.seq > after);
          current = reduceMany(current!, applied);
        }
        head = current.lastSeq;
        lastApplied.current = [...lastApplied.current, ...applied];
        setState(current);
        if (res.meta) setMeta(res.meta);
        recovering = false;
        recoverFails = 0;
        drainBuffer();
      }).catch(() => {
        if (!alive || mine !== epoch) return;
        recovering = false;
        // Keep the gap entry buffered; retry with capped backoff (or sooner via the next in-order entry).
        retryTimer = setTimeout(() => { retryTimer = null; if (alive && !recovering) recover(); }, backoff(recoverFails++));
      });
    };

    const handle = (entry: ChatLogEntry) => {
      if (entry.seq <= head) return;
      if (entry.seq === head + 1 && entry.ev?.type === 'history_imported') {
        // Main folded the chat's pre-log history in front of what we hold:
        // reload from seq 0 (history, so no side effects).
        flush();
        // A pending recovery (or its retry) must not race the reload.
        epoch++;
        if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
        recovering = false;
        recoverFails = 0;
        ready = false;
        buffer = [];
        loadInitial();
        return;
      }
      if (entry.seq === head + 1) {
        head = entry.seq;
        queue.push(entry);
        if (raf === null) raf = requestAnimationFrame(() => { raf = null; flush(); });
        if (fallback === null && queue.length > 0) fallback = setTimeout(() => { fallback = null; flush(); }, HIDDEN_FLUSH_MS);
        return;
      }
      buffer.push(entry); // gap: fetch the missing range, then replay anything held
      if (!recovering && retryTimer === null) recover();
    };

    const drainBuffer = () => {
      const held = buffer.sort((a, b) => a.seq - b.seq);
      buffer = [];
      for (const e of held) {
        if (recovering) buffer.push(e); else handle(e);
      }
    };

    const off = api.onEvent((entry) => {
      if (!alive || !entry || entry.chatId !== chatId) return;
      if (!ready && initialFailed) return;
      if (!ready || recovering) { buffer.push(entry); return; }
      handle(entry);
    });

    const loadInitial = () => {
      initialFailed = false;
      (async () => {
        try { await ensureChatInLog(chatId); } catch { /* open anyway */ }
        // The panel's open: main kicks this chat's queue drain (reads elsewhere don't).
        const res = await api.open(chatId, 0, { panel: true });
        if (!alive) return;
        if (res.meta && !res.meta.imported && isChatImported(chatId)) {
          // Main lost the history this session already settled (its snapshot
          // went missing): re-fold it from the IndexedDB mirror. The fold's
          // history_imported entry reloads this hook.
          forgetChatImported(chatId);
          void ensureChatInLog(chatId).catch(() => { /* retried on the next open */ });
        }
        const base = res.snapshot ? res.snapshot.state : emptyChatState(settingsRef.current);
        current = reduceMany(base, res.entries);
        head = current.lastSeq;
        ready = true;
        pageGen++;
        older = res.olderCount ?? 0;
        setOlder(older);
        setState(current);
        setMeta(res.meta ?? null);
        drainBuffer();
      })().catch((err) => {
        if (!alive) return;
        if (isChatLogUnavailable(err)) {
          // Main's chat storage never started: retrying can't help. Show it.
          const message = errorMessage(err).replace(/^.*?(Chat storage unavailable)/, '$1');
          setFailure({ chatId, message });
          if (!unavailableToastShown) {
            unavailableToastShown = true;
            window.dispatchEvent(new CustomEvent('sai-chat-error', { detail: { message: `${message}. Chats can't be loaded or sent until SAI restarts.` } }));
          }
          return;
        }
        initialFailed = true;
        buffer = []; // "need full reload": the next successful open(chatId, 0) re-reads everything
        retryTimer = setTimeout(() => { retryTimer = null; if (alive) loadInitial(); }, backoff(initialFails++));
      });
    };
    loadInitial();

    loadOlderRef.current = async () => {
      if (paging || !alive || !ready || older <= 0 || !api.page) return;
      paging = true;
      const gen = pageGen;
      try {
        const res = await api.page!(chatId, older, OLDER_PAGE_LIMIT);
        if (!alive || gen !== pageGen || !current) return;
        flush(); // queued live entries reduce first, so the prepend shifts the latest startIndex
        current = prependOlder(current, res.messages);
        older = res.olderCount;
        setOlder(older);
        setState(current);
      } catch { /* the row stays; the user can retry */ } finally { paging = false; }
    };

    return () => {
      alive = false;
      off();
      if (raf !== null) cancelAnimationFrame(raf);
      if (fallback !== null) clearTimeout(fallback);
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [chatId]);

  const cur = held && held.chatId === chatId ? held : null;
  const error = failure && failure.chatId === chatId ? failure.message : null;
  return { state: cur?.state ?? null, meta: cur?.meta ?? null, lastApplied, error, olderCount: cur?.olderCount ?? 0, loadOlder };
}
