# VSAI Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a focused Electron + React desktop app that wraps Claude Code CLI in a polished GUI with an integrated terminal and git panel, themed with Bearded Theme Black & Gold colors.

**Architecture:** Electron main process manages windows and node-pty terminals. React renderer communicates via IPC. Claude Code CLI is spawned with `--output-format stream-json --input-format stream-json` for structured I/O. Git operations use simple-git. Theme uses Bearded Theme Black & Gold color palette.

**Tech Stack:** Electron, React, TypeScript, Vite, xterm.js, node-pty, simple-git, react-markdown, shiki

**Spec:** `docs/superpowers/specs/2026-03-28-vsai-desktop-app-design.md`

**Theme Colors (Bearded Black & Gold):**
```
--bg-primary: #111418        /* main background */
--bg-secondary: #0e1114      /* sidebar, activity bar */
--bg-mid: #101316            /* terminal background */
--bg-input: #181b1f          /* input fields */
--bg-hover: #24272a          /* hover states */
--border: #0c0e11            /* borders */
--accent: #c7910c            /* gold accent/primary */
--text: #c4c4c5              /* primary text */
--text-secondary: #949597    /* secondary text */
--blue: #11B7D4
--green: #00a884
--orange: #d4770c
--pink: #d46ec0
--purple: #a85ff1
--red: #E35535
--yellow: #c7910c
--turquoise: #38c7bd
```

---

## File Structure

```
vsai-app/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html
├── electron/
│   ├── main.ts              — Electron main process, window creation
│   ├── preload.ts           — IPC bridge between main and renderer
│   └── services/
│       ├── pty.ts           — node-pty terminal management
│       ├── claude.ts        — Claude Code CLI process management
│       └── git.ts           — Git operations via simple-git
├── src/
│   ├── main.tsx             — React entry
│   ├── App.tsx              — Root layout (nav + panels)
│   ├── styles/
│   │   └── globals.css      — CSS variables, resets, theme
│   ├── components/
│   │   ├── NavBar.tsx        — Left icon strip
│   │   ├── Chat/
│   │   │   ├── ChatPanel.tsx     — Message list + input container
│   │   │   ├── ChatMessage.tsx   — Single message renderer
│   │   │   ├── ChatInput.tsx     — Multi-line input with image paste
│   │   │   └── ToolCallCard.tsx  — Expandable tool call display
│   │   ├── Terminal/
│   │   │   └── TerminalPanel.tsx — xterm.js wrapper
│   │   ├── Git/
│   │   │   ├── GitSidebar.tsx    — Full git sidebar
│   │   │   ├── ChangedFiles.tsx  — Staged/unstaged file lists
│   │   │   ├── CommitBox.tsx     — Commit message + buttons
│   │   │   └── ClaudeActivity.tsx— Claude's recent commits
│   │   └── TitleBar.tsx          — Project selector + settings
│   ├── services/
│   │   └── ipc.ts           — Renderer-side IPC wrappers
│   └── types.ts             — Shared types
└── public/
    └── img/
        └── vsai.png         — App icon
```

---

## Task 1: Scaffold Electron + React + Vite Project

**Files:**
- Create: `vsai-app/package.json`
- Create: `vsai-app/tsconfig.json`
- Create: `vsai-app/tsconfig.node.json`
- Create: `vsai-app/vite.config.ts`
- Create: `vsai-app/index.html`
- Create: `vsai-app/electron/main.ts`
- Create: `vsai-app/electron/preload.ts`
- Create: `vsai-app/src/main.tsx`
- Create: `vsai-app/src/App.tsx`
- Create: `vsai-app/src/styles/globals.css`

- [ ] **Step 1: Create project directory and package.json**

```bash
mkdir -p /var/home/mstephens/Documents/GitHub/vsagent/vsai-app
cd /var/home/mstephens/Documents/GitHub/vsagent/vsai-app
```

```json
{
  "name": "vsai",
  "version": "0.1.0",
  "description": "AI-First Code Editor",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build && tsc -p tsconfig.node.json",
    "preview": "vite preview",
    "electron:dev": "vite build && electron ."
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "rehype-highlight": "^7.0.0",
    "simple-git": "^3.27.0",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^33.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vite-plugin-electron": "^0.28.0",
    "vite-plugin-electron-renderer": "^0.14.0"
  }
}
```

- [ ] **Step 2: Create TypeScript configs**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist-electron",
    "rootDir": "electron",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["electron"]
}
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
      },
    ]),
    renderer(),
  ],
});
```

- [ ] **Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VSAI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create electron/main.ts**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1114',
      symbolColor: '#c4c4c5',
      height: 38,
    },
    backgroundColor: '#111418',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../public/img/vsai.png'),
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
```

- [ ] **Step 6: Create electron/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vsai', {
  // Terminal
  terminalCreate: (cwd: string) => ipcRenderer.invoke('terminal:create', cwd),
  terminalWrite: (id: number, data: string) => ipcRenderer.send('terminal:write', id, data),
  terminalResize: (id: number, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
  terminalOnData: (callback: (id: number, data: string) => void) => {
    const listener = (_event: any, id: number, data: string) => callback(id, data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },

  // Claude
  claudeStart: (cwd: string) => ipcRenderer.invoke('claude:start', cwd),
  claudeSend: (message: string) => ipcRenderer.send('claude:send', message),
  claudeOnMessage: (callback: (msg: any) => void) => {
    const listener = (_event: any, msg: any) => callback(msg);
    ipcRenderer.on('claude:message', listener);
    return () => ipcRenderer.removeListener('claude:message', listener);
  },

  // Git
  gitStatus: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
  gitStage: (cwd: string, filepath: string) => ipcRenderer.invoke('git:stage', cwd, filepath),
  gitUnstage: (cwd: string, filepath: string) => ipcRenderer.invoke('git:unstage', cwd, filepath),
  gitCommit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
  gitPush: (cwd: string) => ipcRenderer.invoke('git:push', cwd),
  gitPull: (cwd: string) => ipcRenderer.invoke('git:pull', cwd),
  gitLog: (cwd: string, count: number) => ipcRenderer.invoke('git:log', cwd, count),

  // Project
  selectFolder: () => ipcRenderer.invoke('project:selectFolder'),
});
```

- [ ] **Step 7: Create src/main.tsx and src/App.tsx**

`src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`src/App.tsx`:
```tsx
import { useState } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import TitleBar from './components/TitleBar';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  return (
    <div className="app">
      <TitleBar projectPath={projectPath} onProjectChange={setProjectPath} />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} />
        {sidebarOpen === 'git' && (
          <GitSidebar projectPath={projectPath} />
        )}
        <div className="main-content">
          <ChatPanel projectPath={projectPath} />
          <TerminalPanel projectPath={projectPath} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create src/styles/globals.css**

```css
:root {
  --bg-primary: #111418;
  --bg-secondary: #0e1114;
  --bg-mid: #101316;
  --bg-input: #181b1f;
  --bg-hover: #24272a;
  --border: #1e2228;
  --accent: #c7910c;
  --accent-hover: #d9a020;
  --text: #c4c4c5;
  --text-secondary: #949597;
  --text-muted: #5a5c5e;
  --blue: #11B7D4;
  --green: #00a884;
  --orange: #d4770c;
  --pink: #d46ec0;
  --purple: #a85ff1;
  --red: #E35535;
  --yellow: #c7910c;
  --turquoise: #38c7bd;

  --nav-width: 48px;
  --sidebar-width: 300px;
  --titlebar-height: 38px;
  --terminal-min-height: 150px;

  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: var(--text);
  background: var(--bg-primary);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  overflow: hidden;
}

.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--text-muted);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* Code blocks */
code {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}

pre {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}
```

- [ ] **Step 9: Create placeholder components**

`src/components/NavBar.tsx`:
```tsx
interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
}

export default function NavBar({ activeSidebar, onToggle }: NavBarProps) {
  return (
    <div className="navbar">
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''}`}
        onClick={() => onToggle('git')}
        title="Source Control"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="6" r="3" />
          <circle cx="12" cy="18" r="3" />
          <line x1="12" y1="9" x2="12" y2="15" />
        </svg>
      </button>
      <style>{`
        .navbar {
          width: var(--nav-width);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 8px;
          gap: 4px;
          border-right: 1px solid var(--border);
          flex-shrink: 0;
        }
        .nav-btn {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 6px;
        }
        .nav-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .nav-btn.active {
          color: var(--accent);
          border-left: 2px solid var(--accent);
          border-radius: 0 6px 6px 0;
        }
      `}</style>
    </div>
  );
}
```

`src/components/TitleBar.tsx`:
```tsx
interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
}

export default function TitleBar({ projectPath, onProjectChange }: TitleBarProps) {
  const projectName = projectPath ? projectPath.split('/').pop() : 'No Project';

  const handleSelectFolder = async () => {
    const folder = await window.vsai.selectFolder();
    if (folder) {
      onProjectChange(folder);
    }
  };

  return (
    <div className="titlebar">
      <div className="titlebar-drag" />
      <button className="project-selector" onClick={handleSelectFolder}>
        {projectName} ▾
      </button>
      <style>{`
        .titlebar {
          height: var(--titlebar-height);
          background: var(--bg-secondary);
          display: flex;
          align-items: center;
          padding: 0 var(--nav-width);
          border-bottom: 1px solid var(--border);
          -webkit-app-region: drag;
        }
        .titlebar-drag {
          flex: 1;
        }
        .project-selector {
          -webkit-app-region: no-drag;
          background: none;
          border: 1px solid var(--border);
          color: var(--text);
          padding: 4px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
        }
        .project-selector:hover {
          background: var(--bg-hover);
        }
      `}</style>
    </div>
  );
}
```

`src/components/Chat/ChatPanel.tsx`:
```tsx
interface ChatPanelProps {
  projectPath: string;
}

export default function ChatPanel({ projectPath }: ChatPanelProps) {
  return (
    <div className="chat-panel">
      <div className="chat-messages">
        <div className="chat-empty">
          <p>VSAI</p>
          <p className="subtitle">Describe what to build</p>
        </div>
      </div>
      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder="Send a message..."
          rows={3}
        />
      </div>
      <style>{`
        .chat-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .chat-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary);
        }
        .chat-empty p {
          font-size: 20px;
          font-weight: 600;
          color: var(--accent);
        }
        .chat-empty .subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          font-weight: normal;
        }
        .chat-input-area {
          padding: 8px 16px 16px;
        }
        .chat-input {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          padding: 10px 14px;
          font-family: inherit;
          font-size: 13px;
          resize: none;
          outline: none;
        }
        .chat-input:focus {
          border-color: var(--accent);
        }
      `}</style>
    </div>
  );
}
```

`src/components/Terminal/TerminalPanel.tsx`:
```tsx
export default function TerminalPanel({ projectPath }: { projectPath: string }) {
  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>TERMINAL</span>
      </div>
      <div className="terminal-content" id="terminal-container" />
      <style>{`
        .terminal-panel {
          min-height: var(--terminal-min-height);
          height: 200px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          background: var(--bg-mid);
        }
        .terminal-header {
          padding: 4px 12px;
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border);
          letter-spacing: 0.5px;
        }
        .terminal-content {
          flex: 1;
          padding: 4px;
        }
      `}</style>
    </div>
  );
}
```

`src/components/Git/GitSidebar.tsx`:
```tsx
export default function GitSidebar({ projectPath }: { projectPath: string }) {
  return (
    <div className="git-sidebar">
      <div className="sidebar-header">SOURCE CONTROL</div>
      <div className="sidebar-section">
        <div className="section-title">Changes</div>
        <div className="empty-state">No changes</div>
      </div>
      <style>{`
        .git-sidebar {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          overflow-y: auto;
          flex-shrink: 0;
        }
        .sidebar-header {
          padding: 10px 16px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border);
        }
        .sidebar-section {
          padding: 8px 0;
        }
        .section-title {
          padding: 4px 16px;
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .empty-state {
          padding: 8px 16px;
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 10: Create types file**

`src/types.ts`:
```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  type: 'file_edit' | 'terminal_command' | 'file_read' | 'other';
  name: string;
  input: string;
  output?: string;
  expanded?: boolean;
}

export interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
  isClaude: boolean;
}

declare global {
  interface Window {
    vsai: {
      terminalCreate: (cwd: string) => Promise<number>;
      terminalWrite: (id: number, data: string) => void;
      terminalResize: (id: number, cols: number, rows: number) => void;
      terminalOnData: (callback: (id: number, data: string) => void) => () => void;
      claudeStart: (cwd: string) => Promise<void>;
      claudeSend: (message: string) => void;
      claudeOnMessage: (callback: (msg: any) => void) => () => void;
      gitStatus: (cwd: string) => Promise<any>;
      gitStage: (cwd: string, filepath: string) => Promise<void>;
      gitUnstage: (cwd: string, filepath: string) => Promise<void>;
      gitCommit: (cwd: string, message: string) => Promise<void>;
      gitPush: (cwd: string) => Promise<void>;
      gitPull: (cwd: string) => Promise<void>;
      gitLog: (cwd: string, count: number) => Promise<GitCommit[]>;
      selectFolder: () => Promise<string | null>;
    };
  }
}
```

- [ ] **Step 11: Install dependencies and verify build**

```bash
cd /var/home/mstephens/Documents/GitHub/vsagent/vsai-app
npm install
npm run build
```

Expected: Builds without errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "scaffold: create VSAI Electron + React + Vite project with theme"
```

---

## Task 2: Electron Main Process Services

**Files:**
- Create: `electron/services/pty.ts`
- Create: `electron/services/claude.ts`
- Create: `electron/services/git.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Create terminal service**

`electron/services/pty.ts`:
```typescript
import * as pty from 'node-pty';
import { BrowserWindow, ipcMain } from 'electron';

const terminals = new Map<number, pty.IPty>();
let nextId = 1;

export function registerTerminalHandlers(win: BrowserWindow) {
  ipcMain.handle('terminal:create', (_event, cwd: string) => {
    const shell = process.env.SHELL || '/bin/bash';
    const id = nextId++;
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd: cwd || process.env.HOME || '/',
      env: process.env as Record<string, string>,
    });

    terminals.set(id, term);

    term.onData((data) => {
      win.webContents.send('terminal:data', id, data);
    });

    term.onExit(() => {
      terminals.delete(id);
    });

    return id;
  });

  ipcMain.on('terminal:write', (_event, id: number, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows);
  });
}

export function destroyAllTerminals() {
  for (const term of terminals.values()) {
    term.kill();
  }
  terminals.clear();
}
```

- [ ] **Step 2: Create Claude service**

`electron/services/claude.ts`:
```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';

let claudeProcess: ChildProcess | null = null;

export function registerClaudeHandlers(win: BrowserWindow) {
  ipcMain.handle('claude:start', (_event, cwd: string) => {
    if (claudeProcess) {
      claudeProcess.kill();
    }

    claudeProcess = spawn('claude', [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
    ], {
      cwd: cwd || process.env.HOME || '/',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    claudeProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          win.webContents.send('claude:message', msg);
        } catch {
          // Partial JSON or non-JSON output — send as raw text
          win.webContents.send('claude:message', { type: 'raw', text: line });
        }
      }
    });

    claudeProcess.stderr?.on('data', (data: Buffer) => {
      win.webContents.send('claude:message', { type: 'error', text: data.toString() });
    });

    claudeProcess.on('exit', (code) => {
      win.webContents.send('claude:message', { type: 'exit', code });
      claudeProcess = null;
    });
  });

  ipcMain.on('claude:send', (_event, message: string) => {
    if (claudeProcess?.stdin?.writable) {
      claudeProcess.stdin.write(JSON.stringify({ type: 'user', content: message }) + '\n');
    }
  });
}

export function destroyClaude() {
  if (claudeProcess) {
    claudeProcess.kill();
    claudeProcess = null;
  }
}
```

- [ ] **Step 3: Create git service**

`electron/services/git.ts`:
```typescript
import simpleGit from 'simple-git';
import { ipcMain } from 'electron';

export function registerGitHandlers() {
  ipcMain.handle('git:status', async (_event, cwd: string) => {
    const git = simpleGit(cwd);
    const status = await git.status();
    return {
      branch: status.current,
      staged: status.staged.map(f => ({ path: f, status: 'staged' })),
      modified: status.modified.map(f => ({ path: f, status: 'modified' })),
      created: status.created.map(f => ({ path: f, status: 'added' })),
      deleted: status.deleted.map(f => ({ path: f, status: 'deleted' })),
      not_added: status.not_added.map(f => ({ path: f, status: 'added' })),
      ahead: status.ahead,
      behind: status.behind,
    };
  });

  ipcMain.handle('git:stage', async (_event, cwd: string, filepath: string) => {
    await simpleGit(cwd).add(filepath);
  });

  ipcMain.handle('git:unstage', async (_event, cwd: string, filepath: string) => {
    await simpleGit(cwd).reset(['HEAD', '--', filepath]);
  });

  ipcMain.handle('git:commit', async (_event, cwd: string, message: string) => {
    await simpleGit(cwd).commit(message);
  });

  ipcMain.handle('git:push', async (_event, cwd: string) => {
    await simpleGit(cwd).push();
  });

  ipcMain.handle('git:pull', async (_event, cwd: string) => {
    await simpleGit(cwd).pull();
  });

  ipcMain.handle('git:log', async (_event, cwd: string, count: number) => {
    const log = await simpleGit(cwd).log({ maxCount: count });
    return log.all.map(entry => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
      files: [],
      isClaude: entry.author_name.includes('Claude') || entry.message.includes('Co-Authored-By: Claude'),
    }));
  });
}
```

- [ ] **Step 4: Wire services into main.ts**

Update `electron/main.ts` to import and register all handlers:

```typescript
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { registerTerminalHandlers, destroyAllTerminals } from './services/pty';
import { registerClaudeHandlers, destroyClaude } from './services/claude';
import { registerGitHandlers } from './services/git';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1114',
      symbolColor: '#c4c4c5',
      height: 38,
    },
    backgroundColor: '#111418',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../public/img/vsai.png'),
  });

  registerTerminalHandlers(mainWindow);
  registerClaudeHandlers(mainWindow);
  registerGitHandlers();

  // Project folder picker
  ipcMain.handle('project:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    return result.filePaths[0] || null;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  destroyAllTerminals();
  destroyClaude();
  app.quit();
});
```

- [ ] **Step 5: Verify build**

```bash
cd /var/home/mstephens/Documents/GitHub/vsagent/vsai-app
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Electron main process services (terminal, claude, git)"
```

---

## Task 3: Terminal Panel with xterm.js

**Files:**
- Modify: `src/components/Terminal/TerminalPanel.tsx`

- [ ] **Step 1: Implement xterm.js terminal**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPanel({ projectPath }: { projectPath: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [terminalId, setTerminalId] = useState<number | null>(null);

  useEffect(() => {
    if (!termRef.current || !projectPath) return;

    const xterm = new Terminal({
      theme: {
        background: '#101316',
        foreground: '#c4c4c5',
        cursor: '#c7910c',
        selectionBackground: '#c7910c44',
        black: '#111418',
        red: '#E35535',
        green: '#00a884',
        yellow: '#c7910c',
        blue: '#11B7D4',
        magenta: '#d46ec0',
        cyan: '#38c7bd',
        white: '#c4c4c5',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.loadAddon(new WebLinksAddon());
    xterm.open(termRef.current);
    fit.fit();

    xtermRef.current = xterm;
    fitRef.current = fit;

    // Create terminal in main process
    window.vsai.terminalCreate(projectPath).then((id) => {
      setTerminalId(id);

      // Send user input to pty
      xterm.onData((data) => {
        window.vsai.terminalWrite(id, data);
      });

      // Resize pty when terminal resizes
      xterm.onResize(({ cols, rows }) => {
        window.vsai.terminalResize(id, cols, rows);
      });
    });

    // Receive pty output
    const cleanup = window.vsai.terminalOnData((id, data) => {
      xterm.write(data);
    });

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(termRef.current);

    return () => {
      cleanup();
      resizeObserver.disconnect();
      xterm.dispose();
    };
  }, [projectPath]);

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>TERMINAL</span>
      </div>
      <div className="terminal-content" ref={termRef} />
      <style>{`
        .terminal-panel {
          min-height: var(--terminal-min-height);
          height: 200px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          background: var(--bg-mid);
        }
        .terminal-header {
          padding: 6px 12px;
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border);
          letter-spacing: 0.5px;
        }
        .terminal-content {
          flex: 1;
          padding: 4px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: implement xterm.js terminal panel with node-pty backend"
```

---

## Task 4: Chat Panel with Claude Code Integration

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Create: `src/components/Chat/ChatMessage.tsx`
- Create: `src/components/Chat/ChatInput.tsx`
- Create: `src/components/Chat/ToolCallCard.tsx`

- [ ] **Step 1: Create ChatMessage component**

```tsx
import ReactMarkdown from 'react-markdown';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage as ChatMessageType } from '../../types';

export default function ChatMessage({ message }: { message: ChatMessageType }) {
  return (
    <div className={`chat-msg chat-msg-${message.role}`}>
      <div className="chat-msg-header">
        {message.role === 'assistant' ? 'Claude' : 'You'}
      </div>
      <div className="chat-msg-body">
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>
      {message.toolCalls?.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
      <style>{`
        .chat-msg {
          margin-bottom: 16px;
        }
        .chat-msg-header {
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .chat-msg-user .chat-msg-header {
          color: var(--green);
        }
        .chat-msg-assistant .chat-msg-header {
          color: var(--accent);
        }
        .chat-msg-body {
          color: var(--text);
          line-height: 1.6;
        }
        .chat-msg-body p {
          margin-bottom: 8px;
        }
        .chat-msg-body code {
          background: var(--bg-secondary);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
        }
        .chat-msg-body pre code {
          background: none;
          padding: 0;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Create ChatInput component**

```tsx
import { useState, useRef, KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSend(value.trim());
        setValue('');
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result as string;
            onSend(`[image: ${base64}]`);
          };
          reader.readAsDataURL(blob);
        }
        e.preventDefault();
        return;
      }
    }
  };

  return (
    <div className="chat-input-area">
      <textarea
        ref={textareaRef}
        className="chat-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Send a message... (Shift+Enter for newline)"
        rows={3}
        disabled={disabled}
      />
      <style>{`
        .chat-input-area {
          padding: 8px 16px 16px;
        }
        .chat-input {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          padding: 10px 14px;
          font-family: inherit;
          font-size: 13px;
          resize: none;
          outline: none;
        }
        .chat-input:focus {
          border-color: var(--accent);
        }
        .chat-input:disabled {
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Create ToolCallCard component**

```tsx
import { useState } from 'react';
import type { ToolCall } from '../../types';

export default function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const icon = toolCall.type === 'file_edit' ? '✏️' :
               toolCall.type === 'terminal_command' ? '▶' :
               toolCall.type === 'file_read' ? '📄' : '🔧';

  return (
    <div className="tool-call-card" onClick={() => setExpanded(!expanded)}>
      <div className="tool-call-header">
        <span className="tool-call-icon">{icon}</span>
        <span className="tool-call-name">{toolCall.name}</span>
        <span className="tool-call-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="tool-call-body">
          {toolCall.input && <pre><code>{toolCall.input}</code></pre>}
          {toolCall.output && (
            <div className="tool-call-output">
              <pre><code>{toolCall.output}</code></pre>
            </div>
          )}
        </div>
      )}
      <style>{`
        .tool-call-card {
          margin: 8px 0;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          overflow: hidden;
        }
        .tool-call-header {
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .tool-call-header:hover {
          background: var(--bg-hover);
        }
        .tool-call-icon {
          font-size: 14px;
        }
        .tool-call-name {
          flex: 1;
          font-family: 'JetBrains Mono', monospace;
        }
        .tool-call-chevron {
          color: var(--text-muted);
        }
        .tool-call-body {
          padding: 8px 12px;
          border-top: 1px solid var(--border);
        }
        .tool-call-body pre {
          font-size: 12px;
          margin: 0;
        }
        .tool-call-output {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed var(--border);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Wire up ChatPanel with Claude Code**

```tsx
import { useState, useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType } from '../../types';

export default function ChatPanel({ projectPath }: { projectPath: string }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectPath) return;

    window.vsai.claudeStart(projectPath);

    const cleanup = window.vsai.claudeOnMessage((msg) => {
      if (msg.type === 'assistant') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && isStreaming) {
            // Update streaming message
            return [...prev.slice(0, -1), { ...last, content: last.content + (msg.content || '') }];
          }
          // New assistant message
          return [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: msg.content || '',
            timestamp: Date.now(),
          }];
        });
        setIsStreaming(true);
      } else if (msg.type === 'result') {
        setIsStreaming(false);
      } else if (msg.type === 'error') {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: `Error: ${msg.text}`,
          timestamp: Date.now(),
        }]);
      }
    });

    return cleanup;
  }, [projectPath]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (text: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }]);
    window.vsai.claudeSend(text);
    setIsStreaming(true);
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>VSAI</p>
            <p className="subtitle">Describe what to build</p>
          </div>
        ) : (
          messages.map(msg => <ChatMessage key={msg.id} message={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput onSend={handleSend} disabled={!projectPath} />
      <style>{`
        .chat-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .chat-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 8px;
        }
        .chat-empty p:first-child {
          font-size: 24px;
          font-weight: 700;
          color: var(--accent);
        }
        .chat-empty .subtitle {
          font-size: 14px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: implement chat panel with Claude Code stream-json integration"
```

---

## Task 5: Git Sidebar

**Files:**
- Modify: `src/components/Git/GitSidebar.tsx`
- Create: `src/components/Git/ChangedFiles.tsx`
- Create: `src/components/Git/CommitBox.tsx`
- Create: `src/components/Git/ClaudeActivity.tsx`

- [ ] **Step 1: Create ChangedFiles component**

```tsx
import type { GitFile } from '../../types';

interface ChangedFilesProps {
  title: string;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionLabel: string;
}

export default function ChangedFiles({ title, files, onAction, actionLabel }: ChangedFilesProps) {
  const statusIcon = (status: string) => {
    switch (status) {
      case 'modified': return <span style={{ color: 'var(--orange)' }}>M</span>;
      case 'added': return <span style={{ color: 'var(--green)' }}>A</span>;
      case 'deleted': return <span style={{ color: 'var(--red)' }}>D</span>;
      case 'renamed': return <span style={{ color: 'var(--blue)' }}>R</span>;
      default: return <span>?</span>;
    }
  };

  if (files.length === 0) return null;

  return (
    <div className="changed-files">
      <div className="section-title">{title} ({files.length})</div>
      {files.map(file => (
        <div key={file.path} className="file-row" onClick={() => onAction(file)}>
          <span className="file-status">{statusIcon(file.status)}</span>
          <span className="file-path">{file.path}</span>
          <span className="file-action" title={actionLabel}>
            {file.staged ? '−' : '+'}
          </span>
        </div>
      ))}
      <style>{`
        .section-title {
          padding: 8px 16px 4px;
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .file-row {
          display: flex;
          align-items: center;
          padding: 3px 16px;
          gap: 8px;
          cursor: pointer;
          font-size: 12px;
        }
        .file-row:hover {
          background: var(--bg-hover);
        }
        .file-status {
          font-weight: 600;
          font-size: 11px;
          width: 16px;
          text-align: center;
        }
        .file-path {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary);
        }
        .file-action {
          color: var(--text-muted);
          font-size: 16px;
          opacity: 0;
          transition: opacity 0.1s;
        }
        .file-row:hover .file-action {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Create CommitBox component**

```tsx
import { useState } from 'react';

interface CommitBoxProps {
  onCommit: (message: string) => void;
  onPush: () => void;
  onPull: () => void;
  branch: string;
  ahead: number;
  behind: number;
}

export default function CommitBox({ onCommit, onPush, onPull, branch, ahead, behind }: CommitBoxProps) {
  const [message, setMessage] = useState('');

  const handleCommit = () => {
    if (message.trim()) {
      onCommit(message.trim());
      setMessage('');
    }
  };

  return (
    <div className="commit-box">
      <textarea
        className="commit-input"
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
      />
      <button className="commit-btn" onClick={handleCommit} disabled={!message.trim()}>
        Commit
      </button>
      <div className="branch-bar">
        <span className="branch-name">{branch || 'no branch'}</span>
        {ahead > 0 && <button className="sync-btn" onClick={onPush} title="Push">↑{ahead}</button>}
        {behind > 0 && <button className="sync-btn" onClick={onPull} title="Pull">↓{behind}</button>}
      </div>
      <style>{`
        .commit-box {
          padding: 8px 16px;
          border-top: 1px solid var(--border);
        }
        .commit-input {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--text);
          padding: 8px;
          font-family: inherit;
          font-size: 12px;
          resize: none;
          outline: none;
          margin-bottom: 8px;
        }
        .commit-input:focus {
          border-color: var(--accent);
        }
        .commit-btn {
          width: 100%;
          padding: 6px;
          background: var(--accent);
          color: #000;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
        }
        .commit-btn:hover {
          background: var(--accent-hover);
        }
        .commit-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .branch-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          font-size: 11px;
        }
        .branch-name {
          color: var(--accent);
        }
        .sync-btn {
          background: var(--bg-hover);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          padding: 2px 8px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 11px;
        }
        .sync-btn:hover {
          color: var(--text);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Create ClaudeActivity component**

```tsx
import type { GitCommit } from '../../types';

export default function ClaudeActivity({ commits }: { commits: GitCommit[] }) {
  const claudeCommits = commits.filter(c => c.isClaude);

  if (claudeCommits.length === 0) return null;

  return (
    <div className="claude-activity">
      <div className="section-title">Claude Activity</div>
      {claudeCommits.map(commit => (
        <div key={commit.hash} className="commit-row">
          <span className="commit-icon">🤖</span>
          <div className="commit-info">
            <div className="commit-msg">{commit.message}</div>
            <div className="commit-meta">{commit.hash.slice(0, 7)} · {commit.date}</div>
          </div>
        </div>
      ))}
      <style>{`
        .claude-activity {
          border-top: 1px solid var(--border);
          padding-top: 4px;
        }
        .commit-row {
          display: flex;
          gap: 8px;
          padding: 4px 16px;
          font-size: 12px;
        }
        .commit-icon {
          flex-shrink: 0;
        }
        .commit-msg {
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .commit-meta {
          font-size: 10px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Wire up GitSidebar**

```tsx
import { useState, useEffect } from 'react';
import ChangedFiles from './ChangedFiles';
import CommitBox from './CommitBox';
import ClaudeActivity from './ClaudeActivity';
import type { GitFile, GitCommit } from '../../types';

export default function GitSidebar({ projectPath }: { projectPath: string }) {
  const [staged, setStaged] = useState<GitFile[]>([]);
  const [unstaged, setUnstaged] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState('');
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [commits, setCommits] = useState<GitCommit[]>([]);

  const refresh = async () => {
    if (!projectPath) return;
    try {
      const status = await window.vsai.gitStatus(projectPath);
      setBranch(status.branch || '');
      setAhead(status.ahead || 0);
      setBehind(status.behind || 0);
      setStaged(status.staged.map((f: any) => ({ ...f, staged: true })));
      setUnstaged([
        ...status.modified,
        ...status.created,
        ...status.deleted,
        ...status.not_added,
      ].map((f: any) => ({ ...f, staged: false })));

      const log = await window.vsai.gitLog(projectPath, 20);
      setCommits(log);
    } catch {
      // Not a git repo or git error
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [projectPath]);

  const handleStage = async (file: GitFile) => {
    await window.vsai.gitStage(projectPath, file.path);
    refresh();
  };

  const handleUnstage = async (file: GitFile) => {
    await window.vsai.gitUnstage(projectPath, file.path);
    refresh();
  };

  const handleCommit = async (message: string) => {
    await window.vsai.gitCommit(projectPath, message);
    refresh();
  };

  return (
    <div className="git-sidebar">
      <div className="sidebar-header">SOURCE CONTROL</div>
      <ChangedFiles title="Staged" files={staged} onAction={handleUnstage} actionLabel="Unstage" />
      <ChangedFiles title="Changes" files={unstaged} onAction={handleStage} actionLabel="Stage" />
      <CommitBox
        onCommit={handleCommit}
        onPush={() => window.vsai.gitPush(projectPath).then(refresh)}
        onPull={() => window.vsai.gitPull(projectPath).then(refresh)}
        branch={branch}
        ahead={ahead}
        behind={behind}
      />
      <ClaudeActivity commits={commits} />
      <style>{`
        .git-sidebar {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          overflow-y: auto;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
        }
        .sidebar-header {
          padding: 10px 16px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: implement git sidebar with staging, commit, push/pull, Claude activity"
```

---

## Task 6: End-to-End Test

- [ ] **Step 1: Launch the app**

```bash
cd /var/home/mstephens/Documents/GitHub/vsagent/vsai-app
npm run electron:dev
```

- [ ] **Step 2: Verify layout**

Check:
- Dark theme with gold accents
- Left nav bar with git icon
- Center chat area with "VSAI / Describe what to build" placeholder
- Terminal at the bottom
- Title bar with project selector

- [ ] **Step 3: Open a project**

- Click the project selector in the title bar
- Select a folder
- Verify terminal opens with correct CWD
- Verify git sidebar populates when toggled

- [ ] **Step 4: Test chat**

- Type a message and press Enter
- Verify Claude Code responds
- Verify markdown rendering works

- [ ] **Step 5: Test git operations**

- Open git sidebar
- Verify changed files show
- Stage a file, verify it moves to Staged
- Enter a commit message and commit

- [ ] **Step 6: Note issues and commit fixes**

```bash
git add -A
git commit -m "fix: address issues found during E2E testing"
```
