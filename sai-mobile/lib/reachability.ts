import { useEffect } from 'react';
import { useMachines } from './machinesStore';
import { health } from './wire';

export function useReachabilityPoll(intervalMs = 30_000) {
  const machines = useMachines((s) => s.machines);
  const touch = useMachines((s) => s.touch);
  const getToken = useMachines((s) => s.getToken);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      for (const m of machines) {
        const tok = await getToken(m.machineId);
        if (!tok || cancelled) continue;
        const ok = await health(m.hostUrl, tok);
        if (cancelled) return;
        if (ok) await touch(m.machineId, Date.now());
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [machines, touch, getToken, intervalMs]);
}
