import { useEffect, useState } from 'react';
import type { LoadGuardPublicState } from '../../../electron/services/loadGuard';

const RECOVERED_MS = 60_000;

export type LoadGuardPillKind = 'paused' | 'override' | 'warning' | 'recovered';

export function loadGuardPillKind(s: LoadGuardPublicState, now: number): LoadGuardPillKind | null {
  if (s.level === 'critical' && s.paused) return 'paused';
  if (s.level === 'critical' && s.override) return 'override';
  if (s.level === 'warning') return 'warning';
  if (s.level === 'normal' && s.recoveredAt != null && now - s.recoveredAt < RECOVERED_MS) return 'recovered';
  return null;
}

export default function LoadGuardPill({ state }: { state: LoadGuardPublicState }) {
  const [now, setNow] = useState(() => Date.now());

  // The recovered window expires on its own; re-render then rather than waiting for a broadcast.
  useEffect(() => {
    setNow(Date.now());
    if (state.level !== 'normal' || state.recoveredAt == null) return;
    const left = state.recoveredAt + RECOVERED_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(t);
  }, [state.level, state.recoveredAt]);

  const kind = loadGuardPillKind(state, now);
  if (!kind) return null;
  const text =
    kind === 'paused' ? 'Paused · critical load'
    : kind === 'override' ? 'Critical load · resumed manually'
    : kind === 'warning' ? `RAM ${state.memUsedPct}%${state.game ? ' · game running' : ''}`
    : 'Recovered';
  return (
    <>
      <span className={`load-guard-pill load-guard-pill-${kind}`} role="status">{text}</span>
      <style>{`
        .load-guard-pill {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          color: var(--pill-c);
          background: color-mix(in srgb, var(--pill-c) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--pill-c) 40%, transparent);
        }
        .load-guard-pill-warning { --pill-c: var(--accent); }
        .load-guard-pill-paused, .load-guard-pill-override { --pill-c: var(--red); }
        .load-guard-pill-recovered { --pill-c: var(--green); }
      `}</style>
    </>
  );
}
