import { useState, useEffect, useMemo } from 'react';
import { ChevronRight, Plus, Search, Server } from 'lucide-react';
import McpDetail from './McpDetail';
import McpAddServer from './McpAddServer';
import McpRegistryDetail from './McpRegistryDetail';
import McpIcon from './McpIcon';
import CodexMcpConfigPanel from './CodexMcpConfigPanel';
import SaiLogo from '../SaiLogo';
import { DOT_MASK_URL } from '../../lib/assets';
import type { AIProvider, McpServer, McpServerConfig, RegistryMcpServer } from '../../types';

type Tab = 'installed' | 'browse';
type View = 'list' | 'detail' | 'add' | 'registry-detail';

type CodexMcpRuntimeStatus = {
  available: boolean;
  reason?: string;
  servers: Array<{
    name: string;
    lifecycle: string;
    authentication: string;
    toolCount: number;
    failureReason?: string;
  }>;
};

interface McpSidebarProps {
  /** Claude's MCP configuration UI is intentionally separate from Codex's
   * isolated App Server runtime. */
  provider?: AIProvider;
  projectPath?: string;
  scope?: string;
}

export default function McpSidebar({ provider = 'claude', projectPath, scope }: McpSidebarProps) {
  const isCodex = provider === 'codex';
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [installed, setInstalled] = useState<McpServer[]>([]);
  const [registry, setRegistry] = useState<RegistryMcpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
  const [selectedRegistryServer, setSelectedRegistryServer] = useState<RegistryMcpServer | null>(null);
  const [runtime, setRuntime] = useState<Record<string, { status: string }>>({});
  const [codexRuntime, setCodexRuntime] = useState<CodexMcpRuntimeStatus | null>(null);
  const [codexLoading, setCodexLoading] = useState(false);

  const loadInstalled = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.sai.mcpList();
      if (Array.isArray(result)) {
        setInstalled(result);
      } else if (result?.error) {
        setError(result.error);
      } else {
        setInstalled([]);
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
      if (Array.isArray(result)) {
        setRegistry(result);
      } else if (result?.error) {
        setError(result.error);
      } else {
        setRegistry([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load registry');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!isCodex) loadInstalled();
  }, [isCodex]);

  // Codex App Server owns an isolated runtime and configuration. Do not call
  // the Claude MCP APIs here: their installed list is neither shared nor safe
  // to present as Codex state.
  useEffect(() => {
    if (!isCodex) {
      setCodexRuntime(null);
      setCodexLoading(false);
      return;
    }

    let cancelled = false;
    setView('list');
    setCodexRuntime(null);
    if (!projectPath || !window.sai.codexMcpRuntimeStatus) {
      setCodexRuntime({ available: false, reason: 'Codex MCP runtime status is unavailable.', servers: [] });
      return;
    }
    setCodexLoading(true);
    window.sai.codexMcpRuntimeStatus(projectPath, scope)
      .then((status) => {
        if (!cancelled) setCodexRuntime(status);
      })
      .catch(() => {
        if (!cancelled) setCodexRuntime({ available: false, reason: 'Codex MCP runtime status is unavailable.', servers: [] });
      })
      .finally(() => {
        if (!cancelled) setCodexLoading(false);
      });
    return () => { cancelled = true; };
  }, [isCodex, projectPath, scope]);

  // Live connection status from the SDK backend (init-message report). The CLI
  // backend never reports this, so badges only appear in SDK mode.
  useEffect(() => {
    if (isCodex) return;
    const api = window.sai as any;
    let cancelled = false;
    api.mcpRuntimeStatus?.().then((r: any) => {
      if (!cancelled && r?.servers) setRuntime(r.servers);
    }).catch(() => {});
    const off = api.onMcpRuntimeStatus?.((r: any) => {
      if (r?.servers) setRuntime(r.servers);
    });
    return () => { cancelled = true; off?.(); };
  }, [isCodex]);

  // Runtime entries are keyed by the name the SDK saw; plugin servers appear in
  // the sidebar as `plugin:<short>:<name>` — fall back to matching the bare
  // server name or the `<short>-<name>` key used when SAI owns the connection.
  const runtimeFor = (sidebarName: string): string | undefined => {
    if (runtime[sidebarName]) return runtime[sidebarName].status;
    const m = /^plugin:([^:]+):(.+)$/.exec(sidebarName);
    if (m) {
      return runtime[m[2]]?.status ?? runtime[`${m[1]}-${m[2]}`]?.status;
    }
    return undefined;
  };

  useEffect(() => {
    if (!isCodex && tab === 'browse' && registry.length === 0) {
      loadRegistry();
    }
  }, [isCodex, tab]);

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
    loadInstalled();
  };

  const query = search.toLowerCase();

  const filteredInstalled = useMemo(
    () => installed.filter(s =>
      (s.name || '').toLowerCase().includes(query) ||
      (s.description || '').toLowerCase().includes(query)
    ),
    [installed, query]
  );

  const filteredRegistry = useMemo(
    () => registry.filter(s =>
      (s.title || '').toLowerCase().includes(query) ||
      (s.name || '').toLowerCase().includes(query) ||
      (s.description || '').toLowerCase().includes(query)
    ),
    [registry, query]
  );

  if (isCodex) {
    return (
      <div className="mcp-sidebar sidebar-mount codex-mcp-sidebar" data-testid="codex-mcp-runtime">
        <div className="codex-mcp-header">
          <Server size={15} />
          <div>
            <div className="codex-mcp-title">Codex App Server MCP</div>
            <div className="codex-mcp-subtitle">Runtime status · global configuration</div>
          </div>
        </div>
        <div className="sidebar-list">
          {codexLoading && <div className="sidebar-empty">Loading Codex MCP runtime…</div>}
          {!codexLoading && codexRuntime?.available === false && (
            <div className="codex-mcp-unavailable">{codexRuntime.reason || 'Codex MCP runtime status is unavailable.'}</div>
          )}
          {!codexLoading && codexRuntime?.available && codexRuntime.servers.length === 0 && (
            <div className="sidebar-empty">No MCP servers reported by Codex.</div>
          )}
          {!codexLoading && codexRuntime?.available && codexRuntime.servers.map((server) => (
            <div className="codex-mcp-card" key={server.name}>
              <div className="card-icon"><Server size={14} /></div>
              <div className="card-info">
                <div className="card-name">{server.name}</div>
                <div className="card-desc">{server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'} · {server.authentication}</div>
                {server.failureReason && <div className="codex-mcp-failure">{server.failureReason}</div>}
              </div>
              <span className={`codex-mcp-lifecycle codex-mcp-${server.lifecycle}`}>{server.lifecycle}</span>
            </div>
          ))}
          {!codexLoading && codexRuntime?.available && (
            <CodexMcpConfigPanel
              available
            />
          )}
        </div>
        <style>{`
          .codex-mcp-header { display: flex; align-items: center; gap: 9px; padding: 13px 12px; border-bottom: 1px solid var(--border-hairline); color: var(--text); }
          .codex-mcp-title { font-size: 12px; font-weight: 650; }
          .codex-mcp-subtitle { margin-top: 2px; color: var(--text-muted); font-size: 10px; }
          .codex-mcp-card { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-hairline); }
          .codex-mcp-card .card-info { min-width: 0; flex: 1; }
          .codex-mcp-lifecycle { margin-top: 2px; color: var(--text-muted); font-size: 10px; text-transform: capitalize; white-space: nowrap; }
          .codex-mcp-running, .codex-mcp-available { color: var(--success, #6fbf73); }
          .codex-mcp-failed { color: var(--error, #e07171); }
          .codex-mcp-failure, .codex-mcp-unavailable { color: var(--text-muted); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
          .codex-mcp-failure { margin-top: 4px; color: var(--error, #e07171); }
          .codex-mcp-unavailable { padding: 14px 12px; }
        `}</style>
      </div>
    );
  }

  if (view === 'registry-detail' && selectedRegistryServer) {
    return (
      <McpRegistryDetail
        server={selectedRegistryServer}
        onBack={() => { setView('list'); setSelectedRegistryServer(null); }}
        onInstall={(config) => {
          handleAdd(config);
          setSelectedRegistryServer(null);
        }}
      />
    );
  }

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
    <div className="mcp-sidebar sidebar-mount">
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
        <button className="add-btn" onClick={() => setView('add')}><Plus size={12} /> Add</button>
      </div>

      <div className="sidebar-list">
        {loading && (
          <div className="sidebar-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <SaiLogo mode="scanner" size={28} />
            <span>Loading...</span>
          </div>
        )}
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
            <div className="card-icon"><Server size={14} /></div>
            <div className="card-info">
              <div className="card-name">{server.name}</div>
              <div className="card-desc">{server.description || server.transport}</div>
            </div>
            <div className="card-right">
              {(() => {
                const rt = runtimeFor(server.name);
                if (!rt) return null;
                const ok = rt === 'connected';
                return <span className={`card-runtime ${ok ? 'ok' : 'bad'}`}>{ok ? 'connected' : rt}</span>;
              })()}
              <span className={`status-dot ${server.enabled ? 'active' : 'inactive'}`} />
              <ChevronRight size={12} className="card-chevron" />
            </div>
          </div>
        ))}

        {!loading && !error && tab === 'installed' && filteredInstalled.length === 0 && (
          <div className="sidebar-empty sidebar-empty-stack">
            {search
              ? <SaiLogo mode="static" size={40} className="sai-fallen" ariaLabel="" />
              : <SaiLogo mode="idle" size={40} ariaLabel="" />}
            <span>{search ? 'No matching servers' : 'No MCP servers configured'}</span>
          </div>
        )}

        {!loading && !error && tab === 'browse' && filteredRegistry.map(server => (
          <div
            key={server.name}
            className="sidebar-card"
            onClick={() => { setSelectedRegistryServer(server); setView('registry-detail'); }}
          >
            <McpIcon iconUrl={server.iconUrl} />
            <div className="card-info">
              <div className="card-name">{server.title || server.name}</div>
              <div className="card-desc">{server.description}</div>
            </div>
            <div className="card-right">
              {server.installed ? (
                <span className="card-installed">Installed</span>
              ) : (
                <button className="card-install-btn" onClick={(e) => {
                  e.stopPropagation();
                  handleAdd({ name: server.name, transport: server.transport });
                }}>Install</button>
              )}
              <ChevronRight size={12} className="card-chevron" />
            </div>
          </div>
        ))}

        {!loading && !error && tab === 'browse' && filteredRegistry.length === 0 && (
          <div className="sidebar-empty sidebar-empty-stack">
            {search
              ? <SaiLogo mode="static" size={40} className="sai-fallen" ariaLabel="" />
              : <SaiLogo mode="idle" size={40} ariaLabel="" />}
            <span>{search ? 'No matching servers' : 'No servers found'}</span>
          </div>
        )}
      </div>

      <style>{`
        .mcp-sidebar {
          width: var(--sidebar-width);
          background: var(--surface-1);
          border-right: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex-shrink: 0;
        }
        .sidebar-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-hairline);
        }
        .sidebar-tab {
          flex: 1;
          padding: 9px 12px;
          text-align: center;
          font-size: 11px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          position: relative;
          transition: color var(--dur-fast) var(--ease-out-soft);
        }
        .sidebar-tab::after {
          content: '';
          position: absolute;
          left: 8px;
          right: 8px;
          bottom: 0;
          height: 2px;
          background: var(--accent);
          transform: scaleX(0);
          transform-origin: center;
          transition: transform var(--dur-base) var(--ease-out-soft);
        }
        .sidebar-tab.active {
          color: var(--accent);
          font-weight: 600;
        }
        .sidebar-tab.active::after { transform: scaleX(1); }
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
          background: var(--surface-2);
          border: 1px solid var(--border-hairline);
          border-radius: 6px;
          color: var(--text);
          font-size: 11px;
          outline: none;
          font-family: inherit;
        }
        .sidebar-search:focus { border-color: var(--accent); }
        .add-btn {
          padding: 6px 10px;
          background: var(--surface-4);
          border: none;
          border-radius: 6px;
          color: var(--accent);
          font-size: 11px;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
        }
        .add-btn:hover { background: var(--border-subtle); }
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
          background: var(--surface-2);
          border-radius: 6px;
          margin-bottom: 4px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .sidebar-card:hover { background: var(--surface-4); }
        .card-icon {
          width: 28px;
          height: 28px;
          background: var(--surface-4);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .card-icon-img {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          object-fit: cover;
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
          display: inline-block;
          width: 8px;
          height: 8px;
          background: currentColor;
          -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
          mask: url("${DOT_MASK_URL}") center / contain no-repeat;
        }
        .status-dot.active { color: var(--green); }
        .status-dot.inactive { color: var(--red); }
        .card-runtime {
          font-size: 9px;
          padding: 1px 6px;
          border-radius: 999px;
          border: 1px solid var(--border-subtle);
          color: var(--text-muted);
          white-space: nowrap;
        }
        .card-runtime.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 40%, transparent); }
        .card-runtime.bad { color: var(--red); border-color: color-mix(in srgb, var(--red) 40%, transparent); }
        .card-chevron { color: var(--text-muted); font-size: 10px; }
        .card-install-btn {
          padding: 2px 8px;
          background: var(--surface-4);
          border: none;
          border-radius: 4px;
          font-size: 10px;
          color: var(--accent);
          cursor: pointer;
        }
        .card-install-btn:hover { background: var(--border-subtle); }
        .card-installed { font-size: 10px; color: var(--text-muted); }
        .sidebar-empty {
          text-align: center;
          padding: 24px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .sidebar-empty-stack {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 32px 16px;
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
          background: var(--surface-4);
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
