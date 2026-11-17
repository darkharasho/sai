// src/components/Chat/FollowUpIndicator.tsx
import { AlertTriangle } from 'lucide-react';
import { WAITING_CSS } from './WaitingIndicator';

interface Props {
  state: 'following' | 'resuming' | 'stalled';
  waitingFor: string | null;
  onCheckNow: () => void;
}

/** Row shown after a turn ends when the AI said it would follow up. Same visual
 *  family as WaitingIndicator (reuses its .sai-waiting* classes). */
export default function FollowUpIndicator({ state, waitingFor, onCheckNow }: Props) {
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
      {stalled && <button className="sai-waiting-cancel" onClick={onCheckNow}>Check now</button>}
      <style>{WAITING_CSS + `
        .sai-followup-stalled { border-color: color-mix(in srgb, var(--warning, #d9a441) 45%, transparent); }
        .sai-followup-warn { color: var(--warning, #d9a441); }
      `}</style>
    </div>
  );
}
