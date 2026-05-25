import SaiLogo from './branding/SaiLogo';

interface Props {
  deviceLabel: string;
  serverUrl: string;
  wsState: 'opening' | 'open' | 'closed';
  onDisconnect: () => void;
}

export default function Status({ deviceLabel, serverUrl, wsState, onDisconnect }: Props) {
  const dotColor = wsState === 'open' ? 'var(--green)' : wsState === 'opening' ? 'var(--accent)' : 'var(--red)';
  const wsLabel = wsState === 'open' ? 'connected' : wsState === 'opening' ? 'connecting…' : 'disconnected';

  return (
    <div style={{
      minHeight: '100svh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 20,
      background: 'var(--bg-primary)',
      color: 'var(--text)',
    }}>
      <SaiLogo
        mode={wsState === 'open' ? 'pulse' : wsState === 'opening' ? 'scanner' : 'static'}
        size={72}
        color="var(--accent)"
      />
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
        SAI Remote
      </h1>
      {deviceLabel && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontFamily: '"Geist Mono", ui-monospace, monospace' }}>
          {deviceLabel}
        </p>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
      }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
        <span style={{ color: 'var(--text)' }}>{wsLabel}</span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span style={{ color: 'var(--text-muted)' }}>{serverUrl}</span>
      </div>
      <button
        onClick={onDisconnect}
        style={{
          marginTop: 16,
          padding: '10px 18px',
          fontSize: 13,
          background: 'var(--bg-elevated)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Disconnect
      </button>
    </div>
  );
}
