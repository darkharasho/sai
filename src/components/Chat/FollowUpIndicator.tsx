// src/components/Chat/FollowUpIndicator.tsx
import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { WAITING_CSS } from './WaitingIndicator';

interface Props {
  state: 'following' | 'resuming' | 'stalled';
  waitingFor: string | null;
  onCheckNow: () => void;
  onDismiss?: () => void;
}

/** Row shown after a turn ends when the AI said it would follow up. Same visual
 *  family as WaitingIndicator (reuses its .sai-waiting* classes). */
export default function FollowUpIndicator({ state, waitingFor, onCheckNow, onDismiss }: Props) {
  const [sent, setSent] = useState(false);
  useEffect(() => { setSent(false); }, [state, waitingFor]);
  const what = waitingFor ?? 'this';
  const stalled = state === 'stalled';
  const text = state === 'following'
    ? `Waiting on ${what} — will pick back up automatically`
    : state === 'resuming'
      ? `${what}: watcher finished — picking back up…`
      : `Said it would follow up on ${what}, but nothing is watching`;

  return (
    <div className={`sai-waiting${stalled ? ' sai-followup-stalled' : ''}`} role="status" aria-live="polite">
      {stalled ? (
        <span className="sai-waiting-icon sai-followup-warn" aria-hidden><AlertTriangle size={14} /></span>
      ) : (
        <span className="sai-waiting-icon" aria-hidden><span className="sai-waiting-orbit" /></span>
      )}
      <span className={stalled ? 'sai-waiting-label' : 'sai-waiting-label sai-shimmer'}>{text}</span>
      {stalled && <button className="sai-waiting-cancel" disabled={sent} onClick={() => { if (sent) return; setSent(true); onCheckNow(); }}>Check now</button>}
      {stalled && onDismiss && <button className="sai-waiting-cancel" aria-label="Dismiss" onClick={onDismiss}><X size={12} aria-hidden /></button>}
      <style>{WAITING_CSS + `
        .sai-followup-stalled { border-color: color-mix(in srgb, var(--warning, #d9a441) 45%, transparent); }
        .sai-followup-warn { color: var(--warning, #d9a441); }
      `}</style>
    </div>
  );
}
