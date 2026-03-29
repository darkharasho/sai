import { useState, useCallback, useEffect, useRef } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import UnsavedChangesModal from './components/UnsavedChangesModal';
import { loadSessions, saveSessions, createSession, upsertSession, migrateLegacySessions } from './sessions';
import type { ChatSession, ChatMessage, GitFile, OpenFile, WorkspaceContext } from './types';
import { MessageSquare, TerminalSquare, Code2, ChevronRight, MessageCirclePlus, Clock } from 'lucide-react';
import { formatSessionDate, formatSessionTime } from './sessions';

type PermissionMode = 'default' | 'bypass';
type EffortLevel = 'low' | 'medium' | 'high' | 'max';
type ModelChoice = 'sonnet' | 'opus' | 'haiku';
type PanelId = 'chat' | 'editor' | 'terminal';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [activeProjectPath, setActiveProjectPath] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high');
  const [modelChoice, setModelChoice] = useState<ModelChoice>('sonnet');
  const [workspaces, setWorkspaces] = useState<Map<string, WorkspaceContext>>(new Map());
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  // Ref to hold latest messages per workspace without triggering re-renders during streaming
  const wsMessagesRef = useRef<Map<string, ChatMessage[]>>(new Map());

  const getWorkspace = useCallback((path: string): WorkspaceContext => {
    const existing = workspaces.get(path);
    if (existing) return existing;
    return {
      projectPath: path,
      sessions: [],
      activeSession: createSession(),
      openFiles: [],
      activeFilePath: null,
      terminalIds: [],
      status: 'recent',
      lastActivity: Date.now(),
    };
  }, [workspaces]);

  const activeWorkspace = activeProjectPath ? getWorkspace(activeProjectPath) : null;

  const updateWorkspace = useCallback((path: string, updater: (ws: WorkspaceContext) => WorkspaceContext) => {
    setWorkspaces(prev => {
      const next = new Map(prev);
      const current = next.get(path) || {
        projectPath: path,
        sessions: [],
        activeSession: createSession(),
        openFiles: [],
        activeFilePath: null,
        terminalIds: [],
        status: 'active' as const,
        lastActivity: Date.now(),
      };
      next.set(path, updater(current));
      return next;
    });
  }, []);

  // Derived state for the active workspace
  const projectPath = activeProjectPath;
  const sessions = activeWorkspace?.sessions ?? [];
  const activeSession = activeWorkspace?.activeSession ?? createSession();
  const openFiles = activeWorkspace?.openFiles ?? [];
  const activeFilePath = activeWorkspace?.activeFilePath ?? null;

  // Load persisted settings from main process (file-based, works in dev+prod)
  useEffect(() => {
    window.sai.settingsGet('permissionMode', 'default').then((v: string) => {
      if (v === 'bypass') setPermissionMode('bypass');
    });
    window.sai.settingsGet('effortLevel', 'high').then((v: string) => {
      if (v === 'low' || v === 'medium' || v === 'high' || v === 'max') setEffortLevel(v as EffortLevel);
    });
    window.sai.settingsGet('modelChoice', 'sonnet').then((v: string) => {
      if (v === 'sonnet' || v === 'opus' || v === 'haiku') setModelChoice(v as ModelChoice);
    });
  }, []);

  useEffect(() => {
    window.sai.getCwd().then((cwd: string) => {
      if (cwd) {
        migrateLegacySessions(cwd);
        const sessions = loadSessions(cwd);
        setActiveProjectPath(cwd);
        setWorkspaces(new Map([[cwd, {
          projectPath: cwd,
          sessions,
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          status: 'active',
          lastActivity: Date.now(),
        }]]));
      }
    });
  }, []);

  const [gitChangeCount, setGitChangeCount] = useState(0);

  useEffect(() => {
    if (!projectPath) return;
    const poll = () => {
      (window.sai.gitStatus(projectPath) as Promise<any>).then((status: any) => {
        const paths = new Set<string>();
        for (const item of [...(status.staged ?? []), ...(status.modified ?? []), ...(status.created ?? []), ...(status.deleted ?? []), ...(status.not_added ?? [])]) {
          paths.add(typeof item === 'string' ? item : item.path);
        }
        setGitChangeCount(paths.size);
      }).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [projectPath]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    if (historyOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [historyOpen]);

  useEffect(() => {
    const cleanup = window.sai.onWorkspaceSuspended?.((suspendedPath: string) => {
      updateWorkspace(suspendedPath, ws => ({ ...ws, status: 'suspended' }));
    });
    return cleanup;
  }, [updateWorkspace]);

  const groupedSessions = sessions.reduce<{ label: string; sessions: ChatSession[] }[]>((groups, session) => {
    const label = formatSessionDate(session.updatedAt);
    const existing = groups.find(g => g.label === label);
    if (existing) existing.sessions.push(session);
    else groups.push({ label, sessions: [session] });
    return groups;
  }, []);

  // Accordion state
  const [expanded, setExpanded] = useState<PanelId[]>(['chat', 'terminal']);
  // Split ratio: fraction of available space given to the first expanded panel (0.0–1.0)
  const [splitRatio, setSplitRatio] = useState(0.66);
  const [isDragging, setIsDragging] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: PanelId) => {
    setExpanded(prev => {
      if (prev.includes(panel)) {
        const next = prev.filter(p => p !== panel);
        if (next.length === 0) return prev;
        // When going from 2 to 1, reset split ratio for next time
        setSplitRatio(0.66);
        return next;
      } else {
        const next = [...prev, panel];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      }
    });
  }, []);

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const hasFiles = openFiles.length > 0;

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      // Total height minus the accordion bars (32px each * number of panels)
      const panels: PanelId[] = hasFiles ? ['chat', 'editor', 'terminal'] : ['chat', 'terminal'];
      const barHeight = panels.length * 32;
      const handleHeight = 6;
      const availableHeight = rect.height - barHeight - handleHeight;
      const mouseY = e.clientY - rect.top;

      // Find the position of the first expanded panel's bar
      let firstBarOffset = 0;
      for (const p of panels) {
        if (p === expandedPanels[0]) break;
        firstBarOffset += expanded.includes(p) ? 32 : 32; // collapsed panels are just bars
      }
      // Actually, let's compute based on panels above the divider
      // The divider sits between the two expanded panels. We need to figure out
      // how much vertical space is above the divider vs below.
      const relativeY = mouseY - firstBarOffset - 32; // subtract the first expanded panel's bar
      const ratio = Math.max(0.15, Math.min(0.85, relativeY / availableHeight));
      setSplitRatio(ratio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, expanded, hasFiles]);

  // Determine which panels are visible and which are expanded
  const allPanels: PanelId[] = hasFiles ? ['chat', 'editor', 'terminal'] : ['chat', 'terminal'];
  const expandedPanels = allPanels.filter(p => expanded.includes(p));
  const twoExpanded = expandedPanels.length === 2;

  const handleFileClick = useCallback((file: GitFile) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const exists = ws.openFiles.some(f => f.path === file.path);
      return {
        ...ws,
        openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: file.path, viewMode: 'diff', file, diffMode: 'unified' }],
        activeFilePath: file.path,
      };
    });
    setExpanded(prev => {
      if (prev.includes('editor')) return prev;
      const next = [...prev, 'editor' as PanelId];
      setSplitRatio(0.66);
      return next.length > 2 ? next.slice(1) : next;
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleFileOpen = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return;
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(activeProjectPath, ws => {
        const exists = ws.openFiles.some(f => f.path === filePath);
        return {
          ...ws,
          openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: filePath, viewMode: 'editor', content, savedContent: content, diskMtime: mtime }],
          activeFilePath: filePath,
        };
      });
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, [activeProjectPath, updateWorkspace]);

  const doFileClose = useCallback((path: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const next = ws.openFiles.filter(f => f.path !== path);
      let newActive = ws.activeFilePath;
      if (next.length === 0) {
        newActive = null;
        setExpanded(['chat', 'terminal']);
        setSplitRatio(0.66);
      } else if (path === ws.activeFilePath) {
        const idx = ws.openFiles.findIndex(f => f.path === path);
        newActive = next[Math.min(idx, next.length - 1)].path;
      }
      return { ...ws, openFiles: next, activeFilePath: newActive };
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleFileClose = useCallback((path: string) => {
    if (!activeProjectPath) return;
    const ws = workspaces.get(activeProjectPath);
    const file = ws?.openFiles.find(f => f.path === path);
    const isDirty = file?.viewMode === 'editor' && !!file.isDirty;
    if (isDirty) {
      setPendingClose(path);
    } else {
      doFileClose(path);
    }
  }, [activeProjectPath, workspaces, doFileClose]);

  const handleCloseAllFiles = useCallback(() => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: [],
      activeFilePath: null,
    }));
    setExpanded(['chat', 'terminal']);
    setSplitRatio(0.66);
  }, [activeProjectPath, updateWorkspace]);

  const handleDiffModeChange = useCallback((path: string, mode: 'unified' | 'split') => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === path ? { ...f, diffMode: mode } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleProjectSwitch = useCallback((newPath: string) => {
    if (newPath === activeProjectPath) return;
    window.sai.openRecentProject(newPath);
    const sessions = loadSessions(newPath);
    setWorkspaces(prev => {
      const next = new Map(prev);
      if (!next.has(newPath)) {
        next.set(newPath, {
          projectPath: newPath,
          sessions,
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          status: 'active',
          lastActivity: Date.now(),
        });
      } else {
        const ws = next.get(newPath)!;
        next.set(newPath, { ...ws, status: 'active', lastActivity: Date.now() });
      }
      return next;
    });
    setActiveProjectPath(newPath);
  }, [activeProjectPath]);

  const handleEditorSave = useCallback(async (filePath: string, content: string) => {
    await window.sai.fsWriteFile(filePath, content);
    const { mtime } = await window.sai.fsMtime(filePath) as { mtime: number };
    if (activeProjectPath) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, savedContent: content, isDirty: false, diskMtime: mtime } : f),
      }));
    }
  }, [activeProjectPath, updateWorkspace]);

  const handleEditorContentChange = useCallback((filePath: string, content: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, content } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleEditorDirtyChange = useCallback((filePath: string, dirty: boolean) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, isDirty: dirty } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const persistSessionForWorkspace = useCallback((wsPath: string, session: ChatSession) => {
    updateWorkspace(wsPath, ws => {
      const updated = upsertSession(ws.sessions, session);
      saveSessions(wsPath, updated);
      return { ...ws, sessions: updated };
    });
  }, [updateWorkspace]);

  const persistSession = useCallback((session: ChatSession) => {
    if (!activeProjectPath) return;
    persistSessionForWorkspace(activeProjectPath, session);
  }, [activeProjectPath, persistSessionForWorkspace]);

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  // Flush latest messages from ref into workspace state
  const flushMessages = useCallback((wsPath: string) => {
    const latestMessages = wsMessagesRef.current.get(wsPath);
    if (!latestMessages || latestMessages.length === 0) return;
    updateWorkspace(wsPath, ws => {
      const updated = { ...ws.activeSession, messages: latestMessages, updatedAt: Date.now() };
      if (!updated.title) {
        const firstUserMsg = latestMessages.find(m => m.role === 'user');
        if (firstUserMsg) updated.title = firstUserMsg.content.slice(0, 40);
      }
      return { ...ws, activeSession: updated };
    });
  }, [updateWorkspace]);

  const handleNewChat = () => {
    if (!activeProjectPath) return;
    flushMessages(activeProjectPath);
    persistSession(activeSession);
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      activeSession: createSession(),
    }));
  };

  const handleSelectSession = (id: string) => {
    if (!activeProjectPath) return;
    flushMessages(activeProjectPath);
    persistSession(activeSession);
    const selected = sessions.find(s => s.id === id);
    if (selected) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        activeSession: { ...selected },
      }));
    }
  };

  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    window.sai.settingsSet('permissionMode', mode);
  };

  const handleEffortChange = (level: EffortLevel) => {
    setEffortLevel(level);
    window.sai.settingsSet('effortLevel', level);
  };

  const handleModelChange = (model: ModelChoice) => {
    setModelChoice(model);
    window.sai.settingsSet('modelChoice', model);
  };

  const chatOpen = expanded.includes('chat');
  const editorOpen = expanded.includes('editor');
  const terminalOpen = expanded.includes('terminal');

  // Compute flex values: first expanded panel gets splitRatio, second gets the rest
  const getPanelFlex = (panel: PanelId): string => {
    if (!expanded.includes(panel)) return '0 0 32px';
    if (expandedPanels.length === 1) return '1 1 0%';
    const isFirst = expandedPanels[0] === panel;
    const ratio = isFirst ? splitRatio : 1 - splitRatio;
    return `${ratio} ${ratio} 0%`;
  };

  // Should we show a drag handle after this panel?
  const showHandleAfter = (panel: PanelId): boolean => {
    if (!twoExpanded) return false;
    return panel === expandedPanels[0];
  };

  const renderPanel = (panel: PanelId) => {
    const isOpen = expanded.includes(panel);
    const icon = panel === 'chat' ? <MessageSquare size={12} />
      : panel === 'editor' ? <Code2 size={12} />
      : <TerminalSquare size={12} />;
    const label = panel === 'chat' ? 'Chat' : panel === 'editor' ? 'Editor' : 'Terminal';

    return (
      <div
        key={panel}
        className={`accordion-panel ${isOpen ? 'accordion-expanded' : 'accordion-collapsed'}`}
        style={{ flex: getPanelFlex(panel), transition: isDragging ? 'none' : undefined }}
      >
        <div className="accordion-bar" onClick={() => togglePanel(panel)}>
          <ChevronRight size={12} className={`accordion-chevron ${isOpen ? 'open' : ''}`} />
          {icon}
          <span>{label}</span>
          {panel === 'editor' && !isOpen && activeFilePath && (
            <span className="accordion-bar-detail">
              {activeFilePath.split('/').pop()}
            </span>
          )}
          {panel === 'chat' && (
            <div className="accordion-bar-actions" ref={historyRef}>
              <button
                className="accordion-bar-btn"
                onClick={(e) => { e.stopPropagation(); setHistoryOpen(!historyOpen); }}
                title="Recent conversations"
              >
                <Clock size={12} />
              </button>
              <button
                className="accordion-bar-btn"
                onClick={(e) => { e.stopPropagation(); handleNewChat(); }}
                title="New conversation"
              >
                <MessageCirclePlus size={12} />
              </button>
              {historyOpen && (
                <div className="chat-history-dropdown">
                  {sessions.length === 0 ? (
                    <div className="dropdown-label" style={{ padding: '12px' }}>
                      No recent conversations
                    </div>
                  ) : (
                    groupedSessions.map((group, gi) => (
                      <div key={group.label}>
                        {gi > 0 && <div className="dropdown-divider" />}
                        <div className="dropdown-label">{group.label}</div>
                        {group.sessions.map(session => (
                          <button
                            key={session.id}
                            className={`dropdown-item history-item ${session.id === activeSession.id ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSession(session.id);
                              setHistoryOpen(false);
                            }}
                          >
                            <span className="dropdown-item-name">{session.title || 'Untitled'}</span>
                            <span className="dropdown-item-path">{formatSessionTime(session.updatedAt)}</span>
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="accordion-body-wrapper">
          <div className="accordion-body">
            {panel === 'chat' && Array.from(workspaces.entries()).map(([wsPath, ws]) => (
              <div
                key={`chat-${wsPath}`}
                style={{
                  display: wsPath === activeProjectPath ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <ChatPanel
                  key={ws.activeSession.id}
                  projectPath={wsPath}
                  permissionMode={permissionMode}
                  onPermissionChange={handlePermissionChange}
                  effortLevel={effortLevel}
                  onEffortChange={handleEffortChange}
                  modelChoice={modelChoice}
                  onModelChange={handleModelChange}
                  initialMessages={ws.activeSession.messages}
                  activeFilePath={ws.activeFilePath}
                  onMessagesChange={(messages: ChatMessage[]) => {
                    wsMessagesRef.current.set(wsPath, messages);
                  }}
                  onTurnComplete={() => {
                    const latestMessages = wsMessagesRef.current.get(wsPath) || [];
                    if (latestMessages.length === 0) return;
                    updateWorkspace(wsPath, w => {
                      const updated = { ...w.activeSession, messages: latestMessages, updatedAt: Date.now() };
                      if (!updated.title) {
                        const firstUserMsg = latestMessages.find(m => m.role === 'user');
                        if (firstUserMsg) updated.title = firstUserMsg.content.slice(0, 40);
                      }
                      const updatedSessions = upsertSession(w.sessions, updated);
                      saveSessions(wsPath, updatedSessions);
                      return { ...w, activeSession: updated, sessions: updatedSessions };
                    });
                  }}
                />
              </div>
            ))}
            {panel === 'editor' && activeFilePath && (
              <CodePanel
                openFiles={openFiles}
                activeFilePath={activeFilePath}
                projectPath={projectPath}
                onActivate={(path: string) => {
                  if (activeProjectPath) {
                    updateWorkspace(activeProjectPath, ws => ({ ...ws, activeFilePath: path }));
                  }
                }}
                onClose={handleFileClose}
                onCloseAll={handleCloseAllFiles}
                onDiffModeChange={handleDiffModeChange}
                onEditorSave={handleEditorSave}
                onEditorContentChange={handleEditorContentChange}
                onEditorDirtyChange={handleEditorDirtyChange}
              />
            )}
            {panel === 'terminal' && (
              <TerminalPanel projectPath={projectPath} />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      <TitleBar
        projectPath={projectPath}
        onProjectChange={handleProjectSwitch}
      />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} gitChangeCount={gitChangeCount} />
        {sidebarOpen === 'files' && <FileExplorerSidebar projectPath={projectPath} onFileOpen={handleFileOpen} />}
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} onFileClick={handleFileClick} />}
        <div className="main-content" ref={mainContentRef}>
          {allPanels.map((panel, i) => (
            <div key={panel} style={{ display: 'contents' }}>
              {renderPanel(panel)}
              {showHandleAfter(panel) && (
                <div
                  className={`drag-handle ${isDragging ? 'dragging' : ''}`}
                  onMouseDown={handleDragStart}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {isDragging && <div className="drag-overlay" />}

      {pendingClose && (() => {
        const ws = activeProjectPath ? workspaces.get(activeProjectPath) : null;
        const file = ws?.openFiles.find(f => f.path === pendingClose);
        const fileName = pendingClose.split('/').pop() ?? pendingClose;
        return (
          <UnsavedChangesModal
            fileName={fileName}
            onSave={async () => {
              if (file?.content !== undefined) {
                await handleEditorSave(pendingClose, file.content);
              }
              doFileClose(pendingClose);
              setPendingClose(null);
            }}
            onDiscard={() => {
              doFileClose(pendingClose);
              setPendingClose(null);
            }}
            onCancel={() => setPendingClose(null)}
          />
        );
      })()}

      <style>{`
        .accordion-panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: flex 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          min-height: 0;
        }
        .accordion-panel.accordion-collapsed {
          flex: 0 0 32px !important;
        }
        .accordion-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          height: 32px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          cursor: pointer;
          user-select: none;
          flex-shrink: 0;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border);
        }
        .accordion-panel:first-child .accordion-bar {
          border-top: none;
        }
        .accordion-bar:hover {
          color: var(--text-secondary);
          background: var(--bg-hover);
        }
        .accordion-chevron {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
          color: var(--text-muted);
        }
        .accordion-chevron.open {
          transform: rotate(90deg);
        }
        .accordion-bar-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: auto;
          position: relative;
        }
        .accordion-bar-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .accordion-bar-btn:hover {
          color: var(--accent);
          background: var(--bg-hover);
        }
        .chat-history-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          min-width: 280px;
          max-width: 350px;
          max-height: 400px;
          overflow-y: auto;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          z-index: 200;
          text-transform: none;
          letter-spacing: 0;
          font-weight: 400;
        }
        .chat-history-dropdown .dropdown-label {
          padding: 8px 12px 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }
        .chat-history-dropdown .dropdown-item {
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
        .chat-history-dropdown .dropdown-item:hover {
          background: var(--bg-hover);
        }
        .chat-history-dropdown .dropdown-item-name {
          font-weight: 500;
        }
        .chat-history-dropdown .dropdown-item-path {
          font-size: 11px;
          color: var(--text-muted);
        }
        .chat-history-dropdown .dropdown-divider {
          height: 1px;
          background: var(--border);
          margin: 4px 0;
        }
        .chat-history-dropdown .history-item.active {
          border-left: 2px solid var(--accent);
          background: rgba(126,184,247,0.05);
        }
        .chat-history-dropdown .history-item.active .dropdown-item-path {
          color: #fff;
        }
        .accordion-bar-detail {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          opacity: 0.6;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .accordion-body-wrapper {
          flex: 1;
          overflow: hidden;
          min-height: 0;
        }
        .accordion-collapsed .accordion-body-wrapper {
          flex: 0;
          height: 0;
        }
        .accordion-body {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .accordion-body .terminal-panel {
          height: 100%;
          border-top: none;
        }
        .drag-handle {
          height: 6px;
          flex-shrink: 0;
          cursor: row-resize;
          background: transparent;
          position: relative;
          z-index: 10;
        }
        .drag-handle::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 32px;
          height: 3px;
          border-radius: 2px;
          background: var(--text-muted);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .drag-handle:hover::after,
        .drag-handle.dragging::after {
          opacity: 0.5;
        }
        .drag-handle:hover,
        .drag-handle.dragging {
          background: var(--bg-hover);
        }
        .drag-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          cursor: row-resize;
        }
      `}</style>
    </div>
  );
}
