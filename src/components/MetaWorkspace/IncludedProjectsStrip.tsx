import type { MetaWorkspaceRuntime } from '../../types';
import { Layers } from 'lucide-react';

interface Props {
  runtime: MetaWorkspaceRuntime;
  onMentionInsert: (linkName: string) => void;
}

export function IncludedProjectsStrip({ runtime, onMentionInsert }: Props) {
  return (
    <div className="included-projects-strip">
      <span className="ips-label">
        <Layers size={11} />
        {runtime.meta.name}
      </span>
      <div className="ips-chips">
        {runtime.projects.map(p => (
          <button
            key={p.linkName}
            className={`ips-chip${p.status === 'unavailable' ? ' unavailable' : ''}`}
            title={p.status === 'unavailable' ? `Missing on this device: ${p.path}` : p.path}
            disabled={p.status === 'unavailable'}
            onClick={() => onMentionInsert(p.linkName)}
          >
            @{p.linkName}
          </button>
        ))}
      </div>
      <style>{`
        .included-projects-strip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-secondary);
          overflow: hidden;
        }
        .ips-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ips-chips {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .ips-chips::-webkit-scrollbar {
          display: none;
        }
        .ips-chip {
          display: inline-flex;
          align-items: center;
          padding: 2px 7px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--accent);
          font-size: 11px;
          font-family: inherit;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.1s, color 0.1s;
          line-height: 1.4;
        }
        .ips-chip:hover:not(:disabled) {
          background: var(--bg-hover);
          border-color: var(--accent);
        }
        .ips-chip.unavailable {
          color: var(--text-muted);
          border-color: var(--border);
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
