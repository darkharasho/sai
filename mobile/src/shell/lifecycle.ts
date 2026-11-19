// App lifecycle for the phone shell: foreground resume, the keyboard-aware
// viewport height, the connection state as React state, and the status bar.
import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { V2Client } from '../v2/client';
import type { ConnState } from '../v2/types';

/**
 * Foreground (`appStateChange` with isActive) and coming back online call
 * client.resume(): a dead socket reconnects at once and every subscription
 * catches up from its last seq. Backgrounding never closes the client.
 */
export function startLifecycle(getClient: () => V2Client | null): () => void {
  let stopped = false;
  let handle: { remove: () => Promise<void> | void } | null = null;
  const resume = () => { getClient()?.resume(); };
  void CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) resume(); })
    .then((h) => { if (stopped) void h.remove(); else handle = h; })
    .catch(() => { /* no App plugin (plain browser): the online event still resumes */ });
  window.addEventListener('online', resume);
  return () => {
    stopped = true;
    window.removeEventListener('online', resume);
    if (handle) void handle.remove();
  };
}

/**
 * Keeps `--sai-app-height` on <html> equal to the visual viewport height, so
 * the shell (and the composer at its bottom) ends above the software keyboard
 * even where the keyboard overlays the page instead of resizing it.
 */
export function trackViewport(): () => void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const apply = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--sai-app-height', `${Math.round(h)}px`);
    root.style.setProperty('--sai-app-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
  };
  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  return () => {
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    window.removeEventListener('resize', apply);
  };
}

/** The client's connection state as React state ('offline' with no client). */
export function useConnState(client: V2Client | null): ConnState {
  const [state, setState] = useState<ConnState>(client?.state ?? 'offline');
  useEffect(() => {
    if (!client) { setState('offline'); return; }
    setState(client.state);
    return client.onState(setState);
  }, [client]);
  return state;
}

/** Relative luminance (0–1) of a #rgb / #rrggbb colour; null if unparseable. */
function luminance(color: string): number | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Light status-bar text on a dark theme, dark text on a light one (native only). */
export async function syncStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface-0');
  const lum = luminance(bg);
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: lum !== null && lum > 0.5 ? Style.Light : Style.Dark }).catch(() => {});
}
