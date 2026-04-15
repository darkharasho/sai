# Plugins & MCP Sidebars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Plugins and MCP sidebar panels to SAI for discovering, installing, and managing Claude Code plugins and MCP servers.

**Architecture:** Two new NavBar buttons (Plugins, MCP) each open a dedicated sidebar. Each sidebar has Installed/Browse tabs with search, list view with cards, and a detail view that replaces the list. Data flows through Electron IPC — CLI calls for plugins, direct file I/O for MCP config, and HTTP fetches for registry browsing.

**Tech Stack:** React 19, TypeScript 5.7, Electron 36, lucide-react icons, inline CSS with CSS custom properties, Vitest + Testing Library for tests.

---

## File Structure

```
src/components/
├── Plugins/
│   ├── PluginsSidebar.tsx      # List view: tabs, search, plugin cards, detail view
│   └── PluginDetail.tsx        # Detail view: info, skills, enable/disable, uninstall
├── MCP/
│   ├── McpSidebar.tsx          # List view: tabs, search, +Add, server cards
│   ├── McpDetail.tsx           # Detail view: tools, config, connection status, actions
│   └── McpAddServer.tsx        # Add custom server form

src/components/NavBar.tsx       # Add Plugins + MCP buttons
src/App.tsx                     # Add sidebar rendering for 'plugins' and 'mcp'
src/types.ts                    # Add Plugin, McpServer, McpTool types
electron/preload.ts             # Expose new IPC methods
electron/main.ts                # Register new service handlers
electron/services/plugins.ts    # Plugin CLI + registry IPC handlers
electron/services/mcp.ts        # MCP config + registry IPC handlers

tests/unit/components/NavBar.test.tsx                # Update with new buttons
tests/unit/components/Plugins/PluginsSidebar.test.tsx # New
tests/unit/components/MCP/McpSidebar.test.tsx         # New
tests/unit/services/plugins.test.ts                   # New
tests/unit/services/mcp.test.ts                       # New
```

---

### Task 1: Add types to types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add Plugin and MCP type definitions**

Add at the end of `src/types.ts`, before the `declare global` block:

```typescript
export interface Plugin {
  name: string;
  description: string;
  version: string;
  source: string;
  enabled: boolean;
  skills: string[];
  icon?: string;
}

export interface RegistryPlugin {
  name: string;
  description: string;
  version: string;
  source: string;
  skills: string[];
  installed: boolean;
}

export interface McpServer {
  name: string;
  description?: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  parameters?: string;
}

export interface RegistryMcpServer {
  name: string;
  description: string;
  source: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  installed: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to the new types.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Plugin and MCP type definitions"
```

---

### Task 2: Add Plugins IPC service

**Files:**
- Create: `electron/services/plugins.ts`
- Test: `tests/unit/services/plugins.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/services/plugins.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { ipcMain } from 'electron';
import { registerPluginHandlers } from '../../electron/services/plugins';

describe('plugins service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all expected IPC handlers', () => {
    registerPluginHandlers();
    const handle = ipcMain.handle as ReturnType<typeof vi.fn>;
    const channels = handle.mock.calls.map((c: any[]) => c[0]);
    expect(channels).toContain('plugins:list');
    expect(channels).toContain('plugins:install');
    expect(channels).toContain('plugins:uninstall');
    expect(channels).toContain('plugins:registryList');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/plugins.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the plugins service**

Create `electron/services/plugins.ts`:

```typescript
import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const execFileAsync = promisify(execFile);

function findClaude(): string {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.volta', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    'claude',
  ];
  for (const c of candidates) {
    try {
      if (c === 'claude' || fs.existsSync(c)) return c;
    } catch { /* skip */ }
  }
  return 'claude';
}

interface PluginInfo {
  name: string;
  description: string;
  version: string;
  source: string;
  enabled: boolean;
  skills: string[];
  icon?: string;
}

async function runClaude(args: string[]): Promise<string> {
  const claude = findClaude();
  const { stdout } = await execFileAsync(claude, args, { timeout: 30000 });
  return stdout.trim();
}

export function registerPluginHandlers() {
  ipcMain.handle('plugins:list', async () => {
    try {
      const output = await runClaude(['plugins', 'list', '--json']);
      return JSON.parse(output) as PluginInfo[];
    } catch (err: any) {
      return { error: err.message || 'Failed to list plugins' };
    }
  });

  ipcMain.handle('plugins:install', async (_event, name: string) => {
    try {
      await runClaude(['plugins', 'install', name]);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to install plugin' };
    }
  });

  ipcMain.handle('plugins:uninstall', async (_event, name: string) => {
    try {
      await runClaude(['plugins', 'uninstall', name]);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to uninstall plugin' };
    }
  });

  ipcMain.handle('plugins:registryList', async () => {
    try {
      const res = await fetch('https://api.github.com/repos/anthropics/claude-code-plugins/contents');
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const entries = await res.json() as { name: string; type: string }[];
      const dirs = entries.filter(e => e.type === 'dir' && !e.name.startsWith('.'));

      const plugins = await Promise.all(dirs.map(async (dir) => {
        try {
          const pkgRes = await fetch(`https://raw.githubusercontent.com/anthropics/claude-code-plugins/main/${dir.name}/package.json`);
          if (!pkgRes.ok) return null;
          const pkg = await pkgRes.json() as Record<string, any>;
          return {
            name: dir.name,
            description: pkg.description || '',
            version: pkg.version || '0.0.0',
            source: 'anthropics/claude-code-plugins',
            skills: [],
            installed: false,
          };
        } catch {
          return null;
        }
      }));

      return plugins.filter(Boolean);
    } catch (err: any) {
      return { error: err.message || 'Failed to fetch registry' };
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/plugins.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/plugins.ts tests/unit/services/plugins.test.ts
git commit -m "feat: add plugins IPC service with CLI and registry handlers"
```

---

### Task 3: Add MCP IPC service

**Files:**
- Create: `electron/services/mcp.ts`
- Test: `tests/unit/services/mcp.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/services/mcp.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { ipcMain } from 'electron';
import { registerMcpHandlers } from '../../electron/services/mcp';

describe('mcp service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all expected IPC handlers', () => {
    registerMcpHandlers();
    const handle = ipcMain.handle as ReturnType<typeof vi.fn>;
    const channels = handle.mock.calls.map((c: any[]) => c[0]);
    expect(channels).toContain('mcp:list');
    expect(channels).toContain('mcp:add');
    expect(channels).toContain('mcp:remove');
    expect(channels).toContain('mcp:update');
    expect(channels).toContain('mcp:registryList');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/mcp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the MCP service**

Create `electron/services/mcp.ts`:

```typescript
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface McpConfigEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpConfigEntry>;
}

function getConfigPath(): string {
  return path.join(os.homedir(), '.claude', 'mcp.json');
}

function readConfig(): McpConfigFile {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* return empty */ }
  return { mcpServers: {} };
}

function writeConfig(config: McpConfigFile): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function detectTransport(entry: McpConfigEntry): 'stdio' | 'sse' | 'streamable-http' {
  if (entry.url) {
    return entry.url.includes('/sse') ? 'sse' : 'streamable-http';
  }
  return 'stdio';
}

export function registerMcpHandlers() {
  ipcMain.handle('mcp:list', async () => {
    try {
      const config = readConfig();
      const servers = config.mcpServers || {};
      return Object.entries(servers).map(([name, entry]) => ({
        name,
        transport: detectTransport(entry),
        command: entry.command,
        args: entry.args,
        url: entry.url,
        env: entry.env,
        enabled: !entry.disabled,
      }));
    } catch (err: any) {
      return { error: err.message || 'Failed to read MCP config' };
    }
  });

  ipcMain.handle('mcp:add', async (_event, config: {
    name: string;
    transport: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }) => {
    try {
      const file = readConfig();
      if (!file.mcpServers) file.mcpServers = {};

      const entry: McpConfigEntry = {};
      if (config.transport === 'stdio') {
        entry.command = config.command;
        if (config.args?.length) entry.args = config.args;
      } else {
        entry.url = config.url;
      }
      if (config.env && Object.keys(config.env).length > 0) {
        entry.env = config.env;
      }

      file.mcpServers[config.name] = entry;
      writeConfig(file);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to add MCP server' };
    }
  });

  ipcMain.handle('mcp:remove', async (_event, name: string) => {
    try {
      const file = readConfig();
      if (file.mcpServers) {
        delete file.mcpServers[name];
        writeConfig(file);
      }
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to remove MCP server' };
    }
  });

  ipcMain.handle('mcp:update', async (_event, name: string, updates: Partial<McpConfigEntry & { disabled?: boolean }>) => {
    try {
      const file = readConfig();
      if (!file.mcpServers?.[name]) {
        return { error: `Server "${name}" not found` };
      }
      Object.assign(file.mcpServers[name], updates);
      writeConfig(file);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to update MCP server' };
    }
  });

  ipcMain.handle('mcp:registryList', async () => {
    try {
      const res = await fetch('https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md');
      if (!res.ok) throw new Error(`Registry fetch error: ${res.status}`);
      const text = await res.text();

      const servers: { name: string; description: string; source: string; transport: 'stdio'; installed: boolean }[] = [];
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)/g;
      let match;
      while ((match = linkRegex.exec(text)) !== null) {
        servers.push({
          name: match[1].trim().toLowerCase().replace(/\s+/g, '-'),
          description: match[3].trim(),
          source: match[2].trim(),
          transport: 'stdio',
          installed: false,
        });
      }

      const config = readConfig();
      const installed = new Set(Object.keys(config.mcpServers || {}));
      for (const s of servers) {
        s.installed = installed.has(s.name);
      }

      return servers;
    } catch (err: any) {
      return { error: err.message || 'Failed to fetch MCP registry' };
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/mcp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/mcp.ts tests/unit/services/mcp.test.ts
git commit -m "feat: add MCP IPC service with config management and registry"
```

---

### Task 4: Register services and expose IPC bridge

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Register handlers in main.ts**

In `electron/main.ts`, add imports at the top (after the existing service imports around line 15):

```typescript
import { registerPluginHandlers } from './services/plugins';
import { registerMcpHandlers } from './services/mcp';
```

Add registration calls after line 134 (`registerFsHandlers(mainWindow!);`):

```typescript
  registerPluginHandlers();
  registerMcpHandlers();
```

- [ ] **Step 2: Expose IPC methods in preload.ts**

In `electron/preload.ts`, add the following methods inside the `contextBridge.exposeInMainWorld('sai', {` block, before the closing `});`:

```typescript
  // Plugins
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsInstall: (name: string) => ipcRenderer.invoke('plugins:install', name),
  pluginsUninstall: (name: string) => ipcRenderer.invoke('plugins:uninstall', name),
  pluginsRegistryList: () => ipcRenderer.invoke('plugins:registryList'),
  // MCP
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpAdd: (config: any) => ipcRenderer.invoke('mcp:add', config),
  mcpRemove: (name: string) => ipcRenderer.invoke('mcp:remove', name),
  mcpUpdate: (name: string, updates: any) => ipcRenderer.invoke('mcp:update', name, updates),
  mcpRegistryList: () => ipcRenderer.invoke('mcp:registryList'),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: register plugin and MCP services, expose IPC bridge"
```

---

### Task 5: Add Plugins and MCP buttons to NavBar

**Files:**
- Modify: `src/components/NavBar.tsx`
- Modify: `tests/unit/components/NavBar.test.tsx`

- [ ] **Step 1: Update NavBar test with new button expectations**

Add these tests to the end of the `describe('NavBar', ...)` block in `tests/unit/components/NavBar.test.tsx`:

```typescript
  it('renders plugins toggle button', () => {
    const { container } = render(<NavBar activeSidebar={null} onToggle={vi.fn()} />);
    expect(getNavButton(container, 'Plugins')).toBeTruthy();
  });

  it('calls onToggle with "plugins" when plugins button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<NavBar activeSidebar={null} onToggle={onToggle} />);
    fireEvent.click(getNavButton(container, 'Plugins'));
    expect(onToggle).toHaveBeenCalledWith('plugins');
  });

  it('adds active class to plugins button when activeSidebar is "plugins"', () => {
    const { container } = render(<NavBar activeSidebar="plugins" onToggle={vi.fn()} />);
    const pluginsBtn = getNavButton(container, 'Plugins');
    expect(pluginsBtn.className).toContain('active');
  });

  it('renders mcp toggle button', () => {
    const { container } = render(<NavBar activeSidebar={null} onToggle={vi.fn()} />);
    expect(getNavButton(container, 'MCP Servers')).toBeTruthy();
  });

  it('calls onToggle with "mcp" when mcp button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<NavBar activeSidebar={null} onToggle={onToggle} />);
    fireEvent.click(getNavButton(container, 'MCP Servers'));
    expect(onToggle).toHaveBeenCalledWith('mcp');
  });

  it('adds active class to mcp button when activeSidebar is "mcp"', () => {
    const { container } = render(<NavBar activeSidebar="mcp" onToggle={vi.fn()} />);
    const mcpBtn = getNavButton(container, 'MCP Servers');
    expect(mcpBtn.className).toContain('active');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/NavBar.test.tsx`
Expected: FAIL — buttons not found.

- [ ] **Step 3: Update NavBar.tsx**

Replace the contents of `src/components/NavBar.tsx` with:

```tsx
import { FolderClosed, GitBranch, Clock, Puzzle, Server } from 'lucide-react';

interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
  gitChangeCount?: number;
}

export default function NavBar({ activeSidebar, onToggle, gitChangeCount = 0 }: NavBarProps) {
  const badgeLabel = gitChangeCount > 100 ? '99+' : `${gitChangeCount}`;

  return (
    <div className="navbar">
      <button
        className={`nav-btn ${activeSidebar === 'files' ? 'active' : ''}`}
        onClick={() => onToggle('files')}
        title="Explorer"
      >
        <FolderClosed size={18} />
        <span className="nav-label">Files</span>
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''}`}
        onClick={() => onToggle('git')}
        title="Source Control"
      >
        <GitBranch size={18} />
        <span className="nav-label">Git</span>
        {gitChangeCount > 0 && <span className="git-badge">{badgeLabel}</span>}
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'chats' ? 'active' : ''}`}
        onClick={() => onToggle('chats')}
        title="Chat History"
      >
        <Clock size={18} />
        <span className="nav-label">Chats</span>
      </button>
      <div className="nav-divider" />
      <button
        className={`nav-btn ${activeSidebar === 'plugins' ? 'active' : ''}`}
        onClick={() => onToggle('plugins')}
        title="Plugins"
      >
        <Puzzle size={18} />
        <span className="nav-label">Plugins</span>
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'mcp' ? 'active' : ''}`}
        onClick={() => onToggle('mcp')}
        title="MCP Servers"
      >
        <Server size={18} />
        <span className="nav-label">MCP</span>
      </button>
      <style>{`
        .navbar {
          width: var(--nav-width);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 8px;
          gap: 2px;
          border-right: 1px solid var(--border);
          flex-shrink: 0;
        }
        .nav-btn {
          width: 42px;
          height: 44px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: 8px;
          position: relative;
          transition: color 0.15s, background 0.15s;
        }
        .nav-label {
          font-size: 8px;
          font-weight: 500;
          font-family: 'Geist', sans-serif;
          letter-spacing: 0.3px;
          line-height: 1;
        }
        .git-badge {
          position: absolute;
          top: 2px;
          right: 0px;
          background: var(--accent);
          color: #000;
          font-size: 9px;
          font-weight: 700;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          min-width: 16px;
          height: 16px;
          line-height: 16px;
          text-align: center;
          border-radius: 8px;
          padding: 0 3px;
        }
        .nav-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .nav-btn.active {
          color: var(--accent);
          background: rgba(199, 145, 12, 0.08);
          border-left: 2px solid var(--accent);
          border-radius: 0 8px 8px 0;
        }
        .nav-divider {
          width: 24px;
          height: 1px;
          background: var(--border);
          margin: 4px 0;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/NavBar.test.tsx`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/NavBar.tsx tests/unit/components/NavBar.test.tsx
git commit -m "feat: add Plugins and MCP buttons to NavBar"
```

---

### Task 6: Create PluginDetail component

**Files:**
- Create: `src/components/Plugins/PluginDetail.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/Plugins/PluginDetail.tsx`:

```tsx
import { Trash2 } from 'lucide-react';
import type { Plugin } from '../../types';

interface PluginDetailProps {
  plugin: Plugin;
  onBack: () => void;
  onUninstall: (name: string) => void;
  onToggleEnabled: (name: string, enabled: boolean) => void;
}

export default function PluginDetail({ plugin, onBack, onUninstall, onToggleEnabled }: PluginDetailProps) {
  return (
    <div className="plugin-detail">
      <button className="detail-back" onClick={onBack}>
        <span>←</span> Back to plugins
      </button>

      <div className="detail-header">
        <div className="detail-icon">{plugin.icon || '🧩'}</div>
        <div>
          <div className="detail-name">{plugin.name}</div>
          <div className="detail-source">{plugin.source}</div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="detail-btn danger" onClick={() => onUninstall(plugin.name)}>
          <Trash2 size={12} /> Uninstall
        </button>
        <button
          className="detail-btn toggle"
          onClick={() => onToggleEnabled(plugin.name, !plugin.enabled)}
        >
          <span className={`status-dot ${plugin.enabled ? 'active' : 'inactive'}`} />
          {plugin.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div className="detail-section">
        <div className="detail-label">Description</div>
        <div className="detail-text">{plugin.description}</div>
      </div>

      <div className="detail-section">
        <div className="detail-label">Version</div>
        <div className="detail-text">{plugin.version}</div>
      </div>

      {plugin.skills.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Skills ({plugin.skills.length})</div>
          <div className="detail-skills">
            {plugin.skills.map(skill => (
              <span key={skill} className="skill-chip">{skill}</span>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .plugin-detail {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          overflow-y: auto;
          flex-shrink: 0;
        }
        .detail-back {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border: none;
          border-bottom: 1px solid var(--border);
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          width: 100%;
        }
        .detail-back:hover { color: var(--text); }
        .detail-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }
        .detail-icon {
          width: 36px;
          height: 36px;
          background: var(--bg-hover);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }
        .detail-name { font-weight: 700; font-size: 14px; }
        .detail-source { font-size: 10px; color: var(--text-muted); }
        .detail-actions {
          display: flex;
          gap: 6px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }
        .detail-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border: none;
          border-radius: 4px;
          font-size: 10px;
          cursor: pointer;
          font-weight: 600;
        }
        .detail-btn.danger { background: var(--red); color: #fff; }
        .detail-btn.danger:hover { opacity: 0.9; }
        .detail-btn.toggle { background: var(--bg-hover); color: var(--accent); }
        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          display: inline-block;
        }
        .status-dot.active { background: var(--green); }
        .status-dot.inactive { background: var(--red); }
        .detail-section { padding: 12px; }
        .detail-label {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 4px;
          font-weight: 600;
        }
        .detail-text { font-size: 11px; line-height: 1.5; color: var(--text-secondary); }
        .detail-skills { display: flex; flex-wrap: wrap; gap: 4px; }
        .skill-chip {
          padding: 3px 8px;
          background: var(--bg-input);
          border-radius: 4px;
          font-size: 11px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Plugins/PluginDetail.tsx
git commit -m "feat: add PluginDetail component"
```

---

### Task 7: Create PluginsSidebar component

**Files:**
- Create: `src/components/Plugins/PluginsSidebar.tsx`
- Create: `tests/unit/components/Plugins/PluginsSidebar.test.tsx`

- [ ] **Step 1: Write the test file**

Create `tests/unit/components/Plugins/PluginsSidebar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Mock window.sai
const mockSai = {
  pluginsList: vi.fn().mockResolvedValue([]),
  pluginsRegistryList: vi.fn().mockResolvedValue([]),
  pluginsInstall: vi.fn().mockResolvedValue({ success: true }),
  pluginsUninstall: vi.fn().mockResolvedValue({ success: true }),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

import PluginsSidebar from '../../../../src/components/Plugins/PluginsSidebar';

describe('PluginsSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<PluginsSidebar />);
    expect(container.querySelector('.plugins-sidebar')).toBeTruthy();
  });

  it('renders Installed and Browse tabs', () => {
    const { getByText } = render(<PluginsSidebar />);
    expect(getByText('Installed')).toBeTruthy();
    expect(getByText('Browse')).toBeTruthy();
  });

  it('renders search input', () => {
    const { container } = render(<PluginsSidebar />);
    expect(container.querySelector('.sidebar-search')).toBeTruthy();
  });

  it('shows installed plugins after loading', async () => {
    mockSai.pluginsList.mockResolvedValue([
      { name: 'github', description: 'GitHub integration', version: '1.0.0', source: 'test', enabled: true, skills: [] },
    ]);
    const { getByText } = render(<PluginsSidebar />);
    await waitFor(() => {
      expect(getByText('github')).toBeTruthy();
    });
  });

  it('switches to Browse tab on click', async () => {
    const { getByText } = render(<PluginsSidebar />);
    fireEvent.click(getByText('Browse'));
    await waitFor(() => {
      expect(mockSai.pluginsRegistryList).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/Plugins/PluginsSidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the PluginsSidebar component**

Create `src/components/Plugins/PluginsSidebar.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react';
import { Search } from 'lucide-react';
import PluginDetail from './PluginDetail';
import type { Plugin, RegistryPlugin } from '../../types';

type Tab = 'installed' | 'browse';

export default function PluginsSidebar() {
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [installed, setInstalled] = useState<Plugin[]>([]);
  const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);

  const loadInstalled = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.sai.pluginsList();
      if (result && !('error' in result)) {
        setInstalled(result);
      } else {
        setError(result?.error || 'Failed to load plugins');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load plugins');
    }
    setLoading(false);
  };

  const loadRegistry = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.sai.pluginsRegistryList();
      if (result && !('error' in result)) {
        setRegistry(result);
      } else {
        setError(result?.error || 'Failed to load registry');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load registry');
    }
    setLoading(false);
  };

  useEffect(() => { loadInstalled(); }, []);

  useEffect(() => {
    if (tab === 'browse' && registry.length === 0) {
      loadRegistry();
    }
  }, [tab]);

  const handleInstall = async (name: string) => {
    await window.sai.pluginsInstall(name);
    loadInstalled();
    loadRegistry();
  };

  const handleUninstall = async (name: string) => {
    await window.sai.pluginsUninstall(name);
    setSelectedPlugin(null);
    loadInstalled();
  };

  const handleToggleEnabled = async (_name: string, _enabled: boolean) => {
    // Toggle is managed by CLI — reload list after toggling
    loadInstalled();
  };

  const query = search.toLowerCase();

  const filteredInstalled = useMemo(
    () => installed.filter(p =>
      p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
    ),
    [installed, query]
  );

  const filteredRegistry = useMemo(
    () => registry.filter(p =>
      p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
    ),
    [registry, query]
  );

  if (selectedPlugin) {
    return (
      <PluginDetail
        plugin={selectedPlugin}
        onBack={() => setSelectedPlugin(null)}
        onUninstall={handleUninstall}
        onToggleEnabled={handleToggleEnabled}
      />
    );
  }

  return (
    <div className="plugins-sidebar">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${tab === 'installed' ? 'active' : ''}`}
          onClick={() => setTab('installed')}
        >
          Installed
        </button>
        <button
          className={`sidebar-tab ${tab === 'browse' ? 'active' : ''}`}
          onClick={() => setTab('browse')}
        >
          Browse
        </button>
      </div>

      <div className="sidebar-search-wrap">
        <Search size={12} className="sidebar-search-icon" />
        <input
          className="sidebar-search"
          placeholder={tab === 'installed' ? 'Search installed...' : 'Search registry...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="sidebar-list">
        {loading && <div className="sidebar-empty">Loading...</div>}
        {error && (
          <div className="sidebar-error">
            <div>{error}</div>
            <button className="retry-btn" onClick={tab === 'installed' ? loadInstalled : loadRegistry}>Retry</button>
          </div>
        )}

        {!loading && !error && tab === 'installed' && filteredInstalled.map(plugin => (
          <div
            key={plugin.name}
            className="sidebar-card"
            onClick={() => setSelectedPlugin(plugin)}
          >
            <div className="card-icon">{plugin.icon || '🧩'}</div>
            <div className="card-info">
              <div className="card-name">{plugin.name}</div>
              <div className="card-desc">{plugin.description}</div>
            </div>
            <div className="card-right">
              <span className={`status-dot ${plugin.enabled ? 'active' : 'inactive'}`} />
              <span className="card-chevron">›</span>
            </div>
          </div>
        ))}

        {!loading && !error && tab === 'installed' && filteredInstalled.length === 0 && (
          <div className="sidebar-empty">No plugins installed</div>
        )}

        {!loading && !error && tab === 'browse' && filteredRegistry.map(plugin => (
          <div key={plugin.name} className="sidebar-card">
            <div className="card-info">
              <div className="card-name">{plugin.name}</div>
              <div className="card-desc">{plugin.description}</div>
            </div>
            <div className="card-right">
              {plugin.installed ? (
                <span className="card-installed">Installed</span>
              ) : (
                <button className="card-install-btn" onClick={() => handleInstall(plugin.name)}>Install</button>
              )}
            </div>
          </div>
        ))}

        {!loading && !error && tab === 'browse' && filteredRegistry.length === 0 && (
          <div className="sidebar-empty">No plugins found</div>
        )}
      </div>

      <style>{`
        .plugins-sidebar {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex-shrink: 0;
        }
        .sidebar-tabs {
          display: flex;
          border-bottom: 1px solid var(--border);
        }
        .sidebar-tab {
          flex: 1;
          padding: 9px 12px;
          text-align: center;
          font-size: 11px;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: color 0.15s;
        }
        .sidebar-tab.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
          font-weight: 600;
        }
        .sidebar-tab:hover { color: var(--text); }
        .sidebar-search-wrap {
          position: relative;
          padding: 8px;
        }
        .sidebar-search-icon {
          position: absolute;
          left: 18px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
        }
        .sidebar-search {
          width: 100%;
          padding: 6px 10px 6px 28px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text);
          font-size: 11px;
          outline: none;
          font-family: inherit;
        }
        .sidebar-search:focus { border-color: var(--accent); }
        .sidebar-list {
          flex: 1;
          overflow-y: auto;
          padding: 0 8px 8px;
        }
        .sidebar-card {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px;
          background: var(--bg-input);
          border-radius: 6px;
          margin-bottom: 4px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .sidebar-card:hover { background: var(--bg-hover); }
        .card-icon {
          width: 28px;
          height: 28px;
          background: var(--bg-hover);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .card-info { flex: 1; min-width: 0; }
        .card-name {
          font-weight: 600;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .card-desc {
          font-size: 10px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .card-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .status-dot.active { background: var(--green); }
        .status-dot.inactive { background: var(--red); }
        .card-chevron { color: var(--text-muted); font-size: 10px; }
        .card-install-btn {
          padding: 2px 8px;
          background: var(--bg-hover);
          border: none;
          border-radius: 4px;
          font-size: 10px;
          color: var(--accent);
          cursor: pointer;
        }
        .card-install-btn:hover { background: var(--border); }
        .card-installed { font-size: 10px; color: var(--text-muted); }
        .sidebar-empty {
          text-align: center;
          padding: 24px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .sidebar-error {
          text-align: center;
          padding: 16px;
          color: var(--red);
          font-size: 11px;
        }
        .retry-btn {
          margin-top: 8px;
          padding: 4px 12px;
          background: var(--bg-hover);
          border: none;
          border-radius: 4px;
          color: var(--accent);
          cursor: pointer;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/Plugins/PluginsSidebar.test.tsx`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Plugins/PluginsSidebar.tsx tests/unit/components/Plugins/PluginsSidebar.test.tsx
git commit -m "feat: add PluginsSidebar component with tabs, search, and list view"
```

---

### Task 8: Create McpAddServer component

**Files:**
- Create: `src/components/MCP/McpAddServer.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/MCP/McpAddServer.tsx`:

```tsx
import { useState } from 'react';

type Transport = 'stdio' | 'sse' | 'streamable-http';

interface McpAddServerProps {
  onBack: () => void;
  onAdd: (config: {
    name: string;
    transport: Transport;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }) => void;
}

export default function McpAddServer({ onBack, onAdd }: McpAddServerProps) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<Transport>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleEnvChange = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...envVars];
    updated[index][field] = val;
    setEnvVars(updated);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!name.trim()) return;

    const env: Record<string, string> = {};
    for (const v of envVars) {
      if (v.key.trim()) env[v.key.trim()] = v.value;
    }

    onAdd({
      name: name.trim(),
      transport,
      ...(transport === 'stdio' ? {
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : undefined,
      } : {
        url: url.trim(),
      }),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    });
  };

  const isValid = name.trim() && (transport === 'stdio' ? command.trim() : url.trim());

  return (
    <div className="mcp-add-server">
      <button className="detail-back" onClick={onBack}>
        <span>←</span> Back to servers
      </button>

      <div className="add-form">
        <div className="add-title">Add MCP Server</div>

        <div className="form-field">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="my-server"
          />
        </div>

        <div className="form-field">
          <label className="form-label">Transport</label>
          <div className="transport-toggle">
            {(['stdio', 'sse', 'streamable-http'] as Transport[]).map(t => (
              <button
                key={t}
                className={`transport-btn ${transport === t ? 'active' : ''}`}
                onClick={() => setTransport(t)}
              >
                {t === 'streamable-http' ? 'HTTP' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {transport === 'stdio' ? (
          <>
            <div className="form-field">
              <label className="form-label">Command</label>
              <input
                className="form-input mono"
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="npx -y @my/server"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Arguments <span className="form-optional">(optional)</span></label>
              <input
                className="form-input mono"
                value={args}
                onChange={e => setArgs(e.target.value)}
                placeholder="--port 3000"
              />
            </div>
          </>
        ) : (
          <div className="form-field">
            <label className="form-label">URL</label>
            <input
              className="form-input mono"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="http://localhost:3000/sse"
            />
          </div>
        )}

        <div className="form-field">
          <label className="form-label">Environment Variables <span className="form-optional">(optional)</span></label>
          {envVars.map((v, i) => (
            <div key={i} className="env-row">
              <input
                className="form-input mono env-key"
                value={v.key}
                onChange={e => handleEnvChange(i, 'key', e.target.value)}
                placeholder="KEY"
              />
              <span className="env-eq">=</span>
              <input
                className="form-input mono env-val"
                value={v.value}
                onChange={e => handleEnvChange(i, 'value', e.target.value)}
                placeholder="value"
              />
              <button className="env-remove" onClick={() => handleRemoveEnvVar(i)}>×</button>
            </div>
          ))}
          <button className="add-env-btn" onClick={handleAddEnvVar}>+ Add variable</button>
        </div>

        <button
          className={`submit-btn ${isValid ? '' : 'disabled'}`}
          onClick={handleSubmit}
          disabled={!isValid}
        >
          Add Server
        </button>
      </div>

      <style>{`
        .mcp-add-server {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          overflow-y: auto;
          flex-shrink: 0;
        }
        .detail-back {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border: none;
          border-bottom: 1px solid var(--border);
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          width: 100%;
        }
        .detail-back:hover { color: var(--text); }
        .add-form { padding: 12px; }
        .add-title { font-weight: 700; font-size: 14px; margin-bottom: 12px; }
        .form-field { margin-bottom: 10px; }
        .form-label {
          display: block;
          font-size: 10px;
          color: var(--text-muted);
          margin-bottom: 4px;
          font-weight: 600;
        }
        .form-optional { color: var(--border); }
        .form-input {
          width: 100%;
          padding: 6px 10px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text);
          font-size: 11px;
          outline: none;
          font-family: inherit;
        }
        .form-input.mono { font-family: 'Geist Mono', monospace; }
        .form-input:focus { border-color: var(--accent); }
        .transport-toggle { display: flex; gap: 4px; }
        .transport-btn {
          padding: 4px 10px;
          background: var(--bg-hover);
          border: none;
          border-radius: 4px;
          font-size: 10px;
          color: var(--text-muted);
          cursor: pointer;
        }
        .transport-btn.active {
          background: var(--accent);
          color: #000;
          font-weight: 600;
        }
        .env-row {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 4px;
        }
        .env-key { flex: 2; }
        .env-eq { color: var(--text-muted); font-size: 11px; }
        .env-val { flex: 3; }
        .env-remove {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          padding: 0 4px;
        }
        .env-remove:hover { color: var(--red); }
        .add-env-btn {
          background: none;
          border: none;
          color: var(--accent);
          cursor: pointer;
          font-size: 10px;
          padding: 4px 0;
        }
        .submit-btn {
          width: 100%;
          padding: 8px;
          background: var(--accent);
          color: #000;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 12px;
          margin-top: 4px;
        }
        .submit-btn.disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .submit-btn:hover:not(.disabled) { background: var(--accent-hover); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MCP/McpAddServer.tsx
git commit -m "feat: add McpAddServer form component"
```

---

### Task 9: Create McpDetail component

**Files:**
- Create: `src/components/MCP/McpDetail.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/MCP/McpDetail.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { McpServer, McpTool } from '../../types';

interface McpDetailProps {
  server: McpServer;
  onBack: () => void;
  onRemove: (name: string) => void;
  onToggleEnabled: (name: string, enabled: boolean) => void;
  onRestart: (name: string) => void;
}

export default function McpDetail({ server, onBack, onRemove, onToggleEnabled, onRestart }: McpDetailProps) {
  const [tools, setTools] = useState<McpTool[]>([]);

  useEffect(() => {
    if (window.sai.mcpGetTools) {
      window.sai.mcpGetTools(server.name)
        .then((result: McpTool[]) => {
          if (Array.isArray(result)) setTools(result);
        })
        .catch(() => {});
    }
  }, [server.name]);

  const maskedEnv = server.env
    ? Object.fromEntries(
        Object.entries(server.env).map(([k, v]) => [k, v.length > 4 ? v.slice(0, 2) + '•••' : '•••'])
      )
    : null;

  return (
    <div className="mcp-detail">
      <button className="detail-back" onClick={onBack}>
        <span>←</span> Back to servers
      </button>

      <div className="detail-header">
        <div className="detail-icon">🔌</div>
        <div>
          <div className="detail-name">{server.name}</div>
          <div className={`detail-status ${server.enabled ? 'connected' : 'disconnected'}`}>
            <span className="status-dot-lg" /> {server.enabled ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="detail-btn restart" onClick={() => onRestart(server.name)}>
          <RotateCcw size={12} /> Restart
        </button>
        <button
          className="detail-btn toggle"
          onClick={() => onToggleEnabled(server.name, !server.enabled)}
        >
          {server.enabled ? 'Disable' : 'Enable'}
        </button>
        <button className="detail-btn danger" onClick={() => onRemove(server.name)}>
          <Trash2 size={12} /> Remove
        </button>
      </div>

      {tools.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Available Tools ({tools.length})</div>
          {tools.map(tool => (
            <div key={tool.name} className="tool-row">
              <span className="tool-name">{tool.name}</span>
              {tool.parameters && <span className="tool-param">{tool.parameters}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="detail-section">
        <div className="detail-label">Configuration</div>
        <div className="config-block">
          {server.command && <div><span className="config-key">"command":</span> "{server.command}"</div>}
          {server.args && <div><span className="config-key">"args":</span> {JSON.stringify(server.args)}</div>}
          {server.url && <div><span className="config-key">"url":</span> "{server.url}"</div>}
          {maskedEnv && (
            <div>
              <span className="config-key">"env":</span> {JSON.stringify(maskedEnv).replace(/"/g, '')}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .mcp-detail {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          overflow-y: auto;
          flex-shrink: 0;
        }
        .detail-back {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border: none;
          border-bottom: 1px solid var(--border);
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          width: 100%;
        }
        .detail-back:hover { color: var(--text); }
        .detail-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }
        .detail-icon {
          width: 36px;
          height: 36px;
          background: var(--bg-hover);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }
        .detail-name { font-weight: 700; font-size: 14px; }
        .detail-status { font-size: 10px; display: flex; align-items: center; gap: 4px; }
        .detail-status.connected { color: var(--green); }
        .detail-status.disconnected { color: var(--red); }
        .status-dot-lg {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }
        .detail-actions {
          display: flex;
          gap: 6px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }
        .detail-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border: none;
          border-radius: 4px;
          font-size: 10px;
          cursor: pointer;
        }
        .detail-btn.restart { background: var(--bg-hover); color: var(--accent); }
        .detail-btn.toggle { background: var(--bg-hover); color: var(--text-muted); }
        .detail-btn.danger { background: var(--red); color: #fff; }
        .detail-section { padding: 12px; }
        .detail-label {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 6px;
          font-weight: 600;
        }
        .tool-row {
          padding: 6px 10px;
          background: var(--bg-input);
          border-radius: 4px;
          margin-bottom: 3px;
          display: flex;
          justify-content: space-between;
        }
        .tool-name {
          font-family: 'Geist Mono', monospace;
          font-size: 11px;
        }
        .tool-param {
          font-size: 10px;
          color: var(--text-muted);
        }
        .config-block {
          padding: 8px 10px;
          background: var(--bg-input);
          border-radius: 6px;
          font-family: 'Geist Mono', monospace;
          font-size: 10px;
          color: var(--text-secondary);
          line-height: 1.6;
          border: 1px solid var(--border);
        }
        .config-key { color: var(--text-muted); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MCP/McpDetail.tsx
git commit -m "feat: add McpDetail component with tools and config display"
```

---

### Task 10: Create McpSidebar component

**Files:**
- Create: `src/components/MCP/McpSidebar.tsx`
- Create: `tests/unit/components/MCP/McpSidebar.test.tsx`

- [ ] **Step 1: Write the test file**

Create `tests/unit/components/MCP/McpSidebar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mockSai = {
  mcpList: vi.fn().mockResolvedValue([]),
  mcpRegistryList: vi.fn().mockResolvedValue([]),
  mcpAdd: vi.fn().mockResolvedValue({ success: true }),
  mcpRemove: vi.fn().mockResolvedValue({ success: true }),
  mcpUpdate: vi.fn().mockResolvedValue({ success: true }),
  mcpGetTools: vi.fn().mockResolvedValue([]),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

import McpSidebar from '../../../../src/components/MCP/McpSidebar';

describe('McpSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<McpSidebar />);
    expect(container.querySelector('.mcp-sidebar')).toBeTruthy();
  });

  it('renders Installed and Browse tabs', () => {
    const { getByText } = render(<McpSidebar />);
    expect(getByText('Installed')).toBeTruthy();
    expect(getByText('Browse')).toBeTruthy();
  });

  it('renders search input and Add button', () => {
    const { container, getByText } = render(<McpSidebar />);
    expect(container.querySelector('.sidebar-search')).toBeTruthy();
    expect(getByText('+ Add')).toBeTruthy();
  });

  it('shows installed servers after loading', async () => {
    mockSai.mcpList.mockResolvedValue([
      { name: 'brave-search', transport: 'stdio', command: 'npx', enabled: true },
    ]);
    const { getByText } = render(<McpSidebar />);
    await waitFor(() => {
      expect(getByText('brave-search')).toBeTruthy();
    });
  });

  it('shows add server form when Add button is clicked', () => {
    const { getByText } = render(<McpSidebar />);
    fireEvent.click(getByText('+ Add'));
    expect(getByText('Add MCP Server')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/MCP/McpSidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the McpSidebar component**

Create `src/components/MCP/McpSidebar.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react';
import { Search } from 'lucide-react';
import McpDetail from './McpDetail';
import McpAddServer from './McpAddServer';
import type { McpServer, McpServerConfig, RegistryMcpServer } from '../../types';

type Tab = 'installed' | 'browse';
type View = 'list' | 'detail' | 'add';

export default function McpSidebar() {
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [installed, setInstalled] = useState<McpServer[]>([]);
  const [registry, setRegistry] = useState<RegistryMcpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);

  const loadInstalled = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.sai.mcpList();
      if (result && !('error' in result)) {
        setInstalled(result);
      } else {
        setError(result?.error || 'Failed to load servers');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load servers');
    }
    setLoading(false);
  };

  const loadRegistry = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.sai.mcpRegistryList();
      if (result && !('error' in result)) {
        setRegistry(result);
      } else {
        setError(result?.error || 'Failed to load registry');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load registry');
    }
    setLoading(false);
  };

  useEffect(() => { loadInstalled(); }, []);

  useEffect(() => {
    if (tab === 'browse' && registry.length === 0) {
      loadRegistry();
    }
  }, [tab]);

  const handleAdd = async (config: McpServerConfig) => {
    await window.sai.mcpAdd(config);
    setView('list');
    loadInstalled();
  };

  const handleRemove = async (name: string) => {
    await window.sai.mcpRemove(name);
    setView('list');
    setSelectedServer(null);
    loadInstalled();
  };

  const handleToggleEnabled = async (name: string, enabled: boolean) => {
    await window.sai.mcpUpdate(name, { disabled: !enabled });
    loadInstalled();
  };

  const handleRestart = async (_name: string) => {
    // Restart is a session-level operation — reload to reflect any status change
    loadInstalled();
  };

  const query = search.toLowerCase();

  const filteredInstalled = useMemo(
    () => installed.filter(s =>
      s.name.toLowerCase().includes(query) ||
      (s.description?.toLowerCase().includes(query))
    ),
    [installed, query]
  );

  const filteredRegistry = useMemo(
    () => registry.filter(s =>
      s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query)
    ),
    [registry, query]
  );

  if (view === 'add') {
    return <McpAddServer onBack={() => setView('list')} onAdd={handleAdd} />;
  }

  if (view === 'detail' && selectedServer) {
    return (
      <McpDetail
        server={selectedServer}
        onBack={() => { setView('list'); setSelectedServer(null); }}
        onRemove={handleRemove}
        onToggleEnabled={handleToggleEnabled}
        onRestart={handleRestart}
      />
    );
  }

  return (
    <div className="mcp-sidebar">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${tab === 'installed' ? 'active' : ''}`}
          onClick={() => setTab('installed')}
        >
          Installed
        </button>
        <button
          className={`sidebar-tab ${tab === 'browse' ? 'active' : ''}`}
          onClick={() => setTab('browse')}
        >
          Browse
        </button>
      </div>

      <div className="sidebar-search-row">
        <div className="sidebar-search-wrap">
          <Search size={12} className="sidebar-search-icon" />
          <input
            className="sidebar-search"
            placeholder="Search servers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="add-btn" onClick={() => setView('add')}>+ Add</button>
      </div>

      <div className="sidebar-list">
        {loading && <div className="sidebar-empty">Loading...</div>}
        {error && (
          <div className="sidebar-error">
            <div>{error}</div>
            <button className="retry-btn" onClick={tab === 'installed' ? loadInstalled : loadRegistry}>Retry</button>
          </div>
        )}

        {!loading && !error && tab === 'installed' && filteredInstalled.map(server => (
          <div
            key={server.name}
            className="sidebar-card"
            onClick={() => { setSelectedServer(server); setView('detail'); }}
          >
            <div className="card-icon">🔌</div>
            <div className="card-info">
              <div className="card-name">{server.name}</div>
              <div className="card-desc">{server.description || server.transport}</div>
            </div>
            <div className="card-right">
              <span className={`status-dot ${server.enabled ? 'active' : 'inactive'}`} />
              <span className="card-chevron">›</span>
            </div>
          </div>
        ))}

        {!loading && !error && tab === 'installed' && filteredInstalled.length === 0 && (
          <div className="sidebar-empty">No MCP servers configured</div>
        )}

        {!loading && !error && tab === 'browse' && filteredRegistry.map(server => (
          <div key={server.name} className="sidebar-card">
            <div className="card-info">
              <div className="card-name">{server.name}</div>
              <div className="card-desc">{server.description}</div>
            </div>
            <div className="card-right">
              {server.installed ? (
                <span className="card-installed">Installed</span>
              ) : (
                <button className="card-install-btn" onClick={() => handleAdd({
                  name: server.name,
                  transport: server.transport,
                })}>Install</button>
              )}
            </div>
          </div>
        ))}

        {!loading && !error && tab === 'browse' && filteredRegistry.length === 0 && (
          <div className="sidebar-empty">No servers found</div>
        )}
      </div>

      <style>{`
        .mcp-sidebar {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex-shrink: 0;
        }
        .sidebar-tabs {
          display: flex;
          border-bottom: 1px solid var(--border);
        }
        .sidebar-tab {
          flex: 1;
          padding: 9px 12px;
          text-align: center;
          font-size: 11px;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: color 0.15s;
        }
        .sidebar-tab.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
          font-weight: 600;
        }
        .sidebar-tab:hover { color: var(--text); }
        .sidebar-search-row {
          display: flex;
          gap: 6px;
          padding: 8px;
        }
        .sidebar-search-wrap {
          position: relative;
          flex: 1;
        }
        .sidebar-search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
        }
        .sidebar-search {
          width: 100%;
          padding: 6px 10px 6px 28px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text);
          font-size: 11px;
          outline: none;
          font-family: inherit;
        }
        .sidebar-search:focus { border-color: var(--accent); }
        .add-btn {
          padding: 6px 10px;
          background: var(--bg-hover);
          border: none;
          border-radius: 6px;
          color: var(--accent);
          font-size: 11px;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
        }
        .add-btn:hover { background: var(--border); }
        .sidebar-list {
          flex: 1;
          overflow-y: auto;
          padding: 0 8px 8px;
        }
        .sidebar-card {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px;
          background: var(--bg-input);
          border-radius: 6px;
          margin-bottom: 4px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .sidebar-card:hover { background: var(--bg-hover); }
        .card-icon {
          width: 28px;
          height: 28px;
          background: var(--bg-hover);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .card-info { flex: 1; min-width: 0; }
        .card-name {
          font-weight: 600;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .card-desc {
          font-size: 10px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .card-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .status-dot.active { background: var(--green); }
        .status-dot.inactive { background: var(--red); }
        .card-chevron { color: var(--text-muted); font-size: 10px; }
        .card-install-btn {
          padding: 2px 8px;
          background: var(--bg-hover);
          border: none;
          border-radius: 4px;
          font-size: 10px;
          color: var(--accent);
          cursor: pointer;
        }
        .card-install-btn:hover { background: var(--border); }
        .card-installed { font-size: 10px; color: var(--text-muted); }
        .sidebar-empty {
          text-align: center;
          padding: 24px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .sidebar-error {
          text-align: center;
          padding: 16px;
          color: var(--red);
          font-size: 11px;
        }
        .retry-btn {
          margin-top: 8px;
          padding: 4px 12px;
          background: var(--bg-hover);
          border: none;
          border-radius: 4px;
          color: var(--accent);
          cursor: pointer;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/MCP/McpSidebar.test.tsx`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MCP/McpSidebar.tsx tests/unit/components/MCP/McpSidebar.test.tsx
git commit -m "feat: add McpSidebar component with tabs, search, add, and list view"
```

---

### Task 11: Wire sidebars into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/App.tsx`, add after the existing sidebar imports (around line 6):

```typescript
import PluginsSidebar from './components/Plugins/PluginsSidebar';
import McpSidebar from './components/MCP/McpSidebar';
```

- [ ] **Step 2: Add sidebar rendering**

In `src/App.tsx`, after line 1522 (the closing of the chats sidebar conditional), add:

```tsx
        {sidebarOpen === 'plugins' && <PluginsSidebar />}
        {sidebarOpen === 'mcp' && <McpSidebar />}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify the dev server starts and renders**

Run: `npm run dev`

Open the app. Verify:
- The NavBar shows 5 buttons: Files, Git, Chats, then a divider, then Plugins and MCP
- Clicking Plugins opens the Plugins sidebar with Installed/Browse tabs
- Clicking MCP opens the MCP sidebar with Installed/Browse tabs and + Add button
- Clicking + Add shows the Add MCP Server form
- All existing sidebar buttons still work

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire Plugins and MCP sidebars into App.tsx"
```

---

### Task 12: Final integration test in the browser

- [ ] **Step 1: Run `npm run dev` and test the full flow**

Test these scenarios:
1. Click Plugins button — sidebar opens, shows Installed tab (may be empty)
2. Click Browse tab — fetches and shows registry plugins
3. Search filters both tabs
4. Click a plugin card — detail view opens with back button
5. Click MCP button — sidebar opens, shows Installed tab
6. Click + Add — form appears with transport toggle, name, command/URL fields
7. Fill out form and click Add Server — returns to list with new server
8. Click a server card — detail view shows config and tools
9. All existing features (Files, Git, Chats, editor, terminal) still work

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 3: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "fix: address integration test findings for plugins and MCP sidebars"
```
