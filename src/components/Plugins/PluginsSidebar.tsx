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
      if (Array.isArray(result)) {
        setInstalled(result);
      } else if (result?.error) {
        setError(result.error);
      } else {
        setInstalled([]);
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
    loadInstalled();
  };

  const query = search.toLowerCase();

  const filteredInstalled = useMemo(
    () => installed.filter(p =>
      (p.name || '').toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query)
    ),
    [installed, query]
  );

  const filteredRegistry = useMemo(
    () => registry.filter(p =>
      (p.name || '').toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query)
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
