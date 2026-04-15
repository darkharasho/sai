# Plugins & MCP Sidebar Design

## Overview

Add two new sidebar panels to SAI — **Plugins** and **MCP** — for discovering, installing, and managing Claude Code plugins and MCP servers. Each gets its own button in the NavBar, following the existing sidebar pattern (Files, Git, Chats).

## Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Sidebar structure | Two separate NavBar buttons | Consistent with existing pattern, each feature gets full sidebar width |
| Content layout | Tabbed (Installed / Browse) + search bar | Combines tab navigation clarity with always-available filtering |
| Item interaction | Detail view replaces sidebar list | Same pattern as Git/Files sidebars — back button to return |
| Plugin data source | Hybrid — CLI for installed state, GitHub API for registry | CLI is authoritative for install/uninstall; direct API gives richer browse UX |
| MCP data source | Hybrid — read/write mcp.json + live registry fetch | Direct config file access for management; registry API for discovery |
| MCP custom servers | "Add Custom Server" form in sidebar | Supports stdio, SSE, and Streamable HTTP transports |

## NavBar Changes

Add two new buttons below the existing three (Files, Git, Chats):

- **Plugins** — `Puzzle` icon from lucide-react, label "Plugins", toggles `sidebarOpen === 'plugins'`
- **MCP** — `Server` icon from lucide-react, label "MCP", toggles `sidebarOpen === 'mcp'`

Both follow the exact same `nav-btn` pattern: icon + label, active state with accent border, hover state.

## Plugins Sidebar

### List View (default)

- **Tabs:** "Installed" and "Browse" — accent-colored underline on active tab
- **Search bar:** Below tabs, filters the current tab's list
- **Plugin cards:** Each shows icon, name, short description, status indicator (green = active, red = error), chevron for detail navigation
- Clicking a card navigates to the detail view

#### Installed Tab
- Lists all plugins installed via Claude Code CLI
- Status indicators: green dot (active), red dot (error/disabled)
- Data source: `claude plugins list` via IPC

#### Browse Tab
- Lists available plugins from the Claude Code plugin registry
- Each card shows name, description, and "Install" button
- Data source: GitHub API fetch from `anthropics/claude-code-plugins` (or equivalent registry endpoint) via Electron main process
- Search filters by name and description

### Detail View

Replaces the list view with a back button ("← Back to plugins") at the top.

**Header section:**
- Large icon, plugin name, source repository
- Action buttons: "Uninstall" (red), "Enabled/Disabled" toggle

**Info sections:**
- **Description** — full plugin description
- **Version** — installed version
- **Skills** — list of skills provided by the plugin, shown as tags/chips

### IPC Handlers (Electron main process)

New `window.sai` methods:

```typescript
// Installed plugins
window.sai.pluginsList(): Promise<Plugin[]>
window.sai.pluginsInstall(name: string): Promise<void>
window.sai.pluginsUninstall(name: string): Promise<void>
window.sai.pluginsEnable(name: string): Promise<void>
window.sai.pluginsDisable(name: string): Promise<void>

// Registry
window.sai.pluginsRegistryList(): Promise<RegistryPlugin[]>
window.sai.pluginsRegistrySearch(query: string): Promise<RegistryPlugin[]>
```

Implementation: shell out to `claude plugins list`, `claude plugins install <name>`, etc. Registry methods fetch from GitHub API.

## MCP Sidebar

### List View (default)

- **Tabs:** "Installed" and "Browse" — same style as Plugins sidebar
- **Search bar + "+ Add" button:** Search filters current tab; Add button navigates to the add-server form
- **Server cards:** Each shows icon, name, description, connection status (green = connected, red = disconnected), tool count, chevron

#### Installed Tab
- Lists all MCP servers from `~/.claude/mcp.json`
- Shows connection status and tool count per server
- Data source: read `~/.claude/mcp.json` via IPC, connection status from active Claude CLI session

#### Browse Tab
- Lists available MCP servers from a public registry
- Each card shows name, description, and "Install" button
- Data source: fetch from MCP server registry API via Electron main process
- Search filters by name and description

### Detail View

Replaces the list view with a back button ("← Back to servers").

**Header section:**
- Large icon, server name, connection status text
- Action buttons: "Restart", "Disable", "Remove" (red)

**Available Tools section:**
- Lists all tools exposed by the MCP server
- Each tool shows its name (monospace) and primary parameter
- Data: queried from the running MCP server connection

**Configuration section:**
- Shows current config as formatted JSON-like display (command, args, env with masked secrets)
- "Edit Config" button opens inline editing

### Add Custom Server View

Navigated to from the "+ Add" button. Replaces the list view with back button.

**Form fields:**
- **Name** — text input, required
- **Transport** — segmented toggle: stdio (default) | SSE | Streamable HTTP
- **Command** (stdio) / **URL** (SSE/HTTP) — text input, required
- **Arguments** — text input, optional (stdio only)
- **Environment Variables** — key=value inputs with "+ Add variable" button, optional
- **"Add Server"** button — accent-colored, full width

**On submit:** Writes the new server entry to `~/.claude/mcp.json` via IPC and navigates back to the installed list.

### IPC Handlers (Electron main process)

New `window.sai` methods:

```typescript
// MCP config management
window.sai.mcpList(): Promise<McpServer[]>
window.sai.mcpAdd(config: McpServerConfig): Promise<void>
window.sai.mcpRemove(name: string): Promise<void>
window.sai.mcpUpdate(name: string, config: Partial<McpServerConfig>): Promise<void>
window.sai.mcpRestart(name: string): Promise<void>
window.sai.mcpEnable(name: string): Promise<void>
window.sai.mcpDisable(name: string): Promise<void>

// MCP server info (from active session)
window.sai.mcpGetTools(name: string): Promise<McpTool[]>
window.sai.mcpGetStatus(name: string): Promise<'connected' | 'disconnected' | 'error'>

// Registry
window.sai.mcpRegistryList(): Promise<RegistryMcpServer[]>
window.sai.mcpRegistrySearch(query: string): Promise<RegistryMcpServer[]>
```

Implementation: read/write `~/.claude/mcp.json` for config. Connection status and tools queried from the active Claude CLI session. Registry methods fetch from public MCP directory.

## Types

```typescript
interface Plugin {
  name: string;
  description: string;
  version: string;
  source: string;        // e.g. "anthropics/claude-code-plugins"
  enabled: boolean;
  skills: string[];
  icon?: string;
}

interface RegistryPlugin {
  name: string;
  description: string;
  version: string;
  source: string;
  skills: string[];
  installed: boolean;
}

interface McpServer {
  name: string;
  description?: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;       // stdio
  args?: string[];        // stdio
  url?: string;           // sse / streamable-http
  env?: Record<string, string>;
  enabled: boolean;
}

interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

interface McpTool {
  name: string;
  description?: string;
  parameters?: string;    // primary parameter hint
}

interface RegistryMcpServer {
  name: string;
  description: string;
  source: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  installed: boolean;
}
```

## File Structure

```
src/components/
├── Plugins/
│   ├── PluginsSidebar.tsx      # List view: tabs, search, plugin cards
│   └── PluginDetail.tsx        # Detail view: info, skills, actions
├── MCP/
│   ├── McpSidebar.tsx          # List view: tabs, search, +Add, server cards
│   ├── McpDetail.tsx           # Detail view: tools, config, actions
│   └── McpAddServer.tsx        # Add custom server form
```

**Modified files:**
- `src/components/NavBar.tsx` — add Plugins and MCP buttons
- `src/App.tsx` — add `'plugins'` and `'mcp'` to `sidebarOpen` rendering logic
- `electron/preload.ts` — expose new IPC methods on `window.sai`
- `electron/main.ts` — implement IPC handlers for plugins CLI + MCP config management
- `src/types.ts` — add Plugin, McpServer, and related type definitions

## Styling

All styling uses inline `<style>` tags within components, following the existing pattern. Colors use CSS custom properties from `globals.css` (e.g., `--accent`, `--bg-secondary`, `--border`, `--text-muted`). No new CSS files.

## Error Handling

- **CLI not found:** If `claude` CLI is not available, show a message in the Plugins sidebar: "Claude CLI not found. Install Claude Code to manage plugins."
- **Registry fetch failure:** Show inline error with retry button in the Browse tab
- **MCP connection errors:** Red status dot + "disconnected" text on the card, detail view shows error message and "Restart" action
- **Config write failure:** Toast/inline error when saving to `mcp.json` fails
