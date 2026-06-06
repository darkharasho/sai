import { useState, useEffect, useRef } from 'react';
import type { MetaWorkspaceRuntime } from '../../types';

interface Props {
  runtime: MetaWorkspaceRuntime;
  onMentionInsert: (linkName: string) => void;
}

export function IncludedProjectsControl({ runtime, onMentionInsert }: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const projects = runtime.projects;
  const useDropdown = projects.length > 3;

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPopoverOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [popoverOpen]);

  if (useDropdown) {
    return (
      <div className="ipc-dropdown-wrapper">
        <button
          ref={buttonRef}
          className="accordion-bar-btn ipc-dropdown-btn"
          title="Included projects"
          onClick={(e) => { e.stopPropagation(); setPopoverOpen(o => !o); }}
        >
          Projects ({projects.length}) ▾
        </button>
        {popoverOpen && (
          <div ref={popoverRef} className="ipc-popover" onClick={(e) => e.stopPropagation()}>
            {projects.map(p => (
              <button
                key={p.linkName}
                className={`ipc-popover-row${p.status === 'unavailable' ? ' unavailable' : ''}`}
                disabled={p.status === 'unavailable'}
                title={p.status === 'unavailable' ? `Missing on this device: ${p.path}` : p.path}
                onClick={() => { onMentionInsert(p.linkName); setPopoverOpen(false); }}
              >
                <span className="ipc-popover-name">@{p.linkName}</span>
                {p.status === 'unavailable'
                  ? <span className="ipc-popover-meta missing">(missing)</span>
                  : <span className="ipc-popover-meta">{p.path}</span>
                }
              </button>
            ))}
          </div>
        )}
        <style>{`
          .ipc-dropdown-wrapper {
            position: relative;
            display: flex;
            align-items: center;
          }
          .ipc-dropdown-btn {
            font-size: 10px;
            padding: 2px 6px;
            white-space: nowrap;
            font-weight: 500;
            letter-spacing: 0;
            text-transform: none;
          }
          .ipc-popover {
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            min-width: 220px;
            max-width: 340px;
            background: var(--surface-3);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.24);
            z-index: 200;
            overflow: hidden;
            padding: 3px 0;
          }
          .ipc-popover-row {
            display: flex;
            align-items: baseline;
            gap: 8px;
            width: 100%;
            padding: 5px 10px;
            background: none;
            border: none;
            cursor: pointer;
            text-align: left;
            font-family: inherit;
            font-size: 12px;
            color: var(--text-primary);
          }
          .ipc-popover-row:hover:not(:disabled) {
            background: var(--surface-4);
          }
          .ipc-popover-row.unavailable {
            opacity: 0.45;
            cursor: not-allowed;
          }
          .ipc-popover-name {
            color: var(--accent);
            font-weight: 500;
            white-space: nowrap;
            flex-shrink: 0;
          }
          .ipc-popover-meta {
            color: var(--text-muted);
            font-size: 10px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .ipc-popover-meta.missing {
            color: var(--orange, #e8a04a);
          }
        `}</style>
      </div>
    );
  }

  // Inline chips (≤3 projects)
  return (
    <div className="ipc-chips">
      {projects.map(p => (
        <button
          key={p.linkName}
          className={`accordion-bar-btn ipc-chip${p.status === 'unavailable' ? ' unavailable' : ''}`}
          title={p.status === 'unavailable' ? `Missing on this device: ${p.path}` : p.path}
          disabled={p.status === 'unavailable'}
          onClick={(e) => { e.stopPropagation(); onMentionInsert(p.linkName); }}
        >
          @{p.linkName}
        </button>
      ))}
      <style>{`
        .ipc-chips {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .ipc-chip {
          font-size: 10px;
          padding: 2px 6px;
          color: var(--accent);
          border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
          border-radius: 10px;
          white-space: nowrap;
          letter-spacing: 0;
          text-transform: none;
          font-weight: 500;
        }
        .ipc-chip:hover:not(:disabled) {
          background: color-mix(in srgb, var(--accent) 12%, transparent);
          border-color: var(--accent);
        }
        .ipc-chip.unavailable {
          color: var(--text-muted);
          border-color: var(--border-subtle);
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
