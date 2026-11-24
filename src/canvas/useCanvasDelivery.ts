import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

/**
 * Send `path`'s pending update to `chatKey`, then mark it delivered, in the same tick:
 * once this returns true nothing is pending, so no later render/effect can send it again.
 */
function deliver(store: CanvasStore, path: string, chatKey: string, send: (text: string) => void): boolean {
  const msg = store.pendingMessage(path, chatKey);
  if (!msg) return false;
  try {
    send(msg);
  } catch (err) {
    console.error('[canvas] delivery failed', err);
    return false;
  }
  store.markDelivered(path, chatKey);
  return true;
}

export function useCanvasDelivery({ store, chatKey, chatBusy, send }: CanvasDeliveryOpts): CanvasDelivery {
  const list = useSyncExternalStore(store.subscribe, store.list);
  // Bumped by timers to re-run the delivery effect / refresh the countdown.
  const [tick, setTick] = useState(0);
  // Canvases the user asked to send while the chat could not take it.
  const forcedRef = useRef(new Set<string>());
  const optsRef = useRef({ store, chatKey, chatBusy, send });
  optsRef.current = { store, chatKey, chatBusy, send };

  const ready = !chatBusy && !!chatKey && !!send;

  // Countdown per auto-send canvas with something pending.
  const now = Date.now();
  const perPath = new Map<string, number>();
  let sendIn: number | null = null;
  if (ready) {
    for (const c of list) {
      if (!c.autoSend || !store.hasPending(c.path, chatKey!)) continue;
      const secs = Math.max(0, Math.ceil((c.lastUserActivityAt + CANVAS_IDLE_MS - now) / 1000));
      perPath.set(c.path, secs);
      sendIn = sendIn === null ? secs : Math.min(sendIn, secs);
    }
  }

  useEffect(() => {
    if (!ready) return;
    const t = Date.now();
    let next = Infinity;
    for (const c of store.list()) {
      const forced = forcedRef.current.has(c.path);
      if (!forced && !c.autoSend) continue;
      if (!store.hasPending(c.path, chatKey!)) {
        forcedRef.current.delete(c.path);
        continue;
      }
      const due = forced ? 0 : c.lastUserActivityAt + CANVAS_IDLE_MS;
      if (due <= t) {
        if (deliver(store, c.path, chatKey!, send!)) forcedRef.current.delete(c.path);
      } else {
        next = Math.min(next, due);
      }
    }
    if (next === Infinity) return;
    const id = setTimeout(() => setTick((n) => n + 1), next - t);
    return () => clearTimeout(id);
  }, [list, tick, store, chatKey, ready, send]);

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
  }, []);

  const sendInFor = (path: string) => perPath.get(path) ?? null;
  return { sendIn, sendInFor, sendNow };
}
