import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import PluginIcon from './PluginIcon';
import PluginDetail, { type PluginAction } from './PluginDetail';
import PluginRegistryDetail from './PluginRegistryDetail';
import PluginStyles from './PluginStyles';
import SaiLogo from '../SaiLogo';
import { groupByMarketplace, matchesQuery, pluginSubtitle, registryCategories } from './pluginView';
import type { Plugin, RegistryPlugin } from '../../types';

type Tab = 'installed' | 'browse';
type View = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'registry'; id: string };

interface PluginsSidebarProps {
  /** Project-scoped installs count (and are changed) only for this project. */
  projectPath?: string;
  onOpenMcp?(): void;
}

type Result = { error?: string } | undefined;

function errorOf(result: unknown): string | null {
  return result && typeof result === 'object' && 'error' in result && (result as any).error ? String((result as any).error) : null;
}

function Empty({ searching, text }: { searching: boolean; text: string }) {
  return (
    <div className="plg-empty">
      {searching
        ? <SaiLogo mode="static" size={40} className="sai-fallen" ariaLabel="" />
        : <SaiLogo mode="idle" size={40} ariaLabel="" />}
      <span>{text}</span>
    </div>
  );
}

function Loading() {
  return <div className="plg-empty"><SaiLogo mode="scanner" size={28} /><span>Loading…</span></div>;
}

function onRowKey(open: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
}

export default function PluginsSidebar({ projectPath, onOpenMcp }: PluginsSidebarProps) {
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });

  const [installed, setInstalled] = useState<Plugin[]>([]);
  const [installedState, setInstalledState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [registry, setRegistry] = useState<RegistryPlugin[] | null>(null);
  const [registryState, setRegistryState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });

  const [busy, setBusy] = useState<Record<string, PluginAction>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const loadInstalled = useCallback(async (quiet = false) => {
    if (!quiet) setInstalledState({ loading: true, error: null });
    try {
      const result = await window.sai.pluginsList(projectPath);
      if (Array.isArray(result)) {
        setInstalled(result);
        setInstalledState({ loading: false, error: null });
      } else {
        setInstalledState({ loading: false, error: errorOf(result) ?? 'Failed to load plugins' });
      }
    } catch (err: any) {
      setInstalledState({ loading: false, error: err?.message || 'Failed to load plugins' });
    }
  }, [projectPath]);

  const loadRegistry = useCallback(async () => {
    setRegistryState({ loading: true, error: null });
    try {
      const result = await window.sai.pluginsRegistryList();
      if (Array.isArray(result)) {
        setRegistry(result);
        setRegistryState({ loading: false, error: null });
      } else {
        setRegistryState({ loading: false, error: errorOf(result) ?? 'Failed to read marketplaces' });
      }
    } catch (err: any) {
      setRegistryState({ loading: false, error: err?.message || 'Failed to read marketplaces' });
    }
  }, []);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);
  useEffect(() => { if (tab === 'browse' && registry === null && !registryState.loading) loadRegistry(); }, [tab, registry, registryState.loading, loadRegistry]);

  /** Runs one CLI action for a plugin, tracking busy/error and refreshing the list after. */
  const run = useCallback(async (id: string, action: PluginAction, call: () => Promise<Result>) => {
    setBusy(b => ({ ...b, [id]: action }));
    setErrors(({ [id]: _drop, ...rest }) => rest);
    let failed: string | null;
    try {
      failed = errorOf(await call());
    } catch (err: any) {
      failed = err?.message || `Failed to ${action}`;
    }
    if (failed) {
      setErrors(e => ({ ...e, [id]: failed! }));
    } else {
      setChanged(c => new Set(c).add(id));
      if (action === 'install' || action === 'uninstall') {
        setRegistry(r => r?.map(p => (p.id === id ? { ...p, installed: action === 'install' } : p)) ?? r);
      }
      if (action === 'uninstall') setView({ kind: 'list' });
    }
    await loadInstalled(true);
    setBusy(({ [id]: _drop, ...rest }) => rest);
  }, [loadInstalled]);

  const install = (id: string) => run(id, 'install', () => window.sai.pluginsInstall(id));
  const uninstall = (id: string) => run(id, 'uninstall', () => window.sai.pluginsUninstall(id, projectPath));
  const toggle = (id: string, enabled: boolean) => run(id, 'toggle', () => window.sai.pluginsSetEnabled(id, enabled, projectPath));
  const update = (id: string) => run(id, 'update', () => window.sai.pluginsUpdate(id, projectPath));

  const installedGroups = useMemo(
    () => groupByMarketplace(installed.filter(p => matchesQuery(p, search))),
    [installed, search],
  );
  const categories = useMemo(() => registryCategories(registry ?? []), [registry]);
  const registryGroups = useMemo(
    () => groupByMarketplace((registry ?? []).filter(p => matchesQuery(p, search) && (!category || p.category === category))),
    [registry, search, category],
  );
  const updates = installed.filter(p => p.updateAvailable).length;

  if (view.kind === 'detail') {
    const plugin = installed.find(p => p.id === view.id);
    if (plugin) {
      return (
        <>
          <PluginStyles />
          <PluginDetail
            plugin={plugin}
            busy={busy[plugin.id]}
            error={errors[plugin.id]}
            changed={changed.has(plugin.id)}
            onBack={() => setView({ kind: 'list' })}
            onToggle={(enabled) => toggle(plugin.id, enabled)}
            onUpdate={() => update(plugin.id)}
            onUninstall={() => uninstall(plugin.id)}
            onOpenMcp={onOpenMcp}
          />
        </>
      );
    }
  }

  if (view.kind === 'registry') {
    const plugin = registry?.find(p => p.id === view.id);
    if (plugin) {
      return (
        <>
          <PluginStyles />
          <PluginRegistryDetail
            plugin={plugin}
            installing={busy[plugin.id] === 'install'}
            error={errors[plugin.id]}
            onBack={() => setView({ kind: 'list' })}
            onInstall={() => install(plugin.id)}
          />
        </>
      );
    }
  }

  const searching = search.trim() !== '';

  return (
    <div className="plugins-sidebar sidebar-mount">
      <PluginStyles />
      <div className="plg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'installed'} className={`plg-tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
          Installed
          {installed.length > 0 && (
            <span className={`plg-tab-badge ${updates ? 'upd' : ''}`} title={updates ? `${updates} update${updates === 1 ? '' : 's'} available` : undefined}>
              {installed.length}
            </span>
          )}
        </button>
        <button role="tab" aria-selected={tab === 'browse'} className={`plg-tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>
          Browse
        </button>
      </div>

      <div className="plg-search-wrap">
        <Search size={12} className="plg-search-icon" />
        <input
          className="plg-search"
          placeholder={tab === 'installed' ? 'Search installed…' : `Search ${registry?.length ?? ''} plugins…`.replace('  ', ' ')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {tab === 'browse' && categories.length > 0 && (
        <div className="plg-chips">
          <button className={`plg-chip ${category === null ? 'active' : ''}`} onClick={() => setCategory(null)}>All</button>
          {categories.map(c => (
            <button key={c} className={`plg-chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(category === c ? null : c)}>{c}</button>
          ))}
        </div>
      )}

      <div className="plg-list">
        {tab === 'installed' && (installedState.loading ? <Loading /> : installedState.error ? (
          <div className="plg-error" role="alert">
            {installedState.error}
            <div><button className="mcp-btn" style={{ marginTop: 6 }} onClick={() => loadInstalled()}>Retry</button></div>
          </div>
        ) : installedGroups.length === 0 ? (
          <Empty searching={searching} text={searching ? 'No matching plugins' : 'No plugins installed'} />
        ) : installedGroups.map(g => (
          <div key={g.id}>
            <div className="plg-grp"><span>{g.id}</span><span>{g.rows.length}</span></div>
            {g.rows.map(p => {
              const open = () => setView({ kind: 'detail', id: p.id });
              const err = errors[p.id];
              return (
                <div key={p.id} className={`plg-row ${p.enabled ? '' : 'off'}`} role="button" tabIndex={0} onClick={open} onKeyDown={onRowKey(open)}>
                  <div className="plg-ico"><PluginIcon name={p.name} size={13} /></div>
                  <div className="plg-info">
                    <div className="plg-nm">{p.name}</div>
                    <div className={`plg-ds ${err ? 'err' : ''}`} title={err ?? p.description}>{err ?? pluginSubtitle(p)}</div>
                  </div>
                  {p.updateAvailable && !busy[p.id] && <span className="plg-upd" title={`${p.version} → ${p.latestVersion}`}>update</span>}
                  {busy[p.id]
                    ? <Loader2 size={12} className="plg-spin" aria-label="Working" />
                    : <span className={`plg-dot ${p.enabled ? 'ok' : 'off'}`} role="img" aria-label={p.enabled ? 'Enabled' : 'Disabled'} />}
                </div>
              );
            })}
          </div>
        )))}

        {tab === 'browse' && (registryState.loading || registry === null ? (registryState.error ? null : <Loading />) : registryGroups.length === 0 ? (
          <Empty searching={searching || !!category} text={searching || category ? 'No matching plugins' : 'No marketplaces added — run `claude plugins marketplace add`'} />
        ) : registryGroups.map(g => (
          <div key={g.id}>
            <div className="plg-grp"><span>{g.id}</span><span>{g.rows.length}</span></div>
            {g.rows.map(p => {
              const open = () => setView({ kind: 'registry', id: p.id });
              const err = errors[p.id];
              const installing = busy[p.id] === 'install';
              const stop = (e: React.MouseEvent) => { e.stopPropagation(); install(p.id); };
              return (
                <div key={p.id} className="plg-row" role="button" tabIndex={0} onClick={open} onKeyDown={onRowKey(open)}>
                  <div className="plg-ico"><PluginIcon name={p.name} size={13} /></div>
                  <div className="plg-info">
                    <div className="plg-nm">{p.name}</div>
                    <div className={`plg-ds ${err ? 'err' : ''}`} title={err ?? p.description}>{err ? `Install failed: ${err}` : p.description}</div>
                  </div>
                  {p.installed ? <span className="plg-muted">Installed</span>
                    : installing ? <button className="mcp-btn sm" disabled><Loader2 size={10} className="plg-spin" /> Installing</button>
                      : <button className="mcp-btn sm" aria-label={`${err ? 'Retry installing' : 'Install'} ${p.name}`} onClick={stop}>{err ? 'Retry' : 'Install'}</button>}
                </div>
              );
            })}
          </div>
        )))}
        {tab === 'browse' && registryState.error && (
          <div className="plg-error" role="alert">
            {registryState.error}
            <div><button className="mcp-btn" style={{ marginTop: 6 }} onClick={loadRegistry}>Retry</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
