import { useEffect, useState } from 'react';
import type { LoadGuardPublicState } from '../../electron/services/loadGuard';

const DEFAULT_STATE: LoadGuardPublicState = {
  level: 'normal', paused: false, override: false, saiCaused: false, saiAppHeavy: false,
  memUsedPct: 0, swapUsedPct: 0, game: null, recoveredAt: null, enabled: false,
};

/** Live system-load-guard state: the initial snapshot, then every broadcast. */
export function useLoadGuard(): LoadGuardPublicState {
  const [state, setState] = useState<LoadGuardPublicState>(DEFAULT_STATE);

  useEffect(() => {
    const sai = window.sai;
    if (!sai?.loadGuardOnState) return;
    let live = true;
    // Subscribe first so a broadcast landing before getState resolves wins.
    let gotBroadcast = false;
    const unsub = sai.loadGuardOnState((s) => { gotBroadcast = true; if (live) setState(s); });
    sai.loadGuardGetState?.().then((s) => { if (live && !gotBroadcast && s) setState(s); }).catch(() => {});
    return () => { live = false; unsub?.(); };
  }, []);

  return state;
}
