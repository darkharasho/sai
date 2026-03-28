import { useState, useCallback } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import TitleBar from './components/TitleBar';
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
import type { ChatSession, ChatMessage } from './types';

type PermissionMode = 'default' | 'bypass';

function getStoredPermission(): PermissionMode {
  try {
    const v = localStorage.getItem('vsai-permission-mode');
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
    localStorage.setItem('vsai-permission-mode', mode);
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
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} />}
        <div className="main-content">
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
        </div>
      </div>
    </div>
  );
}
