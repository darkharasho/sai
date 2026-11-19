import { useCallback, useEffect, useRef, useState } from 'react';
import { getNative, type FullNativeApi } from '../native';
import { checkReachable } from './reachability';
import { listMachines, removeMachine, renameMachine, type Machine } from './store';

export type Reach = 'checking' | 'online' | 'offline';

/** The machine list plus a reachability map that refreshes on mount and on refresh(). */
export function useMachines(native: FullNativeApi = getNative()) {
  const [machines, setMachines] = useState<Machine[]>(() => listMachines());
  const [reach, setReach] = useState<Record<string, Reach>>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(() => {
    const list = listMachines();
    setMachines(list);
    setReach((r) => Object.fromEntries(list.map((m) => [m.id, r[m.id] ?? 'checking'])));
    for (const m of list) {
      void checkReachable(m, native).then((ok) => {
        if (alive.current) setReach((r) => ({ ...r, [m.id]: ok ? 'online' : 'offline' }));
      });
    }
  }, [native]);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = useCallback(async (id: string) => { await removeMachine(id, native); refresh(); }, [native, refresh]);
  const rename = useCallback((id: string, label: string) => { renameMachine(id, label); refresh(); }, [refresh]);
  return { machines, reach, refresh, remove, rename };
}
