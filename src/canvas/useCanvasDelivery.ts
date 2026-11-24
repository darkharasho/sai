import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CanvasStore } from './canvasStore';

/** A canvas auto-sends once its user activity (edits, emits) has been quiet this long. */
export const CANVAS_IDLE_MS = 5000;

export interface CanvasDeliveryOpts {
  store: CanvasStore;
  /** Active chat's session id (or scope); null = nowhere to deliver. */
  chatKey: string | null;
  /** The active chat has a turn in flight. */
  chatBusy: boolean;
  /** Queues text into the active chat (chatSendTextRef path). May throw when no chat is mounted. */
  send: ((text: string) => void) | null;
}

export interface CanvasDelivery {
  /** Whole seconds until the earliest pending auto-send, or null when nothing counts down. */
  sendIn: number | null;
  /** Same, for one canvas. */
  sendInFor(path: string): number | null;
  /** Send now; when the chat is busy, send as soon as it goes idle (no idle window). */
  sendNow(path: string): void;
}

/** After a failed send, wait this long (or for a new send/chatKey) before auto-retrying. */
export const CANVAS_RETRY_MS = 30000;

interface FailStreak {
  send: unknown;
  chatKey: string;
  until: number;
}

export function useCanvasDelivery({ store, chatKey, chatBusy, send }: CanvasDeliveryOpts): CanvasDelivery {
  const list = useSyncExternalStore(store.subscribe, store.list);
  // Bumped by timers to re-run the delivery effect / refresh the countdown.
  const [tick, setTick] = useState(0);
  // Canvases the user asked to send while the chat could not take it.
  const forcedRef = useRef(new Set<string>());
  // Switching chats restarts the idle window: nothing auto-sends sooner than IDLE after it.
  const chatSinceRef = useRef<{ chatKey: string | null; at: number }>({ chatKey, at: 0 });
  if (chatSinceRef.current.chatKey !== chatKey) chatSinceRef.current = { chatKey, at: Date.now() };
  const chatSince = chatSinceRef.current.at;
  // Current failure streak: logged once, auto-retry backs off until `until` (or a new send/chatKey).
  const failRef = useRef<FailStreak | null>(null);
  const optsRef = useRef({ store, chatKey, chatBusy, send });
  optsRef.current = { store, chatKey, chatBusy, send };

  /**
   * Send `path`'s pending update to `chatKey`, then mark it delivered, in the same tick:
   * once this returns true nothing is pending, so no later render/effect can send it again.
   */
  const deliver = useCallback((s: CanvasStore, path: string, key: string, fn: (text: string) => void): boolean => {
    const msg = s.pendingMessage(path, key);
    if (!msg) return false;
    try {
      fn(msg);
    } catch (err) {
      const f = failRef.current;
      if (!f || f.send !== fn || f.chatKey !== key) console.error('[canvas] delivery failed; retrying later', err);
      failRef.current = { send: fn, chatKey: key, until: Date.now() + CANVAS_RETRY_MS };
      return false;
    }
    failRef.current = null;
    s.markDelivered(path, key);
    return true;
  }, []);

  const fail = failRef.current;
  const backingOff = !!fail && fail.send === send && fail.chatKey === chatKey && Date.now() < fail.until;
  const ready = !chatBusy && !!chatKey && !!send;

  // Countdown per auto-send canvas with something pending.
  const now = Date.now();
  const perPath = new Map<string, number>();
  let sendIn: number | null = null;
  if (ready && !backingOff) {
    for (const c of list) {
      if (!c.autoSend || !store.isAutoTarget(c.path, chatKey!) || !store.hasPending(c.path, chatKey!)) continue;
      const from = Math.max(c.lastUserActivityAt, chatSince);
      const secs = Math.max(0, Math.ceil((from + CANVAS_IDLE_MS - now) / 1000));
      perPath.set(c.path, secs);
      sendIn = sendIn === null ? secs : Math.min(sendIn, secs);
    }
  }

  useEffect(() => {
    if (!ready) return;
    const t = Date.now();
    const f = failRef.current;
    if (f && f.send === send && f.chatKey === chatKey && t < f.until) {
      const id = setTimeout(() => setTick((n) => n + 1), f.until - t);
      return () => clearTimeout(id);
    }
    let next = Infinity;
    for (const c of store.list()) {
      const forced = forcedRef.current.has(c.path);
      // Auto-send only reaches the canvas's own chat; others need an explicit send.
      if (!forced && (!c.autoSend || !store.isAutoTarget(c.path, chatKey!))) continue;
      if (!store.hasPending(c.path, chatKey!)) {
        forcedRef.current.delete(c.path);
        continue;
      }
      const due = forced ? 0 : Math.max(c.lastUserActivityAt, chatSince) + CANVAS_IDLE_MS;
      if (due <= t) {
        if (deliver(store, c.path, chatKey!, send!)) forcedRef.current.delete(c.path);
        else if (failRef.current) {
          // Failed: back off (the effect re-runs at the retry time).
          next = Math.min(next, failRef.current.until);
          break;
        }
      } else {
        next = Math.min(next, due);
      }
    }
    if (next === Infinity) return;
    const id = setTimeout(() => setTick((n) => n + 1), next - t);
    return () => clearTimeout(id);
  }, [list, tick, store, chatKey, chatSince, ready, send, deliver]);

  // 1 s display tick, only while something counts down.
  const counting = sendIn !== null;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const sendNow = useCallback((path: string) => {
    const o = optsRef.current;
    if (!o.chatBusy && o.chatKey && o.send) {
      forcedRef.current.delete(path);
      deliver(o.store, path, o.chatKey, o.send);
      return;
    }
    forcedRef.current.add(path);
  }, [deliver]);

  // Stable while the countdown values are unchanged, so the canvas context stays memoized.
  const sig = [...perPath].map(([p, n]) => `${p}=${n}`).join('\n');
  const sendInFor = useMemo(() => {
    const m = new Map(perPath);
    return (path: string) => m.get(path) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return { sendIn, sendInFor, sendNow };
}
