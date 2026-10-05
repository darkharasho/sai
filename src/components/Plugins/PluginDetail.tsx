import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import PluginIcon from './PluginIcon';
import PluginInventorySections from './PluginInventorySections';
import { formatDate, scopeLabel } from './pluginView';
import type { Plugin } from '../../types';

export type PluginAction = 'install' | 'uninstall' | 'toggle' | 'update';

interface PluginDetailProps {
  plugin: Plugin;
  busy?: PluginAction;
  error?: string;
  /** Something about this plugin changed this session — open chats still run the old set. */
  changed: boolean;
  onBack(): void;
  onToggle(enabled: boolean): void;
  onUpdate(): void;
  onUninstall(): void;
  onOpenMcp?(): void;
}

export default function PluginDetail({ plugin, busy, error, changed, onBack, onToggle, onUpdate, onUninstall, onOpenMcp }: PluginDetailProps) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setConfirming(false); }, [plugin.id]);
  const managed = plugin.activeScope === 'managed';
  const installed = formatDate(plugin.installedAt);
  const updated = formatDate(plugin.lastUpdated);

  return (
    <div className="plg-detail">
      <button className="plg-back" onClick={onBack}><ArrowLeft size={12} /> Back to plugins</button>

      <div className="plg-dhd">
        <div className="plg-dht">
          <div className="plg-ico lg"><PluginIcon name={plugin.name} size={16} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="plg-dnm">{plugin.name}</div>
            <div className="plg-sub">{plugin.marketplace}{plugin.version && ` · ${/^\d/.test(plugin.version) ? 'v' : ''}${plugin.version}`}</div>
          </div>
        </div>
        <span className="plg-pill">
          <span className={`plg-dot ${plugin.enabled ? 'ok' : 'off'}`} />
          {plugin.enabled ? 'Enabled' : 'Disabled'} · {scopeLabel(plugin)}
        </span>

        <div className="plg-acts">
          <button
            className="plg-toggle" role="switch" aria-checked={plugin.enabled}
            disabled={!!busy || managed} title={managed ? 'Managed by your organization' : undefined}
            onClick={() => onToggle(!plugin.enabled)}
          >
            <span className="plg-switch" />{plugin.enabled ? 'Enabled' : 'Disabled'}
          </button>
          {busy && busy !== 'uninstall' && <Loader2 size={12} className="plg-spin" />}
          {plugin.updateAvailable && (
            <button className="mcp-btn" disabled={!!busy} onClick={onUpdate}>
              <RefreshCw size={11} /> Update to {plugin.latestVersion}
            </button>
          )}
          {!managed && (confirming ? (
            <>
              <button className="mcp-btn danger" disabled={!!busy} onClick={onUninstall}>
                {busy === 'uninstall' ? <Loader2 size={11} className="plg-spin" /> : <Trash2 size={11} />} Confirm uninstall
              </button>
              <button className="mcp-btn ghost" disabled={!!busy} onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <button className="mcp-btn danger" disabled={!!busy} onClick={() => setConfirming(true)}>Uninstall</button>
          ))}
        </div>
        {error && <div className="plg-derr" role="alert">{error}</div>}
        {changed && !error && <div className="plg-note">Changes apply to new chats — chats already open keep their current plugins.</div>}
      </div>

      {plugin.description && <div className="plg-sec"><div className="plg-desc">{plugin.description}</div></div>}

      <PluginInventorySections inventory={plugin.inventory} onOpenMcp={onOpenMcp} />

      <div className="plg-sec">
        <dl className="plg-meta" style={{ margin: 0 }}>
          {plugin.author && <><dt>Author</dt><dd>{plugin.author}</dd></>}
          {installed && <><dt>Installed</dt><dd>{installed}</dd></>}
          {updated && <><dt>Updated</dt><dd>{updated}</dd></>}
          <dt>Path</dt><dd className="plg-mono" title={plugin.installPath}>{plugin.installPath}</dd>
        </dl>
        {plugin.homepage && (
          <button className="plg-link" onClick={() => window.open(plugin.homepage, '_blank')}>
            <ExternalLink size={10} /> Homepage
          </button>
        )}
      </div>
    </div>
  );
}
