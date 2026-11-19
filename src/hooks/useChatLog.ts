import { useEffect, useRef, useState } from 'react';
import type { ChatLogEntry, ChatMeta, ChatSettings, ChatState } from '../lib/chat/types';
import { emptyChatState, reduceMany } from '../lib/chat/reducer';
import { ensureChatInLog } from '../lib/chat/migrateToLog';

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
}

/**
 * Renders a chat from the durable main-process log: subscribe first (buffering), open, reduce,
 * then follow live entries with seq dedupe, per-frame batching and gap recovery.
 */
const backoff = (attempt: number) => Math.min(250 * 2 ** attempt, 5000);
/** A hidden (throttled) window never runs animation frames: batches still apply after this long. */
export const HIDDEN_FLUSH_MS = 250;

export function useChatLog(chatId: string | null, fallbackSettings: ChatSettings): UseChatLog {
  const [held, setHeld] = useState<{ chatId: string; state: ChatState | null; meta: ChatMeta | null } | null>(null);
  const setState = (st: ChatState | null) => setHeld((h) => ({ chatId: chatId as string, meta: null, ...(h && h.chatId === chatId ? h : {}), state: st }));
  const setMeta = (m: ChatMeta | null) => setHeld((h) => ({ chatId: chatId as string, state: null, ...(h && h.chatId === chatId ? h : {}), meta: m }));
  const lastApplied = useRef<ChatLogEntry[]>([]);
  const settingsRef = useRef(fallbackSettings);
  settingsRef.current = fallbackSettings;

  useEffect(() => {
    lastApplied.current = [];
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
      api.open(chatId, after).then((res) => {
        if (!alive) return;
        let applied: ChatLogEntry[];
        if (res.snapshot && res.snapshot.seq > after) {
          current = reduceMany(res.snapshot.state, res.entries);
          applied = res.entries;
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
        if (!alive) return;
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
        const res = await api.open(chatId, 0);
        if (!alive) return;
        const base = res.snapshot ? res.snapshot.state : emptyChatState(settingsRef.current);
        current = reduceMany(base, res.entries);
        head = current.lastSeq;
        ready = true;
        setState(current);
        setMeta(res.meta ?? null);
        drainBuffer();
      })().catch(() => {
        if (!alive) return;
        initialFailed = true;
        buffer = []; // "need full reload": the next successful open(chatId, 0) re-reads everything
        retryTimer = setTimeout(() => { retryTimer = null; if (alive) loadInitial(); }, backoff(initialFails++));
      });
    };
    loadInitial();

    return () => {
      alive = false;
      off();
      if (raf !== null) cancelAnimationFrame(raf);
      if (fallback !== null) clearTimeout(fallback);
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [chatId]);

  const cur = held && held.chatId === chatId ? held : null;
  return { state: cur?.state ?? null, meta: cur?.meta ?? null, lastApplied };
}
