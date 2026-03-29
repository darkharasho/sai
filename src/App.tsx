import { useState, useCallback, useEffect, useRef } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
import type { ChatSession, ChatMessage, GitFile, OpenFile } from './types';
import { MessageSquare, TerminalSquare, Code2, ChevronRight, MessageCirclePlus, Clock } from 'lucide-react';
import { formatSessionDate, formatSessionTime } from './sessions';

type PermissionMode = 'default' | 'bypass';
type PanelId = 'chat' | 'editor' | 'terminal';

function getStoredPermission(): PermissionMode {
  try {
    const v = localStorage.getItem('sai-permission-mode');
    return v === 'bypass' ? 'bypass' : 'default';
  } catch {
    return 'default';
  }
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(getStoredPermission);

  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSession, setActiveSession] = useState<ChatSession>(createSession);

  useEffect(() => {
    window.sai.getCwd().then((cwd: string) => {
      if (cwd) setProjectPath(cwd);
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

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

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
    setOpenFiles(prev => {
      const exists = prev.some(f => f.path === file.path);
      if (exists) return prev;
      return [...prev, { path: file.path, viewMode: 'diff', file, diffMode: 'unified' }];
    });
    setActiveFilePath(file.path);
    setExpanded(prev => {
      if (prev.includes('editor')) return prev;
      const next = [...prev, 'editor' as PanelId];
      setSplitRatio(0.66);
      return next.length > 2 ? next.slice(1) : next;
    });
  }, []);

  const handleFileOpen = useCallback(async (filePath: string) => {
    try {
      const content = await window.sai.fsReadFile(filePath) as string;
      setOpenFiles(prev => {
        const exists = prev.some(f => f.path === filePath);
        if (exists) return prev;
        return [...prev, { path: filePath, viewMode: 'editor', content }];
      });
      setActiveFilePath(filePath);
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, []);

  const handleFileClose = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.path !== path);
      if (next.length === 0) {
        setActiveFilePath(null);
        setExpanded(['chat', 'terminal']);
        setSplitRatio(0.66);
      } else if (path === activeFilePath) {
        const idx = prev.findIndex(f => f.path === path);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveFilePath(newActive.path);
      }
      return next;
    });
  }, [activeFilePath]);

  const handleCloseAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
    setExpanded(['chat', 'terminal']);
    setSplitRatio(0.66);
  }, []);

  const handleDiffModeChange = useCallback((path: string, mode: 'unified' | 'split') => {
    setOpenFiles(prev =>
      prev.map(f => f.path === path ? { ...f, diffMode: mode } : f)
    );
  }, []);

  const handleEditorSave = useCallback(async (filePath: string, content: string) => {
    await window.sai.fsWriteFile(filePath, content);
  }, []);

  const persistSession = useCallback((session: ChatSession) => {
    setSessions(prev => {
      const updated = upsertSession(prev, session);
      saveSessions(updated);
      return updated;
    });
  }, []);

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  const handleNewChat = () => {
    persistSession(activeSession);
    setActiveSession(createSession());
  };

  const handleSelectSession = (id: string) => {
    persistSession(activeSession);
    const selected = sessions.find(s => s.id === id);
    if (selected) {
      setActiveSession({ ...selected });
    }
  };

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    setActiveSession(prev => {
      const updated = { ...prev, messages, updatedAt: Date.now() };
      if (!updated.title) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          updated.title = firstUserMsg.content.slice(0, 40);
        }
      }
      return updated;
    });
  }, []);

  const handleSessionSave = useCallback(() => {
    setActiveSession(prev => {
      if (prev.messages.length > 0) {
        persistSession(prev);
      }
      return prev;
    });
  }, [persistSession]);

  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    localStorage.setItem('sai-permission-mode', mode);
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
            {panel === 'chat' && (
              <ChatPanel
                key={activeSession.id}
                projectPath={projectPath}
                permissionMode={permissionMode}
                onPermissionChange={handlePermissionChange}
                initialMessages={activeSession.messages}
                onMessagesChange={handleMessagesChange}
                onTurnComplete={handleSessionSave}
              />
            )}
            {panel === 'editor' && activeFilePath && (
              <CodePanel
                openFiles={openFiles}
                activeFilePath={activeFilePath}
                projectPath={projectPath}
                onActivate={setActiveFilePath}
                onClose={handleFileClose}
                onCloseAll={handleCloseAllFiles}
                onDiffModeChange={handleDiffModeChange}
                onEditorSave={handleEditorSave}
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
        onProjectChange={setProjectPath}
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
