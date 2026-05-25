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

export default function RemoteSettings() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [pairQr, setPairQr] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  const refresh = useCallback(async () => {
    setStatus(await window.sai.remote.status());
    setDevices(await window.sai.remote.listDevices());
  }, []);

  // Initialize toggle from persisted status
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

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-2">Mobile Remote</h2>
        <p className="text-sm text-neutral-400 mb-4">
          Access SAI from your phone over Tailscale. The bridge binds only to your tailnet IP and never to a public interface.
        </p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={toggle} />
          <span>Enable Mobile Remote</span>
        </label>
      </div>

      <div className="rounded border border-neutral-800 p-4 space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${status?.running ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>{status?.running ? 'Running' : 'Not running'}</span>
        </div>
        {status?.url && (
          <div className="text-neutral-300">
            URL: <code className="text-xs bg-neutral-900 px-1 py-0.5 rounded">{status.url}</code>
          </div>
        )}
        {status?.reason && !status.running && (
          <div className="text-amber-400 text-xs">{status.reason}</div>
        )}
        <div className="text-neutral-400 text-xs">Paired devices: {status?.pairedCount ?? 0}</div>
      </div>

      <div>
        <button
          onClick={startPair}
          disabled={!status?.running}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
        >
          Pair a new device
        </button>
        {pairQr && !pairExpired && (
          <div className="mt-4 flex gap-6 items-start">
            <img src={pairQr} alt="Pairing QR" className="w-48 h-48 bg-white p-2 rounded" />
            <div className="space-y-2 text-sm">
              <div>Scan with your phone's camera.</div>
              <div className="text-xs text-neutral-400">Expires in {countdown}s</div>
              <div className="text-xs break-all text-neutral-500">{pairUrl}</div>
            </div>
          </div>
        )}
        {pairExpired && (
          <div className="mt-2 text-xs text-amber-400">Pairing code expired. Click "Pair a new device" again.</div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Paired devices</h3>
        {devices.length === 0 && <div className="text-xs text-neutral-500">No devices paired yet.</div>}
        <ul className="divide-y divide-neutral-800">
          {devices.filter((d) => !d.revokedAt).map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div>{d.label}</div>
                <div className="text-xs text-neutral-500">last seen {relative(d.lastSeenAt)}</div>
              </div>
              <button
                onClick={() => revoke(d.id)}
                className="px-2 py-1 rounded bg-neutral-800 hover:bg-red-700 text-xs"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
