import { useState, useRef, useEffect } from 'react';

interface RebaseButtonProps {
  projectPath: string;
  currentBranch: string;
  onRefresh: () => void;
  onListBranches: () => Promise<{ current: string; branches: string[] }>;
  disabled?: boolean;
}

export function RebaseButton({ projectPath, currentBranch, onRefresh, onListBranches, disabled }: RebaseButtonProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    onListBranches().then(({ branches: b }) => {
      setBranches(b.filter(br => br !== currentBranch));
    }).catch(() => setBranches([]));
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false); setFilter(''); setSelected('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, currentBranch, onListBranches]);

  const filtered = branches.filter(b => b.toLowerCase().includes(filter.toLowerCase()));

  const handleRebase = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await (window.sai as any).gitRebase(projectPath, selected);
      onRefresh();
      setOpen(false); setFilter(''); setSelected('');
    } catch (err) {
      console.error('[RebaseButton] rebase failed:', err);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        style={{
          background: open ? 'var(--yellow, #f9e2af)' : 'none',
          color: open ? '#000' : 'var(--text-muted)',
          border: 'none', borderRadius: 3, padding: '2px 6px',
          fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}
      >
        ⟲ Rebase
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          minWidth: 200, background: 'var(--bg-elevated, #1c2128)',
          border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.3)', zIndex: 100, padding: 8,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
            Rebase <strong style={{ color: 'var(--accent)' }}>{currentBranch}</strong> onto…
          </div>
          <input
            autoFocus
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter branches…"
            aria-label="Filter branches"
            style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 4 }}
            onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setFilter(''); setSelected(''); } }}
          />
          <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 6 }}>
            {filtered.map(b => (
              <div
                key={b}
                onClick={() => setSelected(b)}
                style={{
                  padding: '4px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
                  background: selected === b ? 'var(--accent)' : 'none',
                  color: selected === b ? '#000' : 'var(--text)',
                }}
              >
                {b}
              </div>
            ))}
            {filtered.length === 0 && filter && (
              <div style={{ padding: '6px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                No matching branches
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={handleRebase}
              disabled={!selected || busy}
              aria-label="Rebase"
              style={{
                flex: 1, background: selected ? 'var(--yellow, #f9e2af)' : 'var(--bg-hover)',
                color: selected ? '#000' : 'var(--text-muted)',
                border: 'none', borderRadius: 3, padding: '4px 0',
                fontSize: 11, fontWeight: 600, cursor: selected ? 'pointer' : 'not-allowed',
              }}
            >
              Rebase
            </button>
            <button
              onClick={() => { setOpen(false); setFilter(''); setSelected(''); }}
              style={{ flex: 1, background: 'none', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 0', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface RebaseInProgressBannerProps {
  projectPath: string;
  onto: string;
  onRefresh: () => void;
}

export function RebaseInProgressBanner({ projectPath, onto, onRefresh }: RebaseInProgressBannerProps) {
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); onRefresh(); }
    catch (err) { console.error('[RebaseInProgressBanner] operation failed:', err); }
    finally { setBusy(false); }
  };

  return (
    <div style={{
      margin: '8px 12px 0',
      padding: '8px 10px',
      background: 'var(--bg-input)',
      borderLeft: '3px solid var(--yellow, #f9e2af)',
      borderRadius: '0 4px 4px 0',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--yellow, #f9e2af)', marginBottom: 3 }}>
        ⟲ REBASE IN PROGRESS{onto ? ` — onto ${onto}` : ''}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
        Resolve conflicts above, then continue
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={() => run(() => (window.sai as any).gitRebaseContinue(projectPath))}
          disabled={busy}
          style={{ flex: 1, background: 'var(--yellow, #f9e2af)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 0', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
        >
          Continue
        </button>
        <button
          onClick={() => run(() => (window.sai as any).gitRebaseSkip(projectPath))}
          disabled={busy}
          style={{ flex: 1, background: 'var(--bg-hover)', color: 'var(--text-muted)', border: 'none', borderRadius: 3, padding: '3px 0', fontSize: 10, cursor: 'pointer' }}
        >
          Skip
        </button>
        <button
          onClick={() => run(() => (window.sai as any).gitRebaseAbort(projectPath))}
          disabled={busy}
          style={{ flex: 1, background: 'var(--red)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 0', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
        >
          Abort
        </button>
      </div>
    </div>
  );
}
