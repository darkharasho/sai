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
import { MessageSquare, TerminalSquare, Code2 } from 'lucide-react';

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
    window.sai.getRecentProjects().then((projects: string[]) => {
      if (projects.length > 0 && !projectPath) {
        setProjectPath(projects[0]);
      }
    });
  }, []);

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  // Accordion state: ordered list of expanded panels (max 2)
  const [expanded, setExpanded] = useState<PanelId[]>(['chat', 'terminal']);

  const togglePanel = useCallback((panel: PanelId) => {
    setExpanded(prev => {
      if (prev.includes(panel)) {
        // Collapse — but don't allow 0 expanded panels
        const next = prev.filter(p => p !== panel);
        return next.length > 0 ? next : prev;
      } else {
        // Expand — if already 2 open, collapse the oldest
        const next = [...prev, panel];
        return next.length > 2 ? next.slice(1) : next;
      }
    });
  }, []);

  const hasFiles = openFiles.length > 0;

  // Open a git diff file in tabs
  const handleFileClick = useCallback((file: GitFile) => {
    setOpenFiles(prev => {
      const exists = prev.some(f => f.path === file.path);
      if (exists) return prev;
      return [...prev, { path: file.path, viewMode: 'diff', file, diffMode: 'unified' }];
    });
    setActiveFilePath(file.path);
    // Auto-expand editor when opening a file
    setExpanded(prev => {
      if (prev.includes('editor')) return prev;
      const next = [...prev, 'editor' as PanelId];
      return next.length > 2 ? next.slice(1) : next;
    });
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
      // Auto-expand editor
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        const next = [...prev, 'editor' as PanelId];
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read (binary, permissions, etc.)
    }
  }, []);

  const handleFileClose = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.path !== path);
      if (next.length === 0) {
        setActiveFilePath(null);
        // No more files — go back to chat + terminal
        setExpanded(['chat', 'terminal']);
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

          {/* Chat accordion */}
          <div className={`accordion-panel ${chatOpen ? 'accordion-expanded' : 'accordion-collapsed'}`}>
            <div className="accordion-bar" onClick={() => togglePanel('chat')}>
              <MessageSquare size={12} />
              <span>Chat</span>
            </div>
            {chatOpen && (
              <div className="accordion-body">
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
            )}
          </div>

          {/* Editor accordion — only visible when files are open */}
          {hasFiles && (
            <div className={`accordion-panel ${editorOpen ? 'accordion-expanded' : 'accordion-collapsed'}`}>
              <div className="accordion-bar" onClick={() => togglePanel('editor')}>
                <Code2 size={12} />
                <span>Editor</span>
                {activeFilePath && (
                  <span className="accordion-bar-detail">
                    {activeFilePath.split('/').pop()}
                  </span>
                )}
              </div>
              {editorOpen && (
                <div className="accordion-body">
                  <CodePanel
                    openFiles={openFiles}
                    activeFilePath={activeFilePath!}
                    projectPath={projectPath}
                    onActivate={setActiveFilePath}
                    onClose={handleFileClose}
                    onCloseAll={handleCloseAllFiles}
                    onDiffModeChange={handleDiffModeChange}
                    onEditorSave={handleEditorSave}
                  />
                </div>
              )}
            </div>
          )}

          {/* Terminal accordion */}
          <div className={`accordion-panel ${terminalOpen ? 'accordion-expanded' : 'accordion-collapsed'}`}>
            <div className="accordion-bar" onClick={() => togglePanel('terminal')}>
              <TerminalSquare size={12} />
              <span>Terminal</span>
            </div>
            {terminalOpen && (
              <div className="accordion-body">
                <TerminalPanel projectPath={projectPath} />
              </div>
            )}
          </div>

        </div>
      </div>

      <style>{`
        .accordion-panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex-shrink: 0;
        }
        .accordion-panel.accordion-expanded {
          flex: 1;
          flex-shrink: 1;
          min-height: 0;
        }
        .accordion-panel.accordion-collapsed {
          flex: 0 0 auto;
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
        .accordion-body {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .accordion-body .terminal-panel {
          height: 100%;
          border-top: none;
        }
      `}</style>
    </div>
  );
}
