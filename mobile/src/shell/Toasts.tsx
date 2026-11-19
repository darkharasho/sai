// Phone toasts: chat errors (the `sai-chat-error` window event ChatPanel and
// useChatLog emit), shim notices, and connection problems ("Can't reach",
// "Re-pair").
import React, { useEffect, useRef, useState } from 'react';
import type { V2Client } from '../v2/client';
import type { ConnState } from '../v2/types';

export interface Toast {
  id: string;
  message: string;
  action?: { label: string; onClick: () => void };
  /** Stays until dismissed by id (connection toasts); otherwise it times out. */
  sticky?: boolean;
}

/** How long a non-sticky toast stays. */
export const TOAST_MS = 4_000;
/** "Can't reach" shows once the connection has been offline this long. */
export const OFFLINE_TOAST_MS = 5_000;

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<(t: Toast[]) => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const cb of [...listeners]) cb(toasts);
}

/** Shows a toast (an existing id is replaced). Returns its id. */
export function showToast(message: string, opts: Omit<Toast, 'id' | 'message'> & { id?: string } = {}): string {
  const id = opts.id ?? `t${++seq}`;
  const t: Toast = { id, message, ...(opts.action ? { action: opts.action } : {}), ...(opts.sticky ? { sticky: true } : {}) };
  toasts = [...toasts.filter((x) => x.id !== id), t];
  const old = timers.get(id);
  if (old) clearTimeout(old);
  timers.delete(id);
  if (!t.sticky) timers.set(id, setTimeout(() => dismissToast(id), TOAST_MS));
  emit();
  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** The connection toasts for one machine: "Can't reach" after 5s offline, "Re-pair" when unpaired. */
export function useConnectionToasts(client: V2Client | null, machineLabel: string, onRepair: () => void): void {
  const repair = useRef(onRepair);
  repair.current = onRepair;
  useEffect(() => {
    if (!client) return;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    const clearOffline = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = null;
      dismissToast('conn-offline');
    };
    const on = (s: ConnState) => {
      if (s === 'offline' || s === 'connecting') {
        // A reconnect cycles connecting/offline: the 5s clock keeps running.
        if (!offlineTimer && s === 'offline') {
          offlineTimer = setTimeout(() => {
            showToast(`Can't reach ${machineLabel}`, { id: 'conn-offline', sticky: true });
          }, OFFLINE_TOAST_MS);
        }
        return;
      }
      clearOffline();
      if (s === 'unpaired') {
        showToast(`Re-pair ${machineLabel}`, {
          id: 'conn-unpaired', sticky: true,
          action: { label: 'Re-pair', onClick: () => { dismissToast('conn-unpaired'); repair.current(); } },
        });
      } else {
        dismissToast('conn-unpaired');
      }
    };
    on(client.state);
    const off = client.onState(on);
    return () => {
      off();
      clearOffline();
      dismissToast('conn-unpaired');
    };
  }, [client, machineLabel]);
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setList);
    setList(toasts);
    const onChatError = (e: Event) => {
      const message = (e as CustomEvent<{ message?: unknown }>).detail?.message;
      if (typeof message === 'string' && message) showToast(message);
    };
    window.addEventListener('sai-chat-error', onChatError);
    return () => {
      listeners.delete(setList);
      window.removeEventListener('sai-chat-error', onChatError);
    };
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="sai-phone-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="sai-phone-toast" data-testid="toast">
          <span className="sai-phone-toast-msg">{t.message}</span>
          {t.action && (
            <button type="button" className="sai-phone-toast-action" onClick={t.action.onClick}>{t.action.label}</button>
          )}
          {!t.sticky && (
            <button type="button" className="sai-phone-toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
          )}
        </div>
      ))}
    </div>
  );
}
