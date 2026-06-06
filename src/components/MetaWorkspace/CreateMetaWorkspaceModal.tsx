import { useState, useEffect, useCallback } from 'react';
import type { MetaWorkspaceRuntime } from '../../types';
import { Layers, X, FolderOpen, Plus } from 'lucide-react';
import { basename } from '../../utils/pathUtils';

interface DraftProject {
  path: string;
  linkName: string;
  description: string;
}

interface Props {
  recentProjects: string[];
  onClose: () => void;
  onCreated: (runtime: MetaWorkspaceRuntime) => void;
}

function generateLinkName(path: string, existing: DraftProject[]): string {
  const base = basename(path) || 'project';
  const usedNames = new Set(existing.map(p => p.linkName));
  if (!usedNames.has(base)) return base;
  let i = 2;
  while (usedNames.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function CreateMetaWorkspaceModal({ recentProjects, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<DraftProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Esc closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const addPath = useCallback((path: string) => {
    setDrafts(prev => {
      if (prev.some(d => d.path === path)) return prev;
      const linkName = generateLinkName(path, prev);
      return [...prev, { path, linkName, description: '' }];
    });
  }, []);

  const handlePickFolder = useCallback(async () => {
    const folder = await window.sai.selectFolder();
    if (folder) addPath(folder);
  }, [addPath]);

  const handleUpdateDraft = useCallback((index: number, field: 'linkName' | 'description', value: string) => {
    setDrafts(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const handleRemoveDraft = useCallback((index: number) => {
    setDrafts(prev => prev.filter((_, i) => i !== index));
  }, []);

  const canCreate = name.trim().length > 0 && drafts.length > 0 && !creating;

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    setCreating(true);
    setError('');
    try {
      const runtime = await window.sai.metaWorkspaceCreate?.({
        name: name.trim(),
        projects: drafts.map(d => ({
          path: d.path,
          linkName: d.linkName || basename(d.path),
          description: d.description || undefined,
        })),
      });
      if (!runtime) throw new Error('No runtime returned');
      onCreated(runtime as MetaWorkspaceRuntime);
    } catch (e: any) {
      setCreating(false);
      setError(e?.message ?? 'Failed to create meta workspace');
    }
  }, [canCreate, name, drafts, onCreated]);

  const addedPaths = new Set(drafts.map(d => d.path));
  const availableRecent = recentProjects.filter(p => !addedPaths.has(p));

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 5,
    padding: '7px 10px',
    fontSize: 13,
    color: 'var(--text)',
    fontFamily: "'JetBrains Mono', monospace",
    boxSizing: 'border-box',
  };

  return (
    <div
      className="cmwm-overlay"
      onClick={onClose}
    >
      <div
        className="cmwm-modal sai-modal-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Layers size={15} color="var(--accent)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>New Meta Workspace</span>
        </div>

        {/* Name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Name</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My workspace"
            style={{ ...inputStyle, width: '100%' }}
            autoFocus
          />
        </div>

        {/* Projects list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Projects {drafts.length > 0 && <span style={{ textTransform: 'none', letterSpacing: 0 }}>({drafts.length})</span>}
            </span>
            <button
              onClick={handlePickFolder}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 4,
                color: 'var(--accent)', fontSize: 11, padding: '3px 8px', cursor: 'pointer',
              }}
            >
              <FolderOpen size={11} />
              Pick folder
            </button>
          </div>

          {drafts.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0', textAlign: 'center' }}>
              No projects added yet — pick a folder or add from recent.
            </div>
          )}

          {drafts.map((draft, i) => (
            <div
              key={draft.path}
              style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                borderRadius: 6, padding: '8px 10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={draft.path}>
                  {draft.path}
                </span>
                <button
                  onClick={() => handleRemoveDraft(i)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', borderRadius: 3, flexShrink: 0 }}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 140px' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Link name</span>
                  <input
                    value={draft.linkName}
                    onChange={e => handleUpdateDraft(i, 'linkName', e.target.value)}
                    style={{ ...inputStyle, padding: '4px 7px', fontSize: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description <span style={{ textTransform: 'none' }}>(optional)</span></span>
                  <input
                    value={draft.description}
                    onChange={e => handleUpdateDraft(i, 'description', e.target.value)}
                    placeholder="What is this project?"
                    style={{ ...inputStyle, padding: '4px 7px', fontSize: 12 }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add from recent */}
        {availableRecent.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Add from recent</span>
            <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {availableRecent.map(path => (
                <button
                  key={path}
                  onClick={() => addPath(path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: '1px solid transparent', borderRadius: 4,
                    color: 'var(--text-secondary)', fontSize: 12, padding: '5px 8px',
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-4)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'transparent'; }}
                >
                  <Plus size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border-hairline)', marginBottom: 16 }} />

        {/* Error */}
        {error && (
          <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 5, padding: '8px 10px', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '7px 12px', borderRadius: 5 }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              background: 'none',
              border: `1px solid ${canCreate ? 'var(--accent)' : 'var(--border-subtle)'}`,
              color: canCreate ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 5, padding: '7px 16px', fontSize: 13,
              cursor: canCreate ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Layers size={13} />
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>

      <style>{`
        .cmwm-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(2px);
        }
        .cmwm-modal {
          background: var(--surface-3);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 24px 28px;
          width: 520px;
          max-width: calc(100vw - 48px);
          max-height: calc(100vh - 80px);
          overflow-y: auto;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          display: flex;
          flex-direction: column;
        }
        .cmwm-modal::-webkit-scrollbar { width: 6px; }
        .cmwm-modal::-webkit-scrollbar-thumb { background: var(--border-hairline); border-radius: 3px; }
        .cmwm-modal::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}
