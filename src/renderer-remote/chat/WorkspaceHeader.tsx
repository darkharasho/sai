import { useEffect, useRef, useState } from 'react';
import { Folder, Layers, ChevronDown } from 'lucide-react';
import type { WireClient } from '../wire';
import type { WorkspaceStatus, WorkspaceStatusStore } from '../lib/workspaceStatusStore';
import { DOT_MASK_URL } from '../../lib/assets';

type DisplayPriority = 'idle' | 'busy' | 'completed' | 'approval';

function displayPriority(status: WorkspaceStatus | undefined): DisplayPriority {
  if (!status) return 'idle';
  if (status.approval) return 'approval';
  if (status.busy || status.streaming || status.awaitingQuestion) return 'busy';
  if (status.completed) return 'completed';
  return 'idle';
}

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

interface StatusDotProps {
  status: WorkspaceStatus | undefined;
  /** When true, render a green squircle even if priority is 'idle' (used for current/active workspace rows). */
  activeIdle?: boolean;
  /** When true, render a gold squircle in idle state (used for suspended rows). */
  suspendedIdle?: boolean;
}

function StatusDot({ status, activeIdle, suspendedIdle }: StatusDotProps) {
  const p = displayPriority(status);

  if (p === 'approval') {
    return <span className="ws-dot ws-dot-approval" title="approval needed" />;
  }
  if (p === 'busy') {
    return <span className="ws-dot ws-dot-busy" title="working" />;
  }
  if (p === 'completed') {
    return <span className="ws-dot ws-dot-completed" title="completed" />;
  }
  if (activeIdle) {
    return <span className="ws-dot ws-dot-active" title="active" />;
  }
  if (suspendedIdle) {
    return <span className="ws-dot ws-dot-suspended" title="suspended" />;
  }
  return null;
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
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchList = () => {
    setLoading(true); setErr(null);
    client.listWorkspaces()
      .then((ws) => setWorkspaces((ws as WorkspaceMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  // Refetch every time the dropdown opens.
  useEffect(() => { if (open) fetchList(); }, [open]);
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
      .map((w) => displayPriority(statusStore.get(w.projectPath)));
    if (summary.includes('approval')) {
      return <span className="ws-tab-indicator-dot ws-tab-indicator-approval" title="Approval needed" />;
    }
    if (summary.includes('completed')) {
      return <span className="ws-tab-indicator-dot ws-tab-indicator-completed" title="Response complete" />;
    }
    if (summary.includes('busy')) {
      return <span className="ws-tab-indicator-busy" title="Working..." />;
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
          const p = displayPriority(current ? statusStore.get(current.projectPath) : undefined);
          if (p === 'approval') {
            return <span className="ws-approval-icon" title="Approval needed">!</span>;
          }
          if (p === 'completed') {
            return <span className="ws-completed-icon" title="Response complete">!</span>;
          }
          return (
            <StatusDot
              status={current ? statusStore.get(current.projectPath) : undefined}
              activeIdle={!!current}
            />
          );
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
                    const p = displayPriority(statusStore.get(w.projectPath));
                    if (p === 'approval') {
                      return (
                        <>
                          <span className="ws-approval-icon" title="Approval needed">!</span>
                          <span className="ws-approval-label">Approval needed</span>
                        </>
                      );
                    }
                    if (p === 'completed') {
                      return <span className="ws-completed-icon" title="Response complete">!</span>;
                    }
                    return (
                      <StatusDot
                        status={statusStore.get(w.projectPath)}
                        activeIdle={isActive}
                        suspendedIdle={w.state === 'suspended'}
                      />
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
                {!isEmptyMeta && recent.length > 0 && (<>{sectionLabel('Recent')}{recent.map(row)}</>)}
              </>
            );
          })()}
        </div>
      )}
      <style>{`
  .ws-dot {
    display: inline-block;
    flex-shrink: 0;
    width: 9px;
    height: 9px;
  }
  .ws-dot-active {
    background: #4ade80;
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
  }
  .ws-dot-busy {
    background: var(--accent);
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    animation: ws-spinner-pulse 2.2s ease-in-out infinite;
  }
  .ws-dot-completed {
    background: #4ade80;
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    animation: ws-done-pulse 2s ease-in-out infinite;
  }
  .ws-dot-suspended {
    background: #d4a72c;
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
  }
  .ws-dot-approval {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #f59e0b;
    animation: ws-approval-blink 1s ease-in-out infinite;
  }
  @keyframes ws-spinner-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.35; transform: scale(0.75); }
  }
  @keyframes ws-done-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  @keyframes ws-approval-blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.2; }
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
  .ws-tab-indicator-busy {
    width: 9px;
    height: 9px;
    background: var(--accent);
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    display: inline-block;
    flex-shrink: 0;
    animation: ws-spinner-pulse 2.2s ease-in-out infinite;
  }
`}</style>
    </div>
  );
}
