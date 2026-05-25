import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';

interface Status { running: boolean; url: string | null; reason: string | null; pairedCount: number; enabled: boolean }
interface Device { id: string; label: string; pairedAt: number; lastSeenAt: number | null; revokedAt: number | null }

function relative(ts: number | null): string {
  if (!ts) return 'never';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  background: 'var(--bg-secondary)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--accent)',
  color: '#000',
  borderColor: 'var(--accent)',
  fontWeight: 500,
};

const codeStyle: React.CSSProperties = {
  fontSize: 11,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  padding: '2px 6px',
  borderRadius: 4,
  color: 'var(--text)',
  fontFamily: 'monospace',
};

export default function RemoteSettings() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [pairQr, setPairQr] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  const refresh = useCallback(async () => {
    const s: Status = await window.sai.remote.status();
    setStatus(s);
    setDevices(await window.sai.remote.listDevices());
  }, []);

  useEffect(() => {
    void window.sai.remote.status().then((s: Status) => setEnabled(Boolean(s.enabled)));
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); setNow(Date.now()); }, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await window.sai.remote.setEnabled(next);
    await refresh();
  };

  const startPair = async () => {
    const { url, expiresAt } = await window.sai.remote.mintPairCode();
    setPairUrl(url);
    setPairExpiresAt(expiresAt);
    setPairQr(await QRCode.toDataURL(url, { width: 256, margin: 1 }));
  };

  const revoke = async (id: string) => {
    await window.sai.remote.revoke(id);
    await refresh();
  };

  const countdown = pairExpiresAt ? Math.max(0, Math.ceil((pairExpiresAt - now) / 1000)) : 0;
  const pairExpired = pairExpiresAt !== null && countdown <= 0;
  const dotColor = status?.running ? 'var(--green)' : 'var(--red)';

  return (
    <section className="settings-section">
      <div className="settings-section-label">Mobile Remote</div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14, lineHeight: 1.5 }}>
        Access SAI from your phone over Tailscale. The bridge binds only to your tailnet IP and never to a public interface.
      </p>

      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Enable Mobile Remote</div>
          <div className="settings-row-desc">Start the bridge server on your tailnet IP</div>
        </div>
        <button
          className={`settings-toggle ${enabled ? 'on' : ''}`}
          onClick={toggle}
          aria-label="Toggle Mobile Remote"
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>

      <div className="settings-divider" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
          <span style={{ color: 'var(--text)' }}>{status?.running ? 'Running' : 'Not running'}</span>
        </div>
        {status?.url && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            URL: <span style={codeStyle}>{status.url}</span>
          </div>
        )}
        {status?.reason && !status.running && (
          <div style={{ fontSize: 11, color: 'var(--orange)' }}>{status.reason}</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Paired devices: {status?.pairedCount ?? 0}
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Pair a new device</div>
          <div className="settings-row-desc">Generates a 120-second QR code to scan with your phone camera</div>
        </div>
        <button
          onClick={startPair}
          disabled={!status?.running}
          style={{ ...primaryButtonStyle, opacity: status?.running ? 1 : 0.5, cursor: status?.running ? 'pointer' : 'not-allowed' }}
        >
          Pair device
        </button>
      </div>

      {pairQr && !pairExpired && (
        <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <img src={pairQr} alt="Pairing QR" style={{ width: 180, height: 180, background: '#fff', padding: 6, borderRadius: 6 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>Scan with your phone's camera</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Expires in {countdown}s</div>
            <div style={{ ...codeStyle, wordBreak: 'break-all', maxWidth: '100%' }}>{pairUrl}</div>
          </div>
        </div>
      )}

      {pairExpired && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--orange)' }}>
          Pairing code expired. Click "Pair device" again.
        </div>
      )}

      <div className="settings-divider" />

      <div className="settings-section-label" style={{ marginBottom: 10 }}>Paired devices</div>
      {devices.filter((d) => !d.revokedAt).length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No devices paired yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {devices.filter((d) => !d.revokedAt).map((d) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>last seen {relative(d.lastSeenAt)}</div>
            </div>
            <button onClick={() => revoke(d.id)} style={buttonStyle}>Revoke</button>
          </div>
        ))}
      </div>
    </section>
  );
}
