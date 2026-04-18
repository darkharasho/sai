import { Check, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ConflictHunk } from '../../types';

interface ConflictHunkViewerProps {
  hunks: ConflictHunk[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onResolve: (hunkIndex: number, resolution: 'ours' | 'theirs' | 'both') => void;
  onOpenEditor: () => void;
  disabled?: boolean;
}

export default function ConflictHunkViewer({ hunks, currentIndex, onNavigate, onResolve, onOpenEditor, disabled }: ConflictHunkViewerProps) {
  const hunk = hunks[currentIndex];
  if (!hunk) return null;

  return (
    <div style={{ margin: '4px 0' }}>
      {/* Raw conflict block */}
      <div style={{
        background: 'var(--bg-elevated, #0d1117)',
        borderRadius: 3,
        padding: '6px 8px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        lineHeight: 1.6,
        border: '1px solid var(--border)',
      }}>
        <div style={{ color: 'var(--green)', opacity: 0.7 }}>{'<<<<<<< ' + hunk.oursLabel}</div>
        {hunk.ours.map((line, i) => (
          <div key={i} style={{ background: 'rgba(63,185,80,0.15)', color: 'var(--green)', padding: '0 2px', whiteSpace: 'pre' }}>{line}</div>
        ))}
        <div style={{ color: 'var(--text-muted)' }}>{'======='}</div>
        {hunk.theirs.map((line, i) => (
          <div key={i} style={{ background: 'rgba(121,192,255,0.15)', color: 'var(--blue)', padding: '0 2px', whiteSpace: 'pre' }}>{line}</div>
        ))}
        <div style={{ color: 'var(--blue)', opacity: 0.7 }}>{'>>>>>>> ' + hunk.theirsLabel}</div>
      </div>

      {/* Resolution buttons */}
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
        {(['ours', 'theirs', 'both'] as const).map(r => (
          <button
            key={r}
            onClick={() => onResolve(hunk.index, r)}
            aria-label={`Accept ${r}`}
            disabled={disabled}
            style={{
              flex: 1,
              background: r === 'ours' ? 'rgba(63,185,80,0.2)' : r === 'theirs' ? 'rgba(121,192,255,0.2)' : 'rgba(249,226,175,0.2)',
              color: r === 'ours' ? 'var(--green)' : r === 'theirs' ? 'var(--blue)' : 'var(--yellow, #f9e2af)',
              border: `1px solid ${r === 'ours' ? 'var(--green)' : r === 'theirs' ? 'var(--blue)' : 'var(--yellow, #f9e2af)'}`,
              borderRadius: 3, padding: '3px 0', fontSize: 10, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <Check size={10} style={{ marginRight: 3 }} />{r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
        <button
          onClick={onOpenEditor}
          aria-label="Open in editor"
          disabled={disabled}
          style={{
            flex: 1, background: 'var(--bg-hover)', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 3, padding: '3px 0',
            fontSize: 10, cursor: 'pointer',
          }}
        >
          <ExternalLink size={10} style={{ marginRight: 3 }} /> Editor
        </button>
      </div>

      {/* Navigation */}
      {hunks.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button
            onClick={() => currentIndex > 0 && onNavigate(currentIndex - 1)}
            disabled={currentIndex === 0}
            style={{ background: 'none', border: 'none', color: currentIndex > 0 ? 'var(--accent)' : 'var(--text-muted)', cursor: currentIndex > 0 ? 'pointer' : 'default', fontSize: 10, padding: '2px 0' }}
          >
            <ChevronLeft size={10} /> prev
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            hunk {currentIndex + 1} of {hunks.length}
          </span>
          <button
            onClick={() => currentIndex < hunks.length - 1 && onNavigate(currentIndex + 1)}
            disabled={currentIndex === hunks.length - 1}
            style={{ background: 'none', border: 'none', color: currentIndex < hunks.length - 1 ? 'var(--accent)' : 'var(--text-muted)', cursor: currentIndex < hunks.length - 1 ? 'pointer' : 'default', fontSize: 10, padding: '2px 0' }}
          >
            next <ChevronRight size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
