import { useEffect, useState } from 'react';
import type { WireClient } from '../wire';
import DiffViewer from './DiffViewer';

interface StatusEntry { path: string; status: string; staged: boolean }

interface Props {
  client: WireClient;
  cwd: string;
}

const STATUS_LABEL: Record<string, { letter: string; color: string }> = {
  modified: { letter: 'M', color: 'var(--orange)' },
  added:    { letter: 'A', color: 'var(--green)' },
  deleted:  { letter: 'D', color: 'var(--red)' },
  renamed:  { letter: 'R', color: 'var(--blue)' },
};

export default function ChangesView({ client, cwd }: Props) {
  const [entries, setEntries] = useState<StatusEntry[]>([]);
  const [selected, setSelected] = useState<StatusEntry | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoadingList(true); setErr(null); setSelected(null); setDiff('');
    client.statusFiles(cwd)
      .then((e) => setEntries(e as StatusEntry[]))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingList(false));
  }, [client, cwd]);

  useEffect(() => {
    if (!selected) return;
    setLoadingDiff(true);
    client.diffFile(cwd, selected.path, selected.staged)
      .then((r) => setDiff((r as any).diff ?? ''))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingDiff(false));
  }, [client, cwd, selected]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: '0 0 auto', maxHeight: '40%', overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
        {loadingList && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
        {err && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        {!loadingList && !err && entries.length === 0 && (
          <div style={{ padding: '14px', fontSize: 13, color: 'var(--text-muted)' }}>
            No uncommitted changes.
          </div>
        )}
        {entries.map((e, i) => {
          const meta = STATUS_LABEL[e.status] ?? { letter: '?', color: 'var(--text-muted)' };
          const active = selected?.path === e.path && selected?.staged === e.staged;
          return (
            <button
              key={`${e.path}-${i}`}
              onClick={() => setSelected(e)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '8px 14px',
                background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                color: 'var(--text)',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 16,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                fontWeight: 700,
                color: meta.color,
              }}>{meta.letter}</span>
              <span style={{
                flex: 1,
                fontSize: 13,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {e.path}
              </span>
              {e.staged && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontFamily: '"Geist Mono", ui-monospace, monospace',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>staged</span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
        {!selected && !loadingDiff && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            Select a file to view its diff.
          </div>
        )}
        {loadingDiff && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
        {selected && !loadingDiff && <DiffViewer diff={diff} />}
      </div>
    </div>
  );
}
