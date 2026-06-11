import { useState, useEffect, useRef } from 'react';
import type { MetaWorkspaceListItem, MetaWorkspaceRuntime, ModelChoice, EffortLevel, ClaudeModelOption } from '../types';
import UpdateNotification from './UpdateNotification';
import CloseWorkspaceModal from './CloseWorkspaceModal';
import GitHubAuthModal from './GitHubAuthModal';
import GitHubCloneModal from './GitHubCloneModal';
import SettingsModal from './SettingsModal';
import { CreateMetaWorkspaceModal } from './MetaWorkspace/CreateMetaWorkspaceModal';
import { ManageMetaWorkspaceModal } from './MetaWorkspace/ManageMetaWorkspaceModal';
import { LogOut, Settings, ChevronDown, FolderOpen, FolderPlus, Layers, Pencil, Search, X } from 'lucide-react';
import { basename } from '../utils/pathUtils';
import SaiLogo from './SaiLogo';
import { DOT_MASK_URL } from '../lib/assets';
import { WorkspaceSquircle, StatusSlot } from './shared/WorkspaceSquircle';

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string;
}

interface WorkspaceInfo {
  projectPath: string;
  status: string;
  lastActivity: number;
}

interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
  completedWorkspaces?: Set<string>;
  busyWorkspaces?: Set<string>;
  approvalWorkspaces?: Set<string>;
  awaitingQuestionWorkspaces?: Set<string>;
  onSettingChange?: (key: string, value: any) => void;
  onOpenWhatsNew?: () => void;
  onHistoryRetentionChange?: (days: number | null) => void;
  onNewProject?: () => void;
  metaWorkspaces?: MetaWorkspaceListItem[];
  activeMetaRuntime?: MetaWorkspaceRuntime | null;
  onActivateMeta?: (id: string) => Promise<void>;
  onMetaCreated?: (runtime: MetaWorkspaceRuntime) => void;
  onMetaUpdated?: (runtime: MetaWorkspaceRuntime) => void;
  onMetaDeleted?: (id: string) => void;
  claudeModel?: ModelChoice;
  onClaudeModelChange?: (m: ModelChoice) => void;
  claudeEffort?: EffortLevel;
  onClaudeEffortChange?: (e: EffortLevel) => void;
  claudeModels?: ClaudeModelOption[];
}

export default function TitleBar({ projectPath, onProjectChange, completedWorkspaces, busyWorkspaces, approvalWorkspaces, awaitingQuestionWorkspaces, onSettingChange, onOpenWhatsNew, onHistoryRetentionChange, onNewProject, metaWorkspaces, activeMetaRuntime, onActivateMeta, onMetaCreated, onMetaUpdated, onMetaDeleted, claudeModel, onClaudeModelChange, claudeEffort, onClaudeEffortChange, claudeModels }: TitleBarProps) {
  const [open, setOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'projects' | 'meta'>('projects');
  const [workspaceList, setWorkspaceList] = useState<WorkspaceInfo[]>([]);
  const [version, setVersion] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [ghDropOpen, setGhDropOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [framelessRounded, setFramelessRounded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const ghDropRef = useRef<HTMLDivElement>(null);
  const [showCreateMeta, setShowCreateMeta] = useState(false);
  const [manageMeta, setManageMeta] = useState<MetaWorkspaceListItem | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [recentQuery, setRecentQuery] = useState('');
  const [recentFocused, setRecentFocused] = useState(false);

  useEffect(() => {
    window.sai.updateGetVersion().then((v: string) => setVersion(v));
    window.sai.githubGetUser().then((u: GitHubUser | null) => setGhUser(u));
    const unsubSync = window.sai.githubOnSyncStatus((data: { status: string }) => {
      setSyncStatus(data.status as any);
    });
    window.sai.windowIsFramelessRounded?.().then((v: boolean) => setFramelessRounded(!!v));
    window.sai.windowIsMaximized?.().then((v: boolean) => {
      setMaximized(!!v);
      document.documentElement.classList.toggle('window-maximized', !!v);
    });
    const unsubMax = window.sai.windowOnMaximizedChange?.((m: boolean) => {
      setMaximized(m);
      document.documentElement.classList.toggle('window-maximized', m);
    });
    return () => { unsubSync(); unsubMax?.(); };
  }, []);

  const projectName = activeMetaRuntime ? activeMetaRuntime.meta.name : (projectPath ? basename(projectPath) : 'No Project');

  useEffect(() => {
    if (open) {
      window.sai.workspaceGetAll?.().then((list: WorkspaceInfo[]) => {
        setWorkspaceList(list || []);
      }).catch(() => {
        window.sai.getRecentProjects().then((recent: string[]) => {
          setWorkspaceList(recent.map(p => ({ projectPath: p, status: 'recent', lastActivity: 0 })));
        });
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) { setOverflowOpen(null); setRecentQuery(''); }
  }, [open]);

  // Reset the recent filter when switching tabs so it doesn't carry over.
  useEffect(() => { setRecentQuery(''); }, [pickerTab]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleSuspend = async (path: string) => {
    setOverflowOpen(null);
    await window.sai.workspaceSuspend?.(path);
    const list = await window.sai.workspaceGetAll?.();
    if (list) setWorkspaceList(list);
  };

  const handleCloseConfirm = async () => {
    if (!closeTarget) return;
    await window.sai.workspaceClose?.(closeTarget);
    setCloseTarget(null);
    setOpen(false);
  };

  const handleOpenNew = async () => {
    const defaultDir = await window.sai.settingsGet('defaultProjectDir', '');
    const folder = await window.sai.selectFolder(defaultDir || undefined);
    if (folder) {
      onProjectChange(folder);
    }
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ghDropRef.current && !ghDropRef.current.contains(e.target as Node)) {
        setGhDropOpen(false);
      }
    };
    if (ghDropOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ghDropOpen]);

  const handleGhLogout = async () => {
    await window.sai.githubLogout();
    setGhUser(null);
    setGhDropOpen(false);
  };

  const handleAuthSuccess = (user: GitHubUser) => {
    setGhUser(user);
    setShowAuthModal(false);
  };

  // "Recent" section header with an inline filter input, shared by the
  // Projects and Meta tabs. `showDivider` draws the separator above it.
  const recentHeader = (showDivider: boolean) => (
    <>
      {showDivider && <div className="dropdown-divider" />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 4px 12px' }}>
        <div className="dropdown-label" style={{ flexShrink: 0, padding: 0 }}>Recent</div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginLeft: 'auto',
          width: 160,
          maxWidth: '60%',
          padding: '3px 2px',
          borderBottom: `1px dashed ${recentFocused ? 'var(--accent)' : 'var(--text-muted)'}`,
          transition: 'border-color var(--dur-fast, 120ms) ease',
        }}>
          <Search size={12} color={recentFocused ? 'var(--accent)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
          <input
            type="text"
            value={recentQuery}
            onChange={(e) => setRecentQuery(e.target.value)}
            onFocus={() => setRecentFocused(true)}
            onBlur={() => setRecentFocused(false)}
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
              onClick={(e) => { e.stopPropagation(); setRecentQuery(''); }}
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
      </div>
    </>
  );

  return (
    <div className={`titlebar${window.sai.platform === 'darwin' ? ' titlebar-mac' : ''}${framelessRounded ? ' titlebar-frameless' : ''}`}>
      {window.sai.platform !== 'darwin' && (
        <div className="titlebar-brand">
          <SaiLogo mode="static" size={18} ariaLabel="SAI" />
        </div>
      )}
      <div className="titlebar-drag" />
      <div className="project-dropdown-wrapper" ref={dropdownRef}>
        <button className="project-selector" onClick={() => setOpen(!open)}>
          {activeMetaRuntime ? (
            <><Layers size={12} className="titlebar-meta-icon" /><span>{projectName}</span></>
          ) : projectName} ▾
          {(() => {
            const metaRoots = new Set((metaWorkspaces || []).map(m => m.syntheticRoot));
            const scope = (set: Set<string> | undefined, want: 'meta' | 'project') =>
              set ? [...set].filter(p => want === 'meta' ? metaRoots.has(p) : !metaRoots.has(p)) : [];
            const projApproval = scope(approvalWorkspaces, 'project').length;
            const projQuestion = scope(awaitingQuestionWorkspaces, 'project').filter(p => p !== projectPath).length;
            const projCompleted = scope(completedWorkspaces, 'project').filter(p => !busyWorkspaces?.has(p)).length;
            const projBusy = scope(busyWorkspaces, 'project').filter(p => p !== projectPath).length;
            const metaApproval = scope(approvalWorkspaces, 'meta').length;
            const metaCompleted = scope(completedWorkspaces, 'meta').filter(p => !busyWorkspaces?.has(p)).length;
            const metaBusy = scope(busyWorkspaces, 'meta').filter(p => p !== projectPath).length;

            const projectIndicator = projApproval > 0
              ? <WorkspaceSquircle state="approval" title="Approval needed" />
              : projQuestion > 0
                ? <WorkspaceSquircle state="question" title="Waiting for your answer" />
                : projBusy > 0
                  ? <span className="titlebar-busy-indicator">
                      {/* busy + done at once renders the diagonal two-tone squircle */}
                      <WorkspaceSquircle state={projCompleted > 0 ? 'busy-done' : 'busy'} title={projCompleted > 0 ? 'Working… / response complete' : 'Working…'} />
                      {projBusy > 1 && <span className="titlebar-busy-count">{projBusy}</span>}
                    </span>
                  : projCompleted > 0
                    ? <WorkspaceSquircle state="done" title="Response complete" />
                    : null;

            const metaCls = metaApproval > 0 ? 'approval'
              : metaCompleted > 0 ? 'completed'
              : metaBusy > 0 ? 'busy' : '';
            const metaTitle = metaApproval > 0 ? 'Meta: approval needed'
              : metaCompleted > 0 ? 'Meta: response complete'
              : metaBusy > 0 ? 'Meta: working...' : '';
            const metaIndicator = metaCls
              ? <Layers size={12} className={`titlebar-meta-indicator ${metaCls}`} aria-label={metaTitle} />
              : null;

            return <>{projectIndicator}{metaIndicator}</>;
          })()}
        </button>
        {open && (
          <div className="project-dropdown" onMouseDown={(e) => {
            const target = e.target as HTMLElement;
            if (!target.closest(`[data-path="${overflowOpen}"]`)) {
              setOverflowOpen(null);
            }
          }}>
            {(() => {
              const metaRoots = new Set((metaWorkspaces || []).map(m => m.syntheticRoot));
              const filter = (set: Set<string> | undefined, want: 'meta' | 'project') =>
                set ? [...set].filter(p => want === 'meta' ? metaRoots.has(p) : !metaRoots.has(p)) : [];
              const tabIndicator = (kind: 'meta' | 'project') => {
                const approval = filter(approvalWorkspaces, kind).length;
                const completed = filter(completedWorkspaces, kind).filter(p => !busyWorkspaces?.has(p)).length;
                const busy = filter(busyWorkspaces, kind).length;
                if (approval === 0 && completed === 0 && busy === 0) return null;
                const cls = approval > 0
                  ? 'picker-tab-meta-icon approval'
                  : completed > 0
                    ? 'picker-tab-meta-icon completed'
                    : 'picker-tab-meta-icon busy';
                const title = approval > 0 ? 'Approval needed' : completed > 0 ? 'Response complete' : 'Working...';
                if (kind === 'meta') return <Layers size={12} className={cls} aria-label={title} />;
                if (approval > 0) return <span className="picker-tab-dot picker-tab-approval" title={title} />;
                if (completed > 0) return <span className="picker-tab-dot picker-tab-completed" title={title} />;
                return <span className="picker-tab-spinner" title={title} />;
              };
              return (
                <div className="picker-tabs">
                  <button className={pickerTab === 'projects' ? 'active' : ''} onClick={() => setPickerTab('projects')}>
                    <span className="picker-tab-label">Projects</span>{tabIndicator('project')}
                  </button>
                  <button className={pickerTab === 'meta' ? 'active' : ''} onClick={() => setPickerTab('meta')}>
                    <span className="picker-tab-label">Meta</span>{tabIndicator('meta')}
                  </button>
                </div>
              );
            })()}
            {pickerTab === 'projects' && (() => {
              const metaRoots = new Set((metaWorkspaces || []).map(m => m.syntheticRoot));
              const projectList = workspaceList.filter(w => !metaRoots.has(w.projectPath));
              const active = projectList.filter(w => w.status === 'active');
              const suspended = projectList.filter(w => w.status === 'suspended');
              const recent = projectList.filter(w => w.status === 'recent');

              return (
                <>
                  {active.length > 0 && (
                    <>
                      <div className="dropdown-label">Active</div>
                      {active.map(w => (
                        <div key={w.projectPath} className="workspace-row-wrapper" data-path={w.projectPath}>
                          <button
                            className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                            onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                          >
                            <StatusSlot>
                              <WorkspaceSquircle
                                state={
                                  approvalWorkspaces?.has(w.projectPath) ? 'approval'
                                  : awaitingQuestionWorkspaces?.has(w.projectPath) ? 'question'
                                  : busyWorkspaces?.has(w.projectPath) ? 'busy'
                                  : completedWorkspaces?.has(w.projectPath) ? 'done'
                                  : 'alive'
                                }
                                title={
                                  approvalWorkspaces?.has(w.projectPath) ? 'Approval needed'
                                  : awaitingQuestionWorkspaces?.has(w.projectPath) ? 'Waiting for your answer'
                                  : busyWorkspaces?.has(w.projectPath) ? 'Working...'
                                  : completedWorkspaces?.has(w.projectPath) ? 'Response complete'
                                  : undefined
                                }
                              />
                            </StatusSlot>
                            <span className="dropdown-item-name">{basename(w.projectPath)}</span>
                            {approvalWorkspaces?.has(w.projectPath) && <span className="workspace-approval-label">Approval needed</span>}
                            <span className="dropdown-item-path">{w.projectPath}</span>
                          </button>
                          {w.projectPath !== projectPath && (<>
                          <button
                            className={`workspace-overflow-btn${overflowOpen === w.projectPath ? ' open' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOverflowOpen(overflowOpen === w.projectPath ? null : w.projectPath);
                            }}
                          >···</button>
                          {overflowOpen === w.projectPath && (
                            <div className="workspace-submenu">
                              <button className="workspace-submenu-item" onClick={() => handleSuspend(w.projectPath)}>
                                ⏸ Suspend
                              </button>
                              <button
                                className="workspace-submenu-item danger"
                                onClick={() => { setOverflowOpen(null); setCloseTarget(w.projectPath); }}
                              >
                                ✕ Close
                              </button>
                            </div>
                          )}
                          </>)}
                        </div>
                      ))}
                    </>
                  )}
                  {(suspended.length > 0 || recent.length > 0) && (
                    <>
                      {active.length > 0 && <div className="dropdown-divider" />}
                      <div className="dropdown-inactive-scroll">
                        {suspended.length > 0 && (
                          <>
                            <div className="dropdown-label">Suspended</div>
                            {suspended.map(w => (
                              <button
                                key={w.projectPath}
                                className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                                onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                              >
                                <StatusSlot>
                                  <WorkspaceSquircle
                                    state={
                                      approvalWorkspaces?.has(w.projectPath) ? 'approval'
                                      : awaitingQuestionWorkspaces?.has(w.projectPath) ? 'question'
                                      : busyWorkspaces?.has(w.projectPath) ? 'busy'
                                      : completedWorkspaces?.has(w.projectPath) ? 'done'
                                      : 'inactive'
                                    }
                                    title={
                                      approvalWorkspaces?.has(w.projectPath) ? 'Approval needed'
                                      : awaitingQuestionWorkspaces?.has(w.projectPath) ? 'Waiting for your answer'
                                      : busyWorkspaces?.has(w.projectPath) ? 'Working...'
                                      : completedWorkspaces?.has(w.projectPath) ? 'Response complete'
                                      : undefined
                                    }
                                  />
                                </StatusSlot>
                                <span className="dropdown-item-name">{basename(w.projectPath)}</span>
                                <span className="dropdown-item-path">{w.projectPath}</span>
                              </button>
                            ))}
                          </>
                        )}
                        {recent.length > 0 && (() => {
                          const rq = recentQuery.trim().toLowerCase();
                          const filteredRecent = rq
                            ? recent.filter(w =>
                                basename(w.projectPath).toLowerCase().includes(rq) ||
                                w.projectPath.toLowerCase().includes(rq))
                            : recent;
                          return (
                          <>
                            {recentHeader(suspended.length > 0)}
                            {filteredRecent.length > 0
                              ? filteredRecent.map(w => (
                                <button
                                  key={w.projectPath}
                                  className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                                  onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                                >
                                  <span className="dropdown-item-name">{basename(w.projectPath)}</span>
                                  <span className="dropdown-item-path">{w.projectPath}</span>
                                </button>
                              ))
                              : (
                                <div className="dropdown-label" style={{ opacity: 0.7 }}>No matches</div>
                              )}
                          </>
                          );
                        })()}
                      </div>
                    </>
                  )}
                  <div className="dropdown-divider" />
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                      className="dropdown-item"
                      onClick={handleOpenNew}
                      style={{
                        flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 5, color: 'var(--accent)', fontSize: 13, borderRadius: '4px 0 0 4px',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-hover)'; e.currentTarget.style.background = 'var(--surface-3)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <FolderOpen size={13} />
                      Open Project
                    </button>
                    <div style={{ width: 1, height: 16, background: 'var(--border-hairline)', flexShrink: 0 }} />
                    <button
                      className="dropdown-item"
                      onClick={() => { setOpen(false); onNewProject?.(); }}
                      style={{
                        flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 5, color: 'var(--accent)', fontSize: 13, borderRadius: '0 4px 4px 0',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-hover)'; e.currentTarget.style.background = 'var(--surface-3)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <FolderPlus size={13} />
                      New Project
                    </button>
                  </div>
                </>
              );
            })()}
            {pickerTab === 'meta' && (() => {
              const activeMeta = (metaWorkspaces || []).filter(m => m.id === activeMetaRuntime?.meta.id);
              const recentMeta = (metaWorkspaces || [])
                .filter(m => m.id !== activeMetaRuntime?.meta.id)
                .sort((a, b) => b.lastActivity - a.lastActivity);
              const isEmpty = (metaWorkspaces || []).length === 0;

              return (
                <>
                  {isEmpty && (
                    <div className="meta-empty-state">No meta workspaces yet — create one below.</div>
                  )}
                  {!isEmpty && activeMeta.length > 0 && (
                    <>
                      <div className="dropdown-label">Active</div>
                      {activeMeta.map(meta => (
                        <div key={meta.id} className="meta-workspace-row">
                          <button
                            className="dropdown-item meta-workspace-item active"
                            onClick={() => { onActivateMeta?.(meta.id); setOpen(false); }}
                          >
                            <Layers
                              size={13}
                              className={`meta-workspace-icon ${
                                approvalWorkspaces?.has(meta.syntheticRoot) ? 'approval'
                                : busyWorkspaces?.has(meta.syntheticRoot) ? 'busy'
                                : completedWorkspaces?.has(meta.syntheticRoot) ? 'completed' : ''
                              }`}
                              aria-label={
                                approvalWorkspaces?.has(meta.syntheticRoot) ? 'Approval needed'
                                : busyWorkspaces?.has(meta.syntheticRoot) ? 'Working...'
                                : completedWorkspaces?.has(meta.syntheticRoot) ? 'Response complete' : undefined
                              }
                            />
                            <div className="meta-workspace-text">
                              <span className="dropdown-item-name">{meta.name}</span>
                              <span className="dropdown-item-path">{meta.projects.length} project{meta.projects.length === 1 ? '' : 's'}</span>
                            </div>
                            {approvalWorkspaces?.has(meta.syntheticRoot) && <span className="workspace-approval-label">Approval needed</span>}
                          </button>
                          <button
                            className="meta-workspace-manage-btn"
                            onClick={e => { e.stopPropagation(); setManageMeta(meta); }}
                            title="Manage"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                  {!isEmpty && recentMeta.length > 0 && (() => {
                    const rq = recentQuery.trim().toLowerCase();
                    const filteredMeta = rq
                      ? recentMeta.filter(m =>
                          m.name.toLowerCase().includes(rq) ||
                          m.projects.some(p => p.linkName.toLowerCase().includes(rq) || p.path.toLowerCase().includes(rq)))
                      : recentMeta;
                    return (
                    <>
                      {recentHeader(activeMeta.length > 0)}
                      <div className="dropdown-inactive-scroll">
                        {filteredMeta.length === 0 && (
                          <div className="dropdown-label" style={{ opacity: 0.7 }}>No matches</div>
                        )}
                        {filteredMeta.map(meta => (
                          <div key={meta.id} className="meta-workspace-row">
                            <button
                              className="dropdown-item meta-workspace-item"
                              onClick={() => { onActivateMeta?.(meta.id); setOpen(false); }}
                            >
                              <Layers
                                size={13}
                                className={`meta-workspace-icon ${
                                  approvalWorkspaces?.has(meta.syntheticRoot) ? 'approval'
                                  : busyWorkspaces?.has(meta.syntheticRoot) ? 'busy'
                                  : completedWorkspaces?.has(meta.syntheticRoot) ? 'completed' : ''
                                }`}
                                aria-label={
                                  approvalWorkspaces?.has(meta.syntheticRoot) ? 'Approval needed'
                                  : busyWorkspaces?.has(meta.syntheticRoot) ? 'Working...'
                                  : completedWorkspaces?.has(meta.syntheticRoot) ? 'Response complete' : undefined
                                }
                              />
                              <div className="meta-workspace-text">
                                <span className="dropdown-item-name">{meta.name}</span>
                                <span className="dropdown-item-path">{meta.projects.length} project{meta.projects.length === 1 ? '' : 's'}</span>
                              </div>
                              {approvalWorkspaces?.has(meta.syntheticRoot) && <span className="workspace-approval-label">Approval needed</span>}
                            </button>
                            <button
                              className="meta-workspace-manage-btn"
                              onClick={e => { e.stopPropagation(); setManageMeta(meta); }}
                              title="Manage"
                            >
                              <Pencil size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                    );
                  })()}
                  <div className="dropdown-divider" />
                  <button
                    className="dropdown-item"
                    onClick={async () => {
                      const recent = await window.sai.getRecentProjects().catch(() => []);
                      setRecentProjects(recent || []);
                      setShowCreateMeta(true);
                    }}
                    style={{
                      display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 5, color: 'var(--accent)', fontSize: 13,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-hover)'; e.currentTarget.style.background = 'var(--surface-3)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Layers size={13} />
                    + New Meta Workspace
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </div>
      <UpdateNotification />
      <div className="titlebar-right">
        {version && (
          version === 'DEV'
            ? <span className="titlebar-dev-pill">DEV</span>
            : <span className="titlebar-version" onClick={() => window.sai.updateCheck()} title="Check for updates">v{version}</span>
        )}
        {ghUser ? (
          <div className="gh-user-wrapper" ref={ghDropRef}>
            <button className="gh-user-btn" onClick={() => setGhDropOpen(v => !v)}>
              <div className="gh-avatar-wrap">
                <img src={ghUser.avatar_url} className="gh-avatar" alt={ghUser.login} />
                {syncStatus === 'syncing' && <span className="gh-sync-dot syncing" />}
                {syncStatus === 'error' && <span className="gh-sync-dot error" />}
              </div>
              <span className="gh-username">{ghUser.login}</span>
              <ChevronDown size={11} className={`gh-chevron${ghDropOpen ? ' open' : ''}`} />
            </button>
            {ghDropOpen && (
              <div className="gh-dropdown">
                <div className="gh-dropdown-header">
                  <img src={ghUser.avatar_url} className="gh-dropdown-avatar" alt={ghUser.login} />
                  <div>
                    <div className="gh-dropdown-name">{ghUser.name}</div>
                    <div className="gh-dropdown-login">@{ghUser.login}</div>
                  </div>
                </div>
                <div className="gh-dropdown-divider" />
                <button className="gh-dropdown-item" onClick={() => { setGhDropOpen(false); setShowClone(true); }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                  Clone repo
                </button>
                <button className="gh-dropdown-item" onClick={() => { setGhDropOpen(false); setShowSettings(true); }}>
                  <Settings size={13} /> Settings
                </button>
                <button className="gh-dropdown-item danger" onClick={handleGhLogout}>
                  <LogOut size={13} /> Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="gh-login-btn" onClick={() => setShowAuthModal(true)}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Login
          </button>
        )}
        {window.sai.platform === 'darwin' && (
          <div className="titlebar-brand">
            <SaiLogo mode="static" size={18} ariaLabel="SAI" />
          </div>
        )}
        {framelessRounded && (
          <div className="titlebar-window-controls">
            <button className="window-ctrl" onClick={() => window.sai.windowMinimize()} aria-label="Minimize">
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M1 9 H9" />
              </svg>
            </button>
            <button className="window-ctrl" onClick={() => window.sai.windowMaximizeToggle()} aria-label={maximized ? 'Restore' : 'Maximize'}>
              {maximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M1 3 H7 V9 H1 Z" />
                  <path d="M3 3 V1 H9 V7 H7" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M1 1 H9 V9 H1 Z" />
                </svg>
              )}
            </button>
            <button className="window-ctrl window-ctrl-close" onClick={() => window.sai.windowClose()} aria-label="Close">
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M1 1 L9 9 M9 1 L1 9" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {showAuthModal && <GitHubAuthModal onSuccess={handleAuthSuccess} onClose={() => setShowAuthModal(false)} />}
      {showClone && <GitHubCloneModal onCloned={(p) => { onProjectChange(p); }} onClose={() => setShowClone(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onSettingChange={onSettingChange} onOpenWhatsNew={onOpenWhatsNew} onHistoryRetentionChange={onHistoryRetentionChange} claudeModel={claudeModel} onClaudeModelChange={onClaudeModelChange} claudeEffort={claudeEffort} onClaudeEffortChange={onClaudeEffortChange} claudeModels={claudeModels} />}
      {showCreateMeta && (
        <CreateMetaWorkspaceModal
          recentProjects={recentProjects}
          onClose={() => setShowCreateMeta(false)}
          onCreated={(runtime) => {
            setShowCreateMeta(false);
            setOpen(false);
            onMetaCreated?.(runtime);
          }}
        />
      )}
      {manageMeta && (
        <ManageMetaWorkspaceModal
          meta={manageMeta}
          onClose={() => setManageMeta(null)}
          onUpdated={(runtime) => {
            setManageMeta(null);
            setOpen(false);
            onMetaUpdated?.(runtime);
          }}
          onDeleted={(id) => {
            setManageMeta(null);
            setOpen(false);
            onMetaDeleted?.(id);
          }}
        />
      )}
      {closeTarget && (
        <CloseWorkspaceModal
          projectPath={closeTarget}
          onConfirm={handleCloseConfirm}
          onCancel={() => setCloseTarget(null)}
        />
      )}
      <style>{`
        .titlebar {
          height: var(--titlebar-height);
          background: var(--surface-0);
          border-bottom: none;
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-app-region: drag;
          user-select: none;
          position: relative;
          z-index: 100;
        }
        .titlebar::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, var(--accent) 0%, var(--accent) 20%, transparent 85%);
          z-index: 200;
          pointer-events: none;
        }
        .titlebar-brand {
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          margin-left: 12px;
          flex-shrink: 0;
        }
        .titlebar-drag { flex: 1; }
        .titlebar-right {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-right: 104px;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
        }
        .titlebar-mac {
          padding-left: 78px;
        }
        .titlebar-mac .titlebar-right {
          margin-right: 12px;
        }
        .titlebar-frameless .titlebar-right {
          margin-right: 0;
        }
        .titlebar-window-controls {
          display: flex;
          align-items: stretch;
          margin-left: 0;
          height: var(--titlebar-height);
          -webkit-app-region: no-drag;
        }
        .window-ctrl {
          width: 32px;
          height: var(--titlebar-height);
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background-color 120ms ease, color 120ms ease;
        }
        .window-ctrl:hover {
          background: var(--surface-4);
          color: var(--text);
        }
        .window-ctrl-close:hover {
          background: #c4202b;
          color: #fff;
        }
        .titlebar-version {
          color: var(--text-secondary);
          font-size: 10px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          cursor: pointer;
          -webkit-app-region: no-drag;
        }
        .titlebar-version:hover { color: var(--accent); }
        .titlebar-dev-pill {
          font-size: 9px;
          font-weight: 700;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          letter-spacing: 0.5px;
          color: #c7910c;
          background: rgba(199, 145, 12, 0.12);
          border: 1px solid rgba(199, 145, 12, 0.35);
          border-radius: 8px;
          padding: 1px 8px;
        }
        .titlebar-meta-icon {
          color: var(--accent);
          flex-shrink: 0;
        }
        .titlebar-meta-indicator {
          flex-shrink: 0;
          margin-left: 2px;
        }
        .titlebar-meta-indicator.approval { color: #f87171; animation: approval-blink 1.2s ease-in-out infinite; }
        .titlebar-meta-indicator.completed { color: #4ade80; animation: done-pulse 2s ease-in-out infinite; }
        .titlebar-meta-indicator.busy { color: var(--accent); animation: dot-spinner-pulse 2.2s ease-in-out infinite; }
        .gh-login-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--surface-2);
          border: 1px solid var(--border-subtle);
          border-radius: 5px;
          color: var(--text-secondary);
          font-size: 11px;
          padding: 3px 8px;
          cursor: pointer;
        }
        .gh-login-btn:hover { color: var(--text); border-color: var(--accent); }
        .gh-user-wrapper {
          position: relative;
        }
        .gh-user-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background: none;
          border: 1px solid transparent;
          border-radius: 5px;
          cursor: pointer;
          padding: 2px 6px;
          color: var(--text-secondary);
          font-family: 'Onest', sans-serif;
        }
        .gh-user-btn:hover { background: var(--surface-4); border-color: var(--border-subtle); color: var(--text); }
        .gh-avatar-wrap { position: relative; flex-shrink: 0; }
        .gh-avatar {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
        }
        .gh-sync-dot {
          position: absolute;
          bottom: -1px;
          right: -1px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          border: 1px solid var(--surface-0);
        }
        .gh-sync-dot.syncing { background: var(--accent); animation: sync-pulse 1s ease-in-out infinite; }
        .gh-sync-dot.error { background: #f87171; }
        @keyframes sync-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        .gh-username {
          font-size: 11px;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .gh-chevron {
          transition: transform 0.15s;
        }
        .gh-chevron.open { transform: rotate(180deg); }
        .gh-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          background: var(--surface-3);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          min-width: 200px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          overflow: hidden;
          z-index: 500;
          animation: dropdown-in 0.15s ease-out;
        }
        .gh-dropdown-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
        }
        .gh-dropdown-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
        }
        .gh-dropdown-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
        }
        .gh-dropdown-login {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 1px;
        }
        .gh-dropdown-divider {
          height: 1px;
          background: var(--border-hairline);
        }
        .gh-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: none;
          border: none;
          color: var(--text);
          font-size: 12px;
          cursor: pointer;
          text-align: left;
        }
        .gh-dropdown-item:hover { background: var(--surface-4); }
        .gh-dropdown-item.danger { color: #f87171; }
        .gh-dropdown-item.danger:hover { background: rgba(248,113,113,0.08); }
        .project-dropdown-wrapper {
          -webkit-app-region: no-drag;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
        }
        .project-selector {
          background: transparent;
          border: 1px solid transparent;
          color: var(--text);
          font-family: 'Onest', sans-serif;
          font-size: 12px;
          cursor: pointer;
          padding: 4px 12px;
          border-radius: 4px;
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          line-height: 1;
        }
        .titlebar-busy-indicator {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-left: 6px;
          vertical-align: middle;
        }
        @keyframes dot-spinner-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.75); }
        }
        .titlebar-busy-count {
          font-size: 10px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          color: var(--text-muted);
          opacity: 0.6;
          font-weight: 500;
        }
        @keyframes done-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes approval-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .workspace-approval-label {
          font-size: 11px;
          color: #f59e0b;
          margin-left: 4px;
        }
        .dropdown-item.active .workspace-approval-label {
          color: #f59e0b;
          opacity: 1;
        }
        .project-selector:hover {
          background: var(--surface-4);
          border-color: var(--border-subtle);
        }
        .project-dropdown {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 4px;
          background: var(--surface-3);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          width: 420px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          animation: fade-in 0.15s ease-out;
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .dropdown-label {
          padding: 8px 12px 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }
        .dropdown-item {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 6px 12px;
          background: none;
          border: none;
          color: var(--text);
          cursor: pointer;
          text-align: left;
          font-size: 13px;
        }
        .dropdown-item:hover {
          background: var(--surface-4);
        }
        .dropdown-item.active {
          background: var(--surface-4);
          color: var(--text);
          position: relative;
        }
        .dropdown-item.active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 4px;
          bottom: 4px;
          width: 3px;
          border-radius: 0 2px 2px 0;
          background: var(--accent);
        }
        .dropdown-item.active .dropdown-item-path {
          color: var(--text-muted);
          opacity: 1;
        }
        .dropdown-item-name {
          font-weight: 500;
        }
        .dropdown-item-path {
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dropdown-divider {
          height: 1px;
          background: var(--border-hairline);
          margin: 4px 0;
        }
        .dropdown-inactive-scroll {
          max-height: 280px;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .dropdown-inactive-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .dropdown-inactive-scroll::-webkit-scrollbar-thumb {
          background: var(--border-hairline);
          border-radius: 4px;
        }
        .dropdown-inactive-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }
        .dropdown-inactive-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .workspace-item {
          flex-direction: row !important;
          align-items: center;
          gap: 8px;
        }
        .workspace-item .dropdown-item-path {
          margin-left: auto;
          flex-shrink: 1;
        }
        .workspace-row-wrapper {
          position: relative;
        }
        .workspace-row-wrapper .dropdown-item {
          padding-right: 36px;
        }
        .workspace-overflow-btn {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          letter-spacing: 1px;
          padding: 2px 4px;
          border-radius: 3px;
          opacity: 0;
          -webkit-app-region: no-drag;
        }
        .workspace-row-wrapper:hover .workspace-overflow-btn,
        .workspace-overflow-btn.open {
          opacity: 1;
        }
        .workspace-overflow-btn:hover {
          background: var(--surface-4);
          color: var(--text);
        }
        .workspace-submenu {
          position: absolute;
          right: 8px;
          top: calc(100% - 4px);
          z-index: 200;
          background: var(--surface-3);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 4px 0;
          min-width: 120px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        }
        .workspace-submenu-item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 7px 12px;
          background: none;
          border: none;
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          text-align: left;
          -webkit-app-region: no-drag;
        }
        .workspace-submenu-item:hover {
          background: var(--surface-4);
        }
        .workspace-submenu-item.danger {
          color: #f87171;
        }
        .workspace-submenu-item.danger:hover {
          background: rgba(248,113,113,0.08);
        }
        .picker-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-hairline);
          padding: 4px 8px 0;
          gap: 2px;
        }
        .picker-tabs button {
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
        }
        .picker-tabs button:hover {
          color: var(--text);
          background: var(--surface-4);
        }
        .picker-tabs button.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
          background: transparent;
        }
        .picker-tabs button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .picker-tab-label { line-height: 1; }
        .picker-tab-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
        }
        .picker-tab-approval { background: #f87171; }
        .picker-tab-completed { background: #4ade80; }
        .picker-tab-spinner {
          width: 9px;
          height: 9px;
          background: var(--accent);
          -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
          mask: url("${DOT_MASK_URL}") center / contain no-repeat;
          display: inline-block;
          flex-shrink: 0;
          animation: dot-spinner-pulse 2.2s ease-in-out infinite;
        }
        .picker-tab-meta-icon { flex-shrink: 0; }
        .picker-tab-meta-icon.approval { color: #f87171; animation: approval-blink 1.2s ease-in-out infinite; }
        .picker-tab-meta-icon.completed { color: #4ade80; }
        .picker-tab-meta-icon.busy { color: var(--accent); animation: dot-spinner-pulse 2.2s ease-in-out infinite; }
        .meta-workspace-row {
          display: flex;
          align-items: center;
          gap: 0;
        }
        .meta-workspace-row .meta-workspace-item {
          flex: 1;
          min-width: 0;
        }
        .meta-workspace-manage-btn {
          flex-shrink: 0;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px 6px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          opacity: 0;
          transition: opacity 0.12s, color 0.12s;
        }
        .meta-workspace-row:hover .meta-workspace-manage-btn {
          opacity: 1;
        }
        .meta-workspace-manage-btn:hover {
          color: var(--text);
          background: var(--surface-4);
        }
        .meta-workspace-item {
          flex-direction: row !important;
          align-items: center;
          gap: 8px;
        }
        .meta-workspace-icon {
          flex-shrink: 0;
          color: var(--text-muted);
        }
        .meta-workspace-item.active .meta-workspace-icon {
          color: var(--text);
        }
        .meta-workspace-icon.approval { color: #f87171 !important; animation: approval-blink 1.2s ease-in-out infinite; }
        .meta-workspace-icon.busy { color: var(--accent) !important; animation: dot-spinner-pulse 2.2s ease-in-out infinite; }
        .meta-workspace-icon.completed { color: #4ade80 !important; }
        .meta-workspace-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .meta-workspace-item .dropdown-item-path {
          margin-top: 1px;
        }
        .meta-empty-state {
          padding: 16px 12px;
          font-size: 12px;
          color: var(--text-muted);
          text-align: center;
        }
      `}</style>
    </div>
  );
}
