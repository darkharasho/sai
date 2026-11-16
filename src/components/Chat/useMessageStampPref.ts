import { useState, useEffect } from 'react';

// What the stamp above each finished reply shows: how long the turn took
// (`duration`, the default) or the time of day the reply finished (`time`).
// Cached at module scope; SettingsModal broadcasts changes via the
// `sai-pref-message-stamp` window event.
export type MessageStampMode = 'duration' | 'time';
export const MESSAGE_STAMP_EVENT = 'sai-pref-message-stamp';

let cachedMode: MessageStampMode = 'duration';
if (typeof window !== 'undefined' && (window as any).sai?.settingsGet) {
  Promise.resolve((window as any).sai.settingsGet('messageStampMode', 'duration'))
    .then((v: unknown) => {
      const mode: MessageStampMode = v === 'time' ? 'time' : 'duration';
      if (mode === cachedMode) return;
      cachedMode = mode;
      // Panels that mounted before the setting loaded pick it up too.
      window.dispatchEvent(new CustomEvent(MESSAGE_STAMP_EVENT, { detail: mode }));
    })
    .catch(() => {});
}

export function setMessageStampMode(mode: MessageStampMode): void {
  cachedMode = mode;
  window.dispatchEvent(new CustomEvent(MESSAGE_STAMP_EVENT, { detail: mode }));
}

export function useMessageStampPref(): MessageStampMode {
  const [mode, setMode] = useState<MessageStampMode>(cachedMode);
  useEffect(() => {
    const onPref = (e: Event) => setMode((e as CustomEvent).detail === 'time' ? 'time' : 'duration');
    window.addEventListener(MESSAGE_STAMP_EVENT, onPref);
    // Catch a change that landed between the first render and this effect.
    setMode(cachedMode);
    return () => window.removeEventListener(MESSAGE_STAMP_EVENT, onPref);
  }, []);
  return mode;
}

/** Time of day a reply finished: "2:41 PM", with the date for older days. */
export function formatStampTime(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return time;
  const sameYear = d.getFullYear() === today.getFullYear();
  const date = d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${date}, ${time}`;
}
