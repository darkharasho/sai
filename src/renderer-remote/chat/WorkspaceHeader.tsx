import { useEffect, useRef, useState } from 'react';
import { Folder, Layers, ChevronDown, Search, X } from 'lucide-react';
import type { WireClient } from '../wire';
import type { WorkspaceStatusStore } from '../lib/workspaceStatusStore';
import { WorkspaceSquircle, StatusSlot } from '../../components/shared/WorkspaceSquircle';
import { workspaceDisplayState } from '../../lib/workspaceStatus';

interface WorkspaceMeta {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
  state?: 'active' | 'open' | 'suspended' | 'recent';
}

interface Props {
  client: WireClient;
  currentProjectPath: string | null;
  onPick: (projectPath: string) => void;
  statusStore: WorkspaceStatusStore;
}


export default function WorkspaceHeader({ client, currentProjectPath, onPick, statusStore }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = statusStore.subscribe(() => setTick((n) => n + 1));
    return off;
  }, [statusStore]);
  const [open, setOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'projects' | 'meta'>('projects');
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recentQuery, setRecentQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchList = () => {
    setLoading(true); setErr(null);
    client.listWorkspaces()
      .then((ws) => setWorkspaces((ws as WorkspaceMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  // Refetch every time the dropdown opens; clear the recent filter on close.
  useEffect(() => { if (open) fetchList(); else setRecentQuery(''); }, [open]);
  // Initial load for the header's own current-workspace badges.
  useEffect(() => { fetchList(); }, [client, currentProjectPath]);

  // Tap-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  const tabIndicator = (kind: 'project' | 'meta') => {
    const summary = workspaces
      .filter((w) => w.kind === kind)
      .map((w) => workspaceDisplayState(statusStore.get(w.projectPath), { isOpen: w.state === 'active' || w.state === 'open' }));
    if (summary.includes('approval')) {
      return <span className="ws-tab-indicator-dot ws-tab-indicator-approval" title="Approval needed" />;
    }
    if (summary.includes('done')) {
      return <span className="ws-tab-indicator-dot ws-tab-indicator-completed" title="Response complete" />;
    }
    if (summary.includes('busy')) {
      return <WorkspaceSquircle state="busy" title="Working..." />;
    }
    return null;
  };

  const current = workspaces.find((w) => w.projectPath === currentProjectPath);
  const Icon = current?.kind === 'meta' ? Layers : Folder;

  return (
    <div ref={containerRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '4px 8px',
          background: 'transparent',
          color: 'var(--text)',
          border: '1px solid transparent',
          borderRadius: 8,
          cursor: 'pointer',
          fontFamily: 'inherit',
          minWidth: 0,
        }}
      >
        <Icon size={14} color="var(--text-muted)" strokeWidth={2} style={{ flexShrink: 0 }} />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          flex: 1,
          minWidth: 0,
        }}>
          <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}>
            {current?.name ?? 'No workspace'}
          </div>
          {current?.kind === 'meta' && current?.members && current.members.length > 0 && (
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>
              {current.members.map((m) => m.name).join(' · ')}
            </div>
          )}
        </div>
        {(() => {
          // Summary indicator: reflects background activity in OTHER workspaces,
          // not the current one. Matches desktop titlebar behavior.
          const others = workspaces.filter((w) => w.projectPath !== currentProjectPath);
          const priorities = others.map((w) => workspaceDisplayState(statusStore.get(w.projectPath), { isOpen: w.state === 'active' || w.state === 'open' }));
          if (priorities.includes('approval')) {
            return <span className="ws-approval-icon" title="Approval needed elsewhere">!</span>;
          }
          if (priorities.includes('busy')) {
            return (
              <StatusSlot>
                <WorkspaceSquircle state="busy" title="Working in another workspace" />
              </StatusSlot>
            );
          }
          if (priorities.includes('done')) {
            return (
              <StatusSlot>
                <WorkspaceSquircle state="done" title="Response complete elsewhere" />
              </StatusSlot>
            );
          }
          return null;
        })()}
        <ChevronDown
          size={14}
          color="var(--text-muted)"
          style={{
            flexShrink: 0,
            transition: 'transform var(--dur-fast) var(--ease-out-soft)',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: '60vh',
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 40,
          }}
        >
          <div className="ws-picker-tabs">
            <button
              className={pickerTab === 'projects' ? 'active' : ''}
              onClick={() => setPickerTab('projects')}
            >
              Projects{tabIndicator('project')}
            </button>
            <button
              className={pickerTab === 'meta' ? 'active' : ''}
              onClick={() => setPickerTab('meta')}
            >
              Meta{tabIndicator('meta')}
            </button>
          </div>
          {loading && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
          )}
          {err && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--red)' }}>{err}</div>
          )}
          {!loading && !err && workspaces.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              No workspaces open on desktop.
            </div>
          )}
          {(() => {
            const wantKind: 'project' | 'meta' = pickerTab === 'meta' ? 'meta' : 'project';
            const visible = workspaces.filter((w) => w.kind === wantKind);
            const active = visible.filter((w) => w.state === 'active' || (!w.state && w.projectPath === currentProjectPath));
            const open = visible.filter((w) => w.state === 'open');
            const suspended = visible.filter((w) => w.state === 'suspended');
            const recent = visible.filter((w) => w.state === 'recent');
            const isEmptyMeta = pickerTab === 'meta' && visible.length === 0 && !loading && !err;

            const rq = recentQuery.trim().toLowerCase();
            const filteredRecent = rq
              ? recent.filter((w) =>
                  w.name.toLowerCase().includes(rq) || w.projectPath.toLowerCase().includes(rq))
              : recent;

            const sectionLabel = (label: string) => (
              <div style={{
                padding: '8px 12px 4px',
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'var(--text-muted)',
              }}>
                {label}
              </div>
            );

            const row = (w: WorkspaceMeta) => {
              const isActive = w.projectPath === currentProjectPath;
              const RowIcon = w.kind === 'meta' ? Layers : Folder;
              const dim = w.state === 'recent' || w.state === 'suspended' ? 0.6 : 1;
              return (
                <button
                  key={w.projectPath}
                  onClick={() => { onPick(w.projectPath); setOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    color: 'var(--text)',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    minWidth: 0,
                    opacity: dim,
                  }}
                >
                  <RowIcon size={14} color={isActive ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth={2} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? 'var(--accent)' : 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {w.name}
                      {w.kind === 'meta' && (
                        <span style={{
                          marginLeft: 6,
                          fontSize: 10,
                          fontFamily: '"Geist Mono", ui-monospace, monospace',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                        }}>
                          meta
                        </span>
                      )}
                    </div>
                    {w.kind === 'meta' && w.members && w.members.length > 0 ? (
                      <div style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {w.members.map((m) => m.name).join(' · ')}
                      </div>
                    ) : (
                      <div style={{
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: '"Geist Mono", ui-monospace, monospace',
                      }}>
                        {w.projectPath}
                      </div>
                    )}
                  </div>
                  {(() => {
                    const p = workspaceDisplayState(statusStore.get(w.projectPath), { isOpen: w.state === 'active' || w.state === 'open' });
                    if (p === 'approval') {
                      return (
                        <>
                          <span className="ws-approval-icon" title="Approval needed">!</span>
                          <span className="ws-approval-label">Approval needed</span>
                        </>
                      );
                    }
                    if (p === 'done' && !isActive) {
                      return <span className="ws-completed-icon" title="Response complete">!</span>;
                    }
                    if (p === 'inactive') return null;
                    return (
                      <StatusSlot>
                        <WorkspaceSquircle state={p} />
                      </StatusSlot>
                    );
                  })()}
                </button>
              );
            };

            return (
              <>
                {isEmptyMeta && (
                  <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                    No meta workspaces open on desktop.
                  </div>
                )}
                {!isEmptyMeta && active.length > 0 && (<>{sectionLabel('Active')}{active.map(row)}</>)}
                {!isEmptyMeta && open.length > 0 && (<>{sectionLabel('Open')}{open.map(row)}</>)}
                {!isEmptyMeta && suspended.length > 0 && (<>{sectionLabel('Suspended')}{suspended.map(row)}</>)}
                {!isEmptyMeta && recent.length > 0 && (
                  <>
                    {sectionLabel('Recent')}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      margin: '0 12px 4px',
                      padding: '5px 8px',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                    }}>
                      <Search size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      <input
                        type="text"
                        value={recentQuery}
                        onChange={(e) => setRecentQuery(e.target.value)}
                        placeholder="Filter recent…"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          color: 'var(--text)',
                          fontFamily: 'inherit',
                          fontSize: 12,
                          padding: 0,
                        }}
                      />
                      {recentQuery && (
                        <button
                          onClick={() => setRecentQuery('')}
                          aria-label="Clear filter"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            flexShrink: 0,
                          }}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    {filteredRecent.length > 0
                      ? filteredRecent.map(row)
                      : (
                        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                          No matches
                        </div>
                      )}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
      <style>{`
  @keyframes ws-approval-blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.2; }
  }
  @keyframes ws-done-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  .ws-approval-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f59e0b;
    color: #000;
    font-size: 10px;
    font-weight: 800;
    flex-shrink: 0;
    animation: ws-approval-blink 1s ease-in-out infinite;
  }
  .ws-completed-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #4ade80;
    color: #000;
    font-size: 10px;
    font-weight: 800;
    flex-shrink: 0;
    animation: ws-done-pulse 2s ease-in-out infinite;
  }
  .ws-approval-label {
    font-size: 11px;
    color: #f59e0b;
    margin-left: 4px;
  }
  .ws-picker-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    padding: 4px 8px 0;
    gap: 2px;
  }
  .ws-picker-tabs button {
    flex: 1;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 12px;
    padding: 6px 8px;
    cursor: pointer;
    margin-bottom: -1px;
    border-radius: 4px 4px 0 0;
    transition: color 0.12s, background 0.12s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-family: inherit;
  }
  .ws-picker-tabs button:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .ws-picker-tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .ws-tab-indicator-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }
  .ws-tab-indicator-approval { background: #f59e0b; animation: ws-approval-blink 1s ease-in-out infinite; }
  .ws-tab-indicator-completed { background: #4ade80; }
`}</style>
    </div>
  );
}
