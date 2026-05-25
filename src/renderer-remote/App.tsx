import { useEffect, useState } from 'react';
import { BEARER_KEY, connect, extractPairCode, pair, type WireClient } from './wire';
import Status from './Status';
import Chat from './chat/Chat';

export default function App() {
  const [phase, setPhase] = useState<'init' | 'pairing' | 'connected' | 'needs-pair' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [wsState, setWsState] = useState<'opening' | 'open' | 'closed'>('opening');
  const [client, setClient] = useState<WireClient | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        let bearer = localStorage.getItem(BEARER_KEY);
        const code = extractPairCode(location.href);
        if (code && !bearer) {
          setPhase('pairing');
          const label = navigator.userAgent.slice(0, 64);
          const { token, deviceId } = await pair(code, label);
          localStorage.setItem(BEARER_KEY, JSON.stringify({ token, deviceId, label }));
          history.replaceState(null, '', location.pathname);
          bearer = localStorage.getItem(BEARER_KEY);
        }
        if (!bearer) { setPhase('needs-pair'); return; }
        const { token } = JSON.parse(bearer);
        const c = connect(token);
        c.onState(setWsState);
        c.on((msg) => { if (msg.type === 'auth_ok') setPhase('connected'); });
        setClient(c);
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, []);

  const disconnect = () => {
    client?.close();
    localStorage.removeItem(BEARER_KEY);
    location.reload();
  };

  if (phase === 'connected' && client) {
    if (wsState !== 'open') {
      return <Status deviceLabel="" serverUrl={location.origin} wsState={wsState} onDisconnect={disconnect} />;
    }
    return <Chat client={client} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-3 text-center">
      {phase === 'init' && <p>Connecting…</p>}
      {phase === 'pairing' && <p>Pairing…</p>}
      {phase === 'needs-pair' && (
        <>
          <h1 className="text-xl font-semibold">Re-pair required</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            Open the SAI app on your computer, go to Settings → Mobile Remote → Pair a new device, and scan the QR code with your phone camera.
          </p>
        </>
      )}
      {phase === 'error' && <p className="text-red-400">Error: {error}</p>}
    </div>
  );
}
