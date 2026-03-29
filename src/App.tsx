import { useState, useCallback, useEffect } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
import type { ChatSession, ChatMessage, GitFile, OpenFile } from './types';
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import EditorModal from './components/FileExplorer/EditorModal';

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
  const [editorModal, setEditorModal] = useState<{ path: string; content: string } | null>(null);

  const handleFileClick = useCallback((file: GitFile) => {
    setOpenFiles(prev => {
      const exists = prev.some(f => f.file.path === file.path);
      if (exists) return prev;
      return [...prev, { file, diffMode: 'unified' }];
    });
    setActiveFilePath(file.path);
  }, []);

  const handleFileClose = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.file.path !== path);
      if (next.length === 0) {
        setActiveFilePath(null);
      } else if (path === activeFilePath) {
        const idx = prev.findIndex(f => f.file.path === path);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveFilePath(newActive.file.path);
      }
      return next;
    });
  }, [activeFilePath]);

  const handleCloseAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
  }, []);

  const handleDiffModeChange = useCallback((path: string, mode: 'unified' | 'split') => {
    setOpenFiles(prev =>
      prev.map(f => f.file.path === path ? { ...f, diffMode: mode } : f)
    );
  }, []);

  const handleFileOpen = useCallback(async (filePath: string) => {
    try {
      const content = await window.sai.fsReadFile(filePath) as string;
      setEditorModal({ path: filePath, content });
    } catch {
      // File couldn't be read (binary, permissions, etc.)
    }
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
    // Save current session before creating new one
    persistSession(activeSession);
    setActiveSession(createSession());
  };

  const handleSelectSession = (id: string) => {
    // Save current session first
    persistSession(activeSession);
    const selected = sessions.find(s => s.id === id);
    if (selected) {
      setActiveSession({ ...selected });
    }
  };

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    setActiveSession(prev => {
      const updated = { ...prev, messages, updatedAt: Date.now() };
      // Set title from first user message
      if (!updated.title) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          updated.title = firstUserMsg.content.slice(0, 40);
        }
      }
      return updated;
    });
  }, []);

  // Persist active session whenever it changes and has messages
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
          {activeFilePath ? (
            <CodePanel
              openFiles={openFiles}
              activeFilePath={activeFilePath}
              projectPath={projectPath}
              onActivate={setActiveFilePath}
              onClose={handleFileClose}
              onCloseAll={handleCloseAllFiles}
              onDiffModeChange={handleDiffModeChange}
            />
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
      {editorModal && (
        <EditorModal
          filePath={editorModal.path}
          content={editorModal.content}
          onSave={handleEditorSave}
          onClose={() => setEditorModal(null)}
        />
      )}
    </div>
  );
}
