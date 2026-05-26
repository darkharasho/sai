import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { WireClient } from '../wire';

interface Summary { termId: number; cwd: string; cols: number; rows: number; alive: boolean }

interface Props {
  client: WireClient;
  cwd: string;
  /** Called after the user picks (existing) or creates (new) a terminal. */
  onPick: (termId: number) => void;
  onClose: () => void;
}

export default function TerminalPicker({ client, cwd, onPick, onClose }: Props) {
  const [terms, setTerms] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.listTerminals(cwd)
      .then((arr) => { if (!cancelled) setTerms(arr as Summary[]); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, cwd]);

  const onNew = async () => {
    setCreating(true);
    setErr(null);
    try {
      // Reasonable default; Terminal.tsx will resize after mount via fit().
      const r = await client.openTerminal(cwd, 80, 24);
      onPick(r.termId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', flexDirection: 'column',
      background: 'rgba(0,0,0,0.5)',
    }}>
      <button onClick={onClose} aria-label="Close picker" style={{
        flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
      }} />
      <div style={{
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border)',
        borderTopLeftRadius: 12, borderTopRightRadius: 12,
        paddingBottom: 'env(safe-area-inset-bottom)',
        maxHeight: '70vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 14px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Terminals</div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
          }}><X size={18} /></button>
        </div>
        <button
          onClick={onNew}
          disabled={creating}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px', textAlign: 'left',
            background: 'transparent', color: 'var(--accent)', border: 'none',
            borderBottom: '1px solid var(--border)',
            fontSize: 14, cursor: 'pointer',
          }}
        >
          <Plus size={16} /> {creating ? 'Opening…' : 'New terminal'}
        </button>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
          {err && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          {!loading && terms.length === 0 && !err && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
              No terminals yet.
            </div>
          )}
          {terms.map((t) => (
            <button key={t.termId} onClick={() => onPick(t.termId)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', textAlign: 'left',
              padding: '10px 14px', background: 'transparent',
              color: 'var(--text)', border: 'none',
              borderBottom: '1px solid var(--border)',
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              fontSize: 13, cursor: 'pointer',
            }}>
              <span style={{ color: 'var(--accent)' }}>#{t.termId}</span>
              <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.cwd}</span>
              <span style={{ color: 'var(--text-muted)' }}>{t.cols}×{t.rows}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
