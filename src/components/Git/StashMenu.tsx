import { useState, useRef, useEffect } from 'react';
import { StashEntry } from '../../types';

interface StashMenuProps {
  projectPath: string;
  onRefresh: () => void;
  disabled?: boolean;
}

export default function StashMenu({ projectPath, onRefresh, disabled }: StashMenuProps) {
  const [open, setOpen] = useState(false);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    (window.sai as any).gitStashList(projectPath).then(setStashes);
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowMessageInput(false);
        setMessageInput('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, projectPath]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onRefresh(); setOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        title="Stash"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        style={{
          background: open ? 'var(--accent)' : 'none',
          color: open ? '#000' : 'var(--text-muted)',
          border: 'none',
          borderRadius: 3,
          padding: '2px 6px',
          fontSize: 10,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        ≡ Stash ▾
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            minWidth: 220,
            background: 'var(--bg-elevated, #1c2128)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '2px 10px 4px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Save
            </div>
            <button
              onClick={() => run(() => (window.sai as any).gitStash(projectPath, undefined))}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: '5px 10px', fontSize: 11, textAlign: 'left', fontFamily: 'inherit' }}
            >
              ↓ Stash WIP
            </button>
            {showMessageInput ? (
              <div style={{ padding: '4px 10px', display: 'flex', gap: 4 }}>
                <input
                  autoFocus
                  value={messageInput}
                  onChange={e => setMessageInput(e.target.value)}
                  placeholder="Stash message…"
                  aria-label="Stash message"
                  style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && messageInput.trim()) run(() => (window.sai as any).gitStash(projectPath, messageInput.trim()));
                    if (e.key === 'Escape') { setShowMessageInput(false); setMessageInput(''); }
                  }}
                />
                <button
                  onClick={() => { if (messageInput.trim()) run(() => (window.sai as any).gitStash(projectPath, messageInput.trim())); }}
                  disabled={!messageInput.trim()}
                  style={{ background: messageInput.trim() ? 'var(--accent)' : 'var(--bg-hover)', color: messageInput.trim() ? '#000' : 'var(--text-muted)', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 10, cursor: messageInput.trim() ? 'pointer' : 'not-allowed' }}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowMessageInput(true)}
                style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: '5px 10px', fontSize: 11, textAlign: 'left', fontFamily: 'inherit' }}
              >
                ↓ Stash with message…
              </button>
            )}
          </div>

          <div style={{ padding: '4px 0', maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ padding: '2px 10px 4px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Stashes ({stashes.length})
            </div>
            {stashes.length === 0 && (
              <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>No stashes</div>
            )}
            {stashes.map(s => (
              <div key={s.index} style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.message}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{s.fileCount} files · {s.date}</div>
                </div>
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {(['Pop', 'Apply', 'Drop'] as const).map(action => (
                    <button
                      key={action}
                      onClick={() => {
                        if (action === 'Pop') run(() => (window.sai as any).gitStashPop(projectPath, s.index));
                        else if (action === 'Apply') run(() => (window.sai as any).gitStashApply(projectPath, s.index));
                        else run(() => (window.sai as any).gitStashDrop(projectPath, s.index));
                      }}
                      style={{
                        background: action === 'Pop' ? 'var(--green)' : action === 'Apply' ? 'var(--blue)' : 'var(--red)',
                        color: '#000',
                        border: 'none',
                        borderRadius: 2,
                        padding: '1px 5px',
                        fontSize: 9,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
