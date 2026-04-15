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
      (s.name || '').toLowerCase().includes(query) || (s.description || '').toLowerCase().includes(query)
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
