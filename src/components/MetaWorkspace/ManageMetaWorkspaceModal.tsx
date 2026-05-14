import { useState, useEffect, useCallback } from 'react';
import type { MetaWorkspace, MetaWorkspaceProject, MetaWorkspaceRuntime } from '../../types';
import { Layers, X, FolderOpen, Trash2 } from 'lucide-react';
import { basename } from '../../utils/pathUtils';

interface Props {
  meta: MetaWorkspace;
  onClose: () => void;
  onUpdated: (runtime: MetaWorkspaceRuntime) => void;
  onDeleted: (id: string) => void;
}

function generateLinkName(path: string, existing: MetaWorkspaceProject[]): string {
  const base = basename(path) || 'project';
  const usedNames = new Set(existing.map(p => p.linkName));
  if (!usedNames.has(base)) return base;
  let i = 2;
  while (usedNames.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function ManageMetaWorkspaceModal({ meta, onClose, onUpdated, onDeleted }: Props) {
  const [name, setName] = useState(meta.name);
  const [projects, setProjects] = useState<MetaWorkspaceProject[]>(meta.projects);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handlePickAndAdd = useCallback(async () => {
    const folder = await window.sai.selectFolder();
    if (!folder) return;
    setProjects(prev => {
      if (prev.some(p => p.path === folder)) return prev;
      const linkName = generateLinkName(folder, prev);
      return [...prev, { path: folder, linkName, description: undefined }];
    });
  }, []);

  const handleUpdateProject = useCallback((index: number, field: 'linkName' | 'description', value: string) => {
    setProjects(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value || undefined };
      return next;
    });
  }, []);

  const handleRemoveProject = useCallback((index: number) => {
    setProjects(prev => prev.filter((_, i) => i !== index));
  }, []);

  const canSave = name.trim().length > 0 && projects.length > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const runtime = await window.sai.metaWorkspaceUpdate?.(meta.id, {
        name: name.trim(),
        projects: projects.map(p => ({
          path: p.path,
          linkName: p.linkName,
          description: p.description || undefined,
        })),
      });
      if (!runtime) throw new Error('No runtime returned');
      onUpdated(runtime as MetaWorkspaceRuntime);
      onClose();
    } catch (e: any) {
      setSaving(false);
      setError(e?.message ?? 'Failed to save changes');
    }
  }, [canSave, meta.id, name, projects, onUpdated, onClose]);

  const handleConfirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await window.sai.metaWorkspaceDelete?.(meta.id);
      onDeleted(meta.id);
    } catch (e: any) {
      setDeleting(false);
      setError(e?.message ?? 'Failed to delete meta workspace');
      setConfirmingDelete(false);
    }
  }, [meta.id, onDeleted]);

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: '7px 10px',
    fontSize: 13,
    color: 'var(--text)',
    fontFamily: "'JetBrains Mono', monospace",
    boxSizing: 'border-box',
  };

  return (
    <div className="mmwm-overlay" onClick={onClose}>
      <div className="mmwm-modal sai-modal-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Layers size={15} color="var(--accent)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>Manage Meta Workspace</span>
        </div>

        {/* Name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Name</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Workspace name"
            style={{ ...inputStyle, width: '100%' }}
            autoFocus
          />
        </div>

        {/* Projects list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Projects {projects.length > 0 && <span style={{ textTransform: 'none', letterSpacing: 0 }}>({projects.length})</span>}
            </span>
            <button
              onClick={handlePickAndAdd}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'none', border: '1px solid var(--border)', borderRadius: 4,
                color: 'var(--accent)', fontSize: 11, padding: '3px 8px', cursor: 'pointer',
              }}
            >
              <FolderOpen size={11} />
              Add project
            </button>
          </div>

          {projects.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0', textAlign: 'center' }}>
              No projects — add at least one to save.
            </div>
          )}

          {projects.map((project, i) => (
            <div
              key={project.path}
              style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '8px 10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={project.path}
                >
                  {project.path}
                </span>
                <button
                  onClick={() => handleRemoveProject(i)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', borderRadius: 3, flexShrink: 0 }}
                  title="Remove project"
                >
                  <X size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 140px' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Link name</span>
                  <input
                    value={project.linkName}
                    onChange={e => handleUpdateProject(i, 'linkName', e.target.value)}
                    style={{ ...inputStyle, padding: '4px 7px', fontSize: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description <span style={{ textTransform: 'none' }}>(optional)</span></span>
                  <input
                    value={project.description ?? ''}
                    onChange={e => handleUpdateProject(i, 'description', e.target.value)}
                    placeholder="What is this project?"
                    style={{ ...inputStyle, padding: '4px 7px', fontSize: 12 }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 16 }} />

        {/* Error */}
        {error && (
          <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 5, padding: '8px 10px', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Delete section (left side) */}
          <div style={{ flex: 1 }}>
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: '1px solid transparent', borderRadius: 5,
                  color: 'var(--text-muted)', fontSize: 12, padding: '5px 8px', cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'transparent'; }}
              >
                <Trash2 size={12} />
                Delete meta workspace
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#f87171' }}>Real project folders are not touched.</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleConfirmDelete}
                    disabled={deleting}
                    style={{
                      background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.4)',
                      color: '#f87171', borderRadius: 5, padding: '4px 10px', fontSize: 12,
                      cursor: deleting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: '4px 8px' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Save / Cancel (right side) */}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '7px 12px', borderRadius: 5 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              background: 'none',
              border: `1px solid ${canSave ? 'var(--accent)' : 'var(--border)'}`,
              color: canSave ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 5, padding: '7px 16px', fontSize: 13,
              cursor: canSave ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Layers size={13} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <style>{`
        .mmwm-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(2px);
        }
        .mmwm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
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
        .mmwm-modal::-webkit-scrollbar { width: 6px; }
        .mmwm-modal::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
        .mmwm-modal::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}
