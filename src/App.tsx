import { useState, useCallback, useEffect } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
import type { ChatSession, ChatMessage, GitFile, OpenFile } from './types';
import { MessageSquare, TerminalSquare } from 'lucide-react';

type PermissionMode = 'default' | 'bypass';

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
    window.sai.getRecentProjects().then((projects: string[]) => {
      if (projects.length > 0 && !projectPath) {
        setProjectPath(projects[0]);
      }
    });
  }, []);

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  // Open a git diff file in tabs
  const handleFileClick = useCallback((file: GitFile) => {
    setOpenFiles(prev => {
      const exists = prev.some(f => f.path === file.path);
      if (exists) return prev;
      return [...prev, { path: file.path, viewMode: 'diff', file, diffMode: 'unified' }];
    });
    setActiveFilePath(file.path);
  }, []);

  // Open a file from the explorer in tabs with Monaco editor
  const handleFileOpen = useCallback(async (filePath: string) => {
    try {
      const content = await window.sai.fsReadFile(filePath) as string;
      setOpenFiles(prev => {
        const exists = prev.some(f => f.path === filePath);
        if (exists) return prev;
        return [...prev, { path: filePath, viewMode: 'editor', content }];
      });
      setActiveFilePath(filePath);
    } catch {
      // File couldn't be read (binary, permissions, etc.)
    }
  }, []);

  const handleFileClose = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.path !== path);
      if (next.length === 0) {
        setActiveFilePath(null);
        setChatExpanded(false);
        setTerminalExpanded(false);
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
    setChatExpanded(false);
    setTerminalExpanded(false);
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

  const hasFiles = !!activeFilePath;

  return (
    <div className="app">
      <TitleBar
        projectPath={projectPath}
        onProjectChange={setProjectPath}
        onNewChat={handleNewChat}
        sessions={sessions}
        activeSessionId={activeSession.id}
        onSelectSession={handleSelectSession}
      />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} />
        {sidebarOpen === 'files' && <FileExplorerSidebar projectPath={projectPath} onFileOpen={handleFileOpen} />}
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} onFileClick={handleFileClick} />}
        <div className="main-content">
          {hasFiles ? (
            <>
              {/* Collapsible Chat — top */}
              <div
                className={`collapsible-panel collapsible-chat ${chatExpanded ? 'expanded' : 'collapsed'}`}
              >
                {chatExpanded ? (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    <div
                      className="collapsible-bar"
                      onClick={() => setChatExpanded(false)}
                    >
                      <MessageSquare size={12} />
                      <span>Chat</span>
                      <span className="collapse-hint">click to collapse</span>
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <ChatPanel
                        key={activeSession.id}
                        projectPath={projectPath}
                        permissionMode={permissionMode}
                        onPermissionChange={handlePermissionChange}
                        initialMessages={activeSession.messages}
                        onMessagesChange={handleMessagesChange}
                        onTurnComplete={handleSessionSave}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    className="collapsible-bar"
                    onClick={() => setChatExpanded(true)}
                  >
                    <MessageSquare size={12} />
                    <span>Chat</span>
                  </div>
                )}
              </div>

              {/* Editor — middle */}
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

              {/* Collapsible Terminal — bottom */}
              <div
                className={`collapsible-panel collapsible-terminal ${terminalExpanded ? 'expanded' : 'collapsed'}`}
              >
                {terminalExpanded ? (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    <div
                      className="collapsible-bar"
                      onClick={() => setTerminalExpanded(false)}
                    >
                      <TerminalSquare size={12} />
                      <span>Terminal</span>
                      <span className="collapse-hint">click to collapse</span>
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <TerminalPanel projectPath={projectPath} />
                    </div>
                  </div>
                ) : (
                  <div
                    className="collapsible-bar"
                    onClick={() => setTerminalExpanded(true)}
                  >
                    <TerminalSquare size={12} />
                    <span>Terminal</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <ChatPanel
                key={activeSession.id}
                projectPath={projectPath}
                permissionMode={permissionMode}
                onPermissionChange={handlePermissionChange}
                initialMessages={activeSession.messages}
                onMessagesChange={handleMessagesChange}
                onTurnComplete={handleSessionSave}
              />
              <TerminalPanel projectPath={projectPath} />
            </>
          )}
        </div>
      </div>

      <style>{`
        .collapsible-panel {
          border-top: 1px solid var(--border);
          overflow: hidden;
          transition: height 0.2s ease, flex 0.2s ease;
          flex-shrink: 0;
        }
        .collapsible-panel.collapsed {
          height: 32px;
        }
        .collapsible-chat.expanded {
          flex: 1;
          height: auto;
          min-height: 150px;
          max-height: 50%;
        }
        .collapsible-terminal.expanded {
          height: 280px;
        }
        .collapsible-bar {
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
        }
        .collapsible-bar:hover {
          color: var(--text-secondary);
          background: var(--bg-hover);
        }
        .collapse-hint {
          margin-left: auto;
          font-size: 10px;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          opacity: 0;
          transition: opacity 0.15s;
        }
        .collapsible-bar:hover .collapse-hint {
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}
