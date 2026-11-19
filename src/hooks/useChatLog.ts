import { useEffect, useRef, useState } from 'react';
import type { ChatLogEntry, ChatMeta, ChatSettings, ChatState } from '../lib/chat/types';
import { emptyChatState, reduceMany } from '../lib/chat/reducer';
import { ensureChatInLog } from '../lib/chat/migrateToLog';

export interface UseChatLog {
  /** null until the first open resolves */
  state: ChatState | null;
  meta: ChatMeta | null;
  /** The entries applied in the most recent batch; set when that batch's state update is scheduled. */
  lastApplied: React.MutableRefObject<ChatLogEntry[]>;
}

/**
 * Renders a chat from the durable main-process log: subscribe first (buffering), open, reduce,
 * then follow live entries with seq dedupe, per-frame batching and gap recovery.
 */
export function useChatLog(chatId: string | null, fallbackSettings: ChatSettings): UseChatLog {
  const [state, setState] = useState<ChatState | null>(null);
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const lastApplied = useRef<ChatLogEntry[]>([]);
  const settingsRef = useRef(fallbackSettings);
  settingsRef.current = fallbackSettings;

  useEffect(() => {
    setState(null);
    setMeta(null);
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

    const flush = () => {
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      if (!current || queue.length === 0) return;
      const batch = queue;
      queue = [];
      current = reduceMany(current, batch);
      lastApplied.current = batch;
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
        lastApplied.current = applied;
        setState(current);
        if (res.meta) setMeta(res.meta);
        recovering = false;
        drainBuffer();
      }).catch(() => { if (alive) { recovering = false; drainBuffer(); } });
    };

    const handle = (entry: ChatLogEntry) => {
      if (entry.seq <= head) return;
      if (entry.seq === head + 1) {
        head = entry.seq;
        queue.push(entry);
        if (raf === null) raf = requestAnimationFrame(() => { raf = null; flush(); });
        return;
      }
      buffer.push(entry); // gap: fetch the missing range, then replay anything held
      if (!recovering) recover();
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
      if (!ready || recovering) { buffer.push(entry); return; }
      handle(entry);
    });

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
    })().catch(() => { /* leave state null; a later switch or remount retries */ });

    return () => {
      alive = false;
      off();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [chatId]);

  return { state, meta, lastApplied };
}
