import { useState, useRef, useEffect } from 'react';
import { GitBranch, Check, ArrowUp, ArrowDown, Sparkle, Sparkles, Plus, ChevronDown, X } from 'lucide-react';


interface CommitBoxProps {
  branch: string;
  ahead: number;
  behind: number;
  onCommit: (message: string) => Promise<void>;
  onPush: () => Promise<void>;
  onPull: () => Promise<void>;
  onGenerateMessage: () => Promise<string>;
  onListBranches: () => Promise<{ current: string; branches: string[] }>;
  onCheckout: (branch: string) => Promise<void>;
  onCreateBranch: (name: string) => Promise<void>;
}

export default function CommitBox({ branch, ahead, behind, onCommit, onPush, onPull, onGenerateMessage, onListBranches, onCheckout, onCreateBranch }: CommitBoxProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [gitError, setGitError] = useState<string | null>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setBranchMenuOpen(false);
        setCreatingBranch(false);
        setBranchFilter('');
      }
    };
    if (branchMenuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [branchMenuOpen]);

  useEffect(() => {
    if (branchMenuOpen) {
      onListBranches().then(({ branches: b }) => setBranches(b));
      setTimeout(() => filterRef.current?.focus(), 50);
    }
  }, [branchMenuOpen]);

  const filteredBranches = branches.filter(b => b.toLowerCase().includes(branchFilter.toLowerCase()));

  const handleSwitch = async (b: string) => {
    setBusy(true);
    setGitError(null);
    try {
      await onCheckout(b);
    } catch (err: any) {
      setGitError(err?.message ?? 'Failed to switch branch');
    } finally {
      setBusy(false);
      setBranchMenuOpen(false);
      setBranchFilter('');
    }
  };

  const handleCreate = async () => {
    if (!newBranchName.trim()) return;
    setBusy(true);
    setGitError(null);
    try {
      await onCreateBranch(newBranchName.trim());
    } catch (err: any) {
      setGitError(err?.message ?? 'Failed to create branch');
    } finally {
      setBusy(false);
      setBranchMenuOpen(false);
      setCreatingBranch(false);
      setNewBranchName('');
      setBranchFilter('');
    }
  };

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true);
    setGitError(null);
    try {
      await fn();
    } catch (err: any) {
      setGitError(err?.message ?? 'Git operation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!message.trim()) return;
    await handle(async () => {
      await onCommit(message.trim());
      setMessage('');
    });
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Branch selector */}
      <div style={{ position: 'relative' }} ref={branchMenuRef}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}
        >
          <button
            onClick={() => setBranchMenuOpen(!branchMenuOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flex: 1,
              minWidth: 0,
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: 3,
              fontSize: 11,
              textAlign: 'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            title="Switch branch"
          >
            <GitBranch size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {branch || 'no branch'}
            </span>
            <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
          </button>
          <button
            onClick={async () => {
              setGenerating(true);
              try {
                const msg = await onGenerateMessage();
                if (msg) setMessage(msg);
              } finally {
                setGenerating(false);
              }
            }}
            disabled={generating || busy}
            title="Generate commit message with AI"
            className="sparkle-btn"
            style={{
              background: 'none',
              border: 'none',
              color: generating ? 'var(--accent)' : 'var(--text-muted)',
              cursor: generating || busy ? 'not-allowed' : 'pointer',
              padding: 2,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              position: 'relative',
              width: 17,
              height: 17,
            }}
            onMouseEnter={(e) => { if (!generating && !busy) e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={(e) => { if (!generating) e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <span className={`sparkle-frame ${generating ? 'sparkle-phase-1' : ''}`}>
              <Sparkle size={13} />
            </span>
            <span className={`sparkle-frame sparkle-hidden ${generating ? 'sparkle-phase-2' : ''}`}>
              <Sparkles size={13} />
            </span>
          </button>
        </div>

        {branchMenuOpen && (
          <div className="branch-dropup">
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
              <input
                ref={filterRef}
                type="text"
                placeholder="Filter branches…"
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--text)',
                  fontSize: 11,
                  padding: '4px 6px',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setBranchMenuOpen(false); setBranchFilter(''); }
                  if (e.key === 'Enter' && filteredBranches.length === 1) handleSwitch(filteredBranches[0]);
                }}
              />
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {filteredBranches.map(b => (
                <button
                  key={b}
                  onClick={() => handleSwitch(b)}
                  className={`branch-item ${b === branch ? 'active' : ''}`}
                >
                  <GitBranch size={12} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b}</span>
                  {b === branch && <Check size={12} style={{ flexShrink: 0, marginLeft: 'auto' }} />}
                </button>
              ))}
              {filteredBranches.length === 0 && branchFilter && !creatingBranch && (
                <div style={{ padding: '8px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                  No matching branches
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {creatingBranch ? (
                <div style={{ display: 'flex', gap: 4, padding: '6px 8px' }}>
                  <input
                    type="text"
                    placeholder="new-branch-name"
                    value={newBranchName}
                    onChange={e => setNewBranchName(e.target.value)}
                    autoFocus
                    style={{
                      flex: 1,
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      color: 'var(--text)',
                      fontSize: 11,
                      padding: '4px 6px',
                      outline: 'none',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setCreatingBranch(false); setNewBranchName(''); }
                    }}
                  />
                  <button
                    onClick={handleCreate}
                    disabled={!newBranchName.trim()}
                    style={{
                      background: newBranchName.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                      color: newBranchName.trim() ? '#000' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: 3,
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: newBranchName.trim() ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Create
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreatingBranch(true)}
                  className="branch-item"
                  style={{ color: 'var(--accent)', fontWeight: 500 }}
                >
                  <Plus size={12} style={{ flexShrink: 0 }} />
                  <span>New branch…</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Git error banner */}
      {gitError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            padding: '6px 8px',
            background: 'var(--bg-input)',
            borderLeft: '2px solid var(--red)',
            borderRadius: 3,
            fontSize: 11,
            color: 'var(--red)',
            lineHeight: 1.4,
          }}
        >
          <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{gitError}</span>
          <button
            onClick={() => setGitError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--red)',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
            }}
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Commit message textarea */}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message…"
        rows={3}
        disabled={busy}
        style={{
          width: '100%',
          resize: 'vertical' as const,
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--text)',
          fontSize: 12,
          padding: '6px 8px',
          outline: 'none',
          fontFamily: 'inherit',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleCommit();
          }
        }}
      />

      {/* Commit button */}
      <button
        onClick={handleCommit}
        disabled={!message.trim() || busy}
        style={{
          width: '100%',
          padding: '6px 0',
          border: 'none',
          borderRadius: 4,
          background: message.trim() && !busy ? 'var(--accent)' : 'var(--bg-hover)',
          color: message.trim() && !busy ? '#000' : 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 600,
          cursor: message.trim() && !busy ? 'pointer' : 'not-allowed',
          transition: 'background 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          if (message.trim() && !busy)
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
        }}
        onMouseLeave={(e) => {
          if (message.trim() && !busy)
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
        }}
      >
        <Check size={14} style={{ marginRight: 4 }} />
        {busy ? 'Working…' : 'Commit'}
      </button>

      {/* Push / Pull row */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => handle(onPush)}
          disabled={busy}
          title="Push"
          style={{
            flex: 1,
            padding: '5px 0',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-input)',
            color: busy ? 'var(--text-muted)' : 'var(--text-secondary)',
            fontSize: 12,
            cursor: busy ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            if (!busy) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-input)';
          }}
        >
          <ArrowUp size={13} style={{ marginRight: 3 }} />
          Push{ahead > 0 ? ` ${ahead}` : ''}
        </button>

        <button
          onClick={() => handle(onPull)}
          disabled={busy}
          title="Pull"
          style={{
            flex: 1,
            padding: '5px 0',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-input)',
            color: busy ? 'var(--text-muted)' : 'var(--text-secondary)',
            fontSize: 12,
            cursor: busy ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            if (!busy) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-input)';
          }}
        >
          <ArrowDown size={13} style={{ marginRight: 3 }} />
          Pull{behind > 0 ? ` ${behind}` : ''}
        </button>
      </div>
      <style>{`
        .sparkle-frame {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sparkle-hidden {
          opacity: 0;
        }
        .sparkle-phase-1 {
          animation: phase1 1.5s ease-in-out infinite !important;
        }
        .sparkle-phase-2 {
          animation: phase2 1.5s ease-in-out infinite !important;
        }
        @keyframes phase1 {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes phase2 {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
        .branch-dropup {
          position: absolute;
          bottom: 100%;
          left: 0;
          right: 0;
          margin-bottom: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
          z-index: 50;
          overflow: hidden;
        }
        .branch-item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 6px 10px;
          background: none;
          border: none;
          color: var(--text);
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
        }
        .branch-item:hover {
          background: var(--bg-hover);
        }
        .branch-item.active {
          color: var(--accent);
        }
      `}</style>
    </div>
  );
}
