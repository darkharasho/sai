import { useEffect, useState } from 'react';
import { BEARER_KEY, connect, extractPairCode, pair, type WireClient } from './wire';
import Status from './Status';
import Chat from './chat/Chat';
import SaiLogo from './branding/SaiLogo';

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

  const mode = phase === 'init' || phase === 'pairing' ? 'scanner' : phase === 'error' ? 'static' : 'idle';

  return (
    <div style={{
      minHeight: '100svh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      gap: 18,
      textAlign: 'center',
      background: 'var(--bg-primary)',
      color: 'var(--text)',
    }}>
      <SaiLogo mode={mode} size={64} color="var(--accent)" />
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>SAI Remote</h1>
      {phase === 'init' && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontFamily: '"Geist Mono", ui-monospace, monospace' }}>connecting…</p>}
      {phase === 'pairing' && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontFamily: '"Geist Mono", ui-monospace, monospace' }}>pairing…</p>}
      {phase === 'needs-pair' && (
        <div style={{ maxWidth: 320 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>Re-pair required</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Open SAI on your computer, go to Settings → Mobile Remote → Pair a new device, and scan the QR code with your phone camera.
          </p>
        </div>
      )}
      {phase === 'error' && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--red)', fontFamily: '"Geist Mono", ui-monospace, monospace' }}>
          {error}
        </p>
      )}
    </div>
  );
}
