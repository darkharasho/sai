import { useState } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import TitleBar from './components/TitleBar';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [chatKey, setChatKey] = useState(0); // Force remount to reset chat

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  const handleNewChat = () => {
    // Increment key to force ChatPanel to remount (resets session)
    setChatKey(k => k + 1);
  };

  return (
    <div className="app">
      <TitleBar projectPath={projectPath} onProjectChange={setProjectPath} onNewChat={handleNewChat} />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} />
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} />}
        <div className="main-content">
          <ChatPanel key={chatKey} projectPath={projectPath} />
          <TerminalPanel projectPath={projectPath} />
        </div>
      </div>
    </div>
  );
}
