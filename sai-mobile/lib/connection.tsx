import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { connectWire, type WireClient } from './wire';
import type { WireState } from './types';
import type { Machine } from './machines';

interface Ctx {
  machine: Machine;
  client: WireClient | null;
  state: WireState;
}

const C = createContext<Ctx | null>(null);

export function useConn(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useConn outside ConnectionProvider');
  return v;
}

export function ConnectionProvider({ machine, token, children }: {
  machine: Machine; token: string; children: React.ReactNode;
}) {
  const [state, setState] = useState<WireState>('opening');
  const clientRef = useRef<WireClient | null>(null);
  const [client, setClient] = useState<WireClient | null>(null);

  useEffect(() => {
    const c = connectWire({ baseUrl: machine.hostUrl, token });
    clientRef.current = c;
    setClient(c);
    const offState = c.onState(setState);

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') c.probe();
    });
    return () => {
      sub.remove();
      offState();
      c.close();
      clientRef.current = null;
    };
  }, [machine.machineId, machine.hostUrl, token]);

  return <C.Provider value={{ machine, client, state }}>{children}</C.Provider>;
}
