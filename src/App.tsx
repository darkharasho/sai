import { useState } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import TitleBar from './components/TitleBar';

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
  const [chatKey, setChatKey] = useState(0);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(getStoredPermission);

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  const handleNewChat = () => {
    setChatKey(k => k + 1);
  };

  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    localStorage.setItem('vsai-permission-mode', mode);
  };

  return (
    <div className="app">
      <TitleBar projectPath={projectPath} onProjectChange={setProjectPath} onNewChat={handleNewChat} />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} />
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} />}
        <div className="main-content">
          <ChatPanel
            key={chatKey}
            projectPath={projectPath}
            permissionMode={permissionMode}
            onPermissionChange={handlePermissionChange}
          />
          <TerminalPanel projectPath={projectPath} />
        </div>
      </div>
    </div>
  );
}
