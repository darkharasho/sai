/**
 * True when the shared chat UI is mounted inside the phone (Capacitor) shell.
 * The mobile entry sets `data-sai-phone="1"` on <html>. Read at call time,
 * never cached at module scope, so tests and late entry setup both work.
 */
export function isPhone(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.saiPhone === '1';
}
