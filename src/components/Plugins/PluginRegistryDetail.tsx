import { useEffect, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Loader2 } from 'lucide-react';
import PluginIcon from './PluginIcon';
import PluginInventorySections from './PluginInventorySections';
import type { PluginInventory, RegistryPlugin } from '../../types';

interface PluginRegistryDetailProps {
  plugin: RegistryPlugin;
  installing: boolean;
  error?: string;
  onBack(): void;
  onInstall(): void;
}

export default function PluginRegistryDetail({ plugin, installing, error, onBack, onInstall }: PluginRegistryDetailProps) {
  // Only plugins whose files live in the marketplace clone have a readable inventory.
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  useEffect(() => {
    let alive = true;
    setInventory(null);
    Promise.resolve(window.sai.pluginsRegistryInventory?.(plugin.marketplace, plugin.name))
      .then((inv: PluginInventory | null) => { if (alive) setInventory(inv ?? null); })
      .catch(() => { /* no inventory */ });
    return () => { alive = false; };
  }, [plugin.marketplace, plugin.name]);

  return (
    <div className="plg-detail">
      <button className="plg-back" onClick={onBack}><ArrowLeft size={12} /> Back to browse</button>

      <div className="plg-dhd">
        <div className="plg-dht">
          <div className="plg-ico lg"><PluginIcon name={plugin.name} size={16} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="plg-dnm">{plugin.name}</div>
            <div className="plg-sub">
              {plugin.marketplace}{plugin.version && ` · v${plugin.version}`}{plugin.author && ` · by ${plugin.author}`}
            </div>
          </div>
        </div>
        {plugin.category && <span className="plg-pill">{plugin.category}</span>}
        <div className="plg-acts">
          {plugin.installed ? (
            <span className="plg-muted">Installed</span>
          ) : (
            <button className="mcp-btn pri" disabled={installing} onClick={onInstall}>
              {installing ? <><Loader2 size={11} className="plg-spin" /> Installing</> : <><Download size={11} /> Install</>}
            </button>
          )}
          {plugin.homepage && (
            <button className="mcp-btn" onClick={() => window.open(plugin.homepage, '_blank')}>
              <ExternalLink size={11} /> Homepage
            </button>
          )}
        </div>
        {error && <div className="plg-derr" role="alert">{error}</div>}
      </div>

      <div className="plg-sec"><div className="plg-desc">{plugin.description || 'No description available.'}</div></div>
      {inventory && <PluginInventorySections inventory={inventory} />}
    </div>
  );
}
