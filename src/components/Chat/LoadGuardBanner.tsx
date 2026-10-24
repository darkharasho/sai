import { useState } from 'react';
import type { LoadGuardPublicState } from '../../../electron/services/loadGuard';
import type { TopUser } from '../../../electron/services/loadGuard/types';

const gb = (kb: number) => (kb / 1024 / 1024).toFixed(1);

export default function LoadGuardBanner({ state }: { state: LoadGuardPublicState }) {
  const [users, setUsers] = useState<TopUser[] | null>(null);
  if (!state.paused) return null;

  const cause = state.saiCaused ? "SAI's processes are a big part of it."
    : state.saiAppHeavy ? "SAI's app itself is using a lot of memory."
    : 'Not caused by SAI.';

  const toggle = async () => {
    if (users) { setUsers(null); return; }
    setUsers((await window.sai.loadGuardTopUsers?.()) ?? []);
  };

  return (
    <div className="load-guard-banner" role="alert">
      <div className="load-guard-banner-title">AI paused: your PC is under heavy load</div>
      <div className="load-guard-banner-body">{cause} Resumes automatically once things stay calm for 30s.</div>
      <div className="load-guard-meters">
        <Meter label="RAM" pct={state.memUsedPct} />
        <Meter label="Swap" pct={state.swapUsedPct} />
      </div>
      <div className="load-guard-banner-actions">
        <button className="load-guard-btn" onClick={() => { void window.sai.loadGuardResume?.(); }}>Resume anyway</button>
        <button className="load-guard-btn" onClick={() => { void toggle(); }}>What's using memory?</button>
      </div>
      {users && (
        <ul className="load-guard-users">
          {users.map((u, i) => (
            <li key={i} className={u.owner === 'sai-ai' ? 'load-guard-user-sai' : undefined}>
              <span className="load-guard-user-label">{u.label}{u.owner === 'sai-ai' ? ' (SAI)' : ''}</span>
              <span>{gb(u.sizeKb)} GB</span>
            </li>
          ))}
        </ul>
      )}
      <style>{`
        .load-guard-banner {
          flex-shrink: 0;
          padding: 10px 16px;
          border-bottom: 1px solid var(--border-hairline);
          background: color-mix(in srgb, var(--red) 10%, var(--surface-2));
          border-left: 3px solid var(--red);
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
          font-size: 12px;
        }
        .load-guard-banner-title { font-weight: 600; color: var(--red); }
        .load-guard-banner-body { color: var(--text-secondary, inherit); }
        .load-guard-meters { display: flex; gap: 16px; }
        .load-guard-meter { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
        .load-guard-meter-track { flex: 1; height: 4px; border-radius: 2px; background: var(--surface-3, var(--surface-2)); overflow: hidden; }
        .load-guard-meter-fill { height: 100%; background: var(--red); }
        .load-guard-banner-actions { display: flex; gap: 8px; }
        .load-guard-btn {
          padding: 3px 10px; border-radius: 6px; font-size: 11px; cursor: pointer;
          color: inherit; background: var(--surface-3, transparent); border: 1px solid var(--border-hairline);
        }
        .load-guard-btn:hover { border-color: var(--red); }
        .load-guard-users { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
        .load-guard-users li { display: flex; justify-content: space-between; gap: 12px; }
        .load-guard-user-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .load-guard-user-sai { color: var(--red); }
      `}</style>
    </div>
  );
}

function Meter({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="load-guard-meter">
      <span>{label} {pct}%</span>
      <div className="load-guard-meter-track"><div className="load-guard-meter-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
    </div>
  );
}
