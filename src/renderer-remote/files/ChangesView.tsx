import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { WireClient } from '../wire';
import DiffViewer from './DiffViewer';

interface StatusEntry { path: string; status: string; staged: boolean }

interface Props {
  client: WireClient;
  cwd: string;
  /** Path of the row currently mid-stage-toggle, so we can disable the checkbox. */
  pendingStagePath?: string | null;
  /** Tells the parent to toggle stage for this path. Parent does the WS call + status refresh. */
  onToggleStage?: (path: string, staged: boolean) => void;
  /** Refresh trigger — parent bumps this to force re-fetch (after commit, etc). */
  refreshKey?: number;
}

const STATUS_LABEL: Record<string, { letter: string; color: string }> = {
  modified: { letter: 'M', color: 'var(--orange)' },
  added:    { letter: 'A', color: 'var(--green)' },
  deleted:  { letter: 'D', color: 'var(--red)' },
  renamed:  { letter: 'R', color: 'var(--blue)' },
};

export default function ChangesView({ client, cwd, pendingStagePath, onToggleStage, refreshKey }: Props) {
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
  }, [client, cwd, refreshKey]);

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
            <div
              key={`${e.path}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  onToggleStage?.(e.path, e.staged);
                }}
                disabled={pendingStagePath === e.path || !onToggleStage}
                aria-label={e.staged ? `Unstage ${e.path}` : `Stage ${e.path}`}
                style={{
                  width: 28,
                  height: 32,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  opacity: pendingStagePath === e.path ? 0.5 : 1,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 14, height: 14,
                    borderRadius: 3,
                    border: `1.5px solid ${e.staged ? 'var(--accent)' : 'var(--text-muted)'}`,
                    background: e.staged ? 'var(--accent)' : 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#000',
                    fontSize: 10,
                    lineHeight: 1,
                  }}
                >
                  {e.staged ? <Check size={10} strokeWidth={3} /> : null}
                </span>
              </button>
              <button
                onClick={() => setSelected(e)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flex: 1,
                  textAlign: 'left',
                  padding: '8px 14px 8px 4px',
                  background: 'transparent',
                  color: 'var(--text)',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  minWidth: 0,
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
              </button>
            </div>
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
