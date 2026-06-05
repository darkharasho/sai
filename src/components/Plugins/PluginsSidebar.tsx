import { useState, useEffect, useMemo } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import PluginIcon from './PluginIcon';
import PluginDetail from './PluginDetail';
import PluginRegistryDetail from './PluginRegistryDetail';
import SaiLogo from '../SaiLogo';
import { DOT_MASK_URL } from '../../lib/assets';
import type { Plugin, RegistryPlugin } from '../../types';

type Tab = 'installed' | 'browse';
type View = 'list' | 'detail' | 'registry-detail';

export default function PluginsSidebar() {
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [installed, setInstalled] = useState<Plugin[]>([]);
  const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
  const [selectedRegistryPlugin, setSelectedRegistryPlugin] = useState<RegistryPlugin | null>(null);

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

  if (view === 'registry-detail' && selectedRegistryPlugin) {
    return (
      <PluginRegistryDetail
        plugin={selectedRegistryPlugin}
        onBack={() => { setView('list'); setSelectedRegistryPlugin(null); }}
        onInstall={(name) => {
          handleInstall(name);
          setSelectedRegistryPlugin(null);
          setView('list');
        }}
      />
    );
  }

  if (view === 'detail' && selectedPlugin) {
    return (
      <PluginDetail
        plugin={selectedPlugin}
        onBack={() => { setView('list'); setSelectedPlugin(null); }}
        onUninstall={handleUninstall}
        onToggleEnabled={handleToggleEnabled}
      />
    );
  }

  return (
    <div className="plugins-sidebar sidebar-mount">
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

        {!loading && !error && tab === 'installed' && filteredInstalled.map(plugin => (
          <div
            key={plugin.name}
            className="sidebar-card"
            onClick={() => { setSelectedPlugin(plugin); setView('detail'); }}
          >
            <div className="card-icon"><PluginIcon name={plugin.name} /></div>
            <div className="card-info">
              <div className="card-name">{plugin.name}</div>
              <div className="card-desc">{plugin.description}</div>
            </div>
            <div className="card-right">
              <span className={`status-dot ${plugin.enabled ? 'active' : 'inactive'}`} />
              <ChevronRight size={12} className="card-chevron" />
            </div>
          </div>
        ))}

        {!loading && !error && tab === 'installed' && filteredInstalled.length === 0 && (
          <div className="sidebar-empty sidebar-empty-stack">
            {search
              ? <SaiLogo mode="static" size={40} className="sai-fallen" ariaLabel="" />
              : <SaiLogo mode="idle" size={40} ariaLabel="" />}
            <span>{search ? 'No matching plugins' : 'No plugins installed'}</span>
          </div>
        )}

        {!loading && !error && tab === 'browse' && filteredRegistry.map(plugin => (
          <div
            key={plugin.name}
            className="sidebar-card"
            onClick={() => { setSelectedRegistryPlugin(plugin); setView('registry-detail'); }}
          >
            <div className="card-icon"><PluginIcon name={plugin.name} /></div>
            <div className="card-info">
              <div className="card-name">{plugin.name}</div>
              <div className="card-desc">{plugin.description}</div>
            </div>
            <div className="card-right">
              {plugin.installed ? (
                <span className="card-installed">Installed</span>
              ) : (
                <button className="card-install-btn" onClick={(e) => {
                  e.stopPropagation();
                  handleInstall(plugin.name);
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
            <span>{search ? 'No matching plugins' : 'No plugins found'}</span>
          </div>
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
          display: inline-block;
          width: 8px;
          height: 8px;
          background: currentColor;
          -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
          mask: url("${DOT_MASK_URL}") center / contain no-repeat;
        }
        .status-dot.active { color: var(--green); }
        .status-dot.inactive { color: var(--red); }
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
