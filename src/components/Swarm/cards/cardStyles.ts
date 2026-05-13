import type { CSSProperties } from 'react';

/**
 * Shared styling tokens / helpers for the swarm chat cards.
 *
 * Cards are intentionally inline-styled rather than CSS-class-based so they
 * stay self-contained — each card is dropped in as a child of ChatMessage
 * which doesn't load any swarm-specific stylesheet.
 */

export const SWARM_RED = '#b44';
export const SWARM_GREEN = '#3a8';

export const cardBase: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  borderRadius: 8,
  padding: '10px 12px',
  margin: '6px 0',
  fontSize: 12,
  color: 'var(--text)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
};

export const cardHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 6,
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  opacity: 0.85,
  fontWeight: 600,
};

export const monoBox: CSSProperties = {
  fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '6px 8px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

export const ghostBtn: CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 11,
  color: 'var(--text)',
  cursor: 'pointer',
};

export const dangerBtn: CSSProperties = {
  ...ghostBtn,
  borderColor: SWARM_RED,
  color: SWARM_RED,
};

export const primaryBtn: CSSProperties = {
  background: SWARM_GREEN,
  color: '#111',
  border: 'none',
  borderRadius: 4,
  padding: '4px 12px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

/**
 * Standard SAI button aesthetic for the swarm chat card actions.
 * `btnBase` is for secondary actions; `btnPrimary` for the primary action
 * on a card; `btnDanger` for destructive actions (discard).
 */
export const btnBase: CSSProperties = {
  fontSize: 11,
  padding: '3px 10px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1.3,
  transition: 'background 0.15s, border-color 0.15s',
};

export const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--accent)',
  color: '#000',
  border: '1px solid transparent',
  fontWeight: 600,
};

export const btnDanger: CSSProperties = {
  ...btnBase,
  color: '#b44',
  borderColor: 'rgba(180,68,68,0.4)',
};

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function safeJsonParse<T = any>(s: string | undefined | null): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}
