import { useState } from 'react';
import type { ConflictHunk, GitFile } from '../../types';
import ConflictHunkViewer from './ConflictHunkViewer';

interface ConflictSectionProps {
  projectPath: string;
  conflictFiles: string[];
  onRefresh: () => void;
  onOpenEditor: (file: GitFile) => void;
}

export default function ConflictSection({ projectPath, conflictFiles, onRefresh, onOpenEditor }: ConflictSectionProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [hunks, setHunks] = useState<ConflictHunk[]>([]);
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  if (conflictFiles.length === 0) return null;

  const handleToggleFile = async (filepath: string) => {
    if (busy) return;
    if (expandedFile === filepath) {
      setExpandedFile(null);
      return;
    }
    setBusy(true);
    try {
      const result = await (window.sai as any).gitConflictHunks(projectPath, filepath) as ConflictHunk[];
      setHunks(result);
      setCurrentHunkIndex(0);
      setExpandedFile(filepath);
    } catch (err) {
      console.error('[ConflictSection] failed to load hunks:', err);
    } finally { setBusy(false); }
  };

  const handleResolve = async (_hunkIndex: number, resolution: 'ours' | 'theirs' | 'both') => {
    if (!expandedFile || busy) return;
    setBusy(true);
    try {
      await (window.sai as any).gitResolveConflict(projectPath, expandedFile, resolution);
      // Reload remaining hunks
      const remaining = await (window.sai as any).gitConflictHunks(projectPath, expandedFile) as ConflictHunk[];
      if (remaining.length === 0) {
        setExpandedFile(null);
        setHunks([]);
      } else {
        setHunks(remaining);
        setCurrentHunkIndex(i => Math.min(i, remaining.length - 1));
      }
      onRefresh();
    } catch (err) {
      console.error('[ConflictSection] failed to resolve conflict:', err);
    } finally { setBusy(false); }
  };

  const handleBulk = async (resolution: 'ours' | 'theirs') => {
    if (busy) return;
    setBusy(true);
    try {
      await (window.sai as any).gitResolveAllConflicts(projectPath, resolution);
      setExpandedFile(null);
      setHunks([]);
      onRefresh();
    } catch (err) {
      console.error('[ConflictSection] bulk resolve failed:', err);
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      margin: '8px 12px 0',
      background: 'var(--bg-input)',
      borderLeft: '3px solid var(--red)',
      borderRadius: '0 4px 4px 0',
      padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        ⚠ Merge Conflicts — resolve before committing
      </div>

      {conflictFiles.map(filepath => (
        <div key={filepath}>
          <div
            onClick={() => handleToggleFile(filepath)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 6px', borderRadius: 3,
              background: 'var(--bg-elevated, #0d1117)',
              cursor: 'pointer', marginBottom: 3,
            }}
          >
            <span style={{ color: 'var(--red)', fontSize: 10 }}>
              {expandedFile === filepath ? '▼' : '▶'}
            </span>
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>!</span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filepath}
            </span>
          </div>

          {expandedFile === filepath && hunks.length > 0 && (
            <div style={{ paddingLeft: 6, marginBottom: 4 }}>
              <ConflictHunkViewer
                hunks={hunks}
                currentIndex={currentHunkIndex}
                onNavigate={setCurrentHunkIndex}
                onResolve={handleResolve}
                onOpenEditor={() => onOpenEditor({ path: filepath, status: 'modified', staged: false } as GitFile)}
                disabled={busy}
              />
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button
          onClick={() => handleBulk('ours')}
          disabled={busy}
          style={{ background: 'var(--red)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
        >
          Accept All Ours
        </button>
        <button
          onClick={() => handleBulk('theirs')}
          disabled={busy}
          style={{ background: 'var(--blue)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
        >
          Accept All Theirs
        </button>
      </div>
    </div>
  );
}
