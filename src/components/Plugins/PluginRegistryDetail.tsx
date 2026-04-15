import { ArrowLeft, ExternalLink } from 'lucide-react';
import PluginIcon from './PluginIcon';
import type { RegistryPlugin } from '../../types';

interface PluginRegistryDetailProps {
  plugin: RegistryPlugin;
  onBack: () => void;
  onInstall: (name: string) => void;
}

export default function PluginRegistryDetail({ plugin, onBack, onInstall }: PluginRegistryDetailProps) {
  return (
    <div className="plugin-registry-detail">
      <button className="detail-back" onClick={onBack}>
        <ArrowLeft size={12} /> Back to browse
      </button>

      <div className="detail-header">
        <div className="detail-icon"><PluginIcon name={plugin.name} size={20} /></div>
        <div>
          <div className="detail-name">{plugin.name}</div>
          {plugin.author && <div className="detail-author">by {plugin.author}</div>}
        </div>
      </div>

      <div className="detail-actions">
        {plugin.repositoryUrl && (
          <button className="detail-btn link" onClick={() => window.open(plugin.repositoryUrl, '_blank')}>
            <ExternalLink size={12} /> View Source
          </button>
        )}
        {!plugin.installed ? (
          <button className="detail-btn install" onClick={() => onInstall(plugin.name)}>
            Install
          </button>
        ) : (
          <span className="detail-installed-badge">Installed</span>
        )}
      </div>

      <div className="detail-section">
        <div className="detail-label">Description</div>
        <div className="detail-text">{plugin.description || 'No description available.'}</div>
      </div>

      {plugin.version && (
        <div className="detail-section">
          <div className="detail-label">Version</div>
          <div className="detail-text">{plugin.version}</div>
        </div>
      )}

      {plugin.skills.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Skills ({plugin.skills.length})</div>
          <div className="detail-chips">
            {plugin.skills.map(skill => (
              <span key={skill} className="detail-chip">{skill}</span>
            ))}
          </div>
        </div>
      )}

      {plugin.commands.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Commands ({plugin.commands.length})</div>
          <div className="detail-chips">
            {plugin.commands.map(cmd => (
              <span key={cmd} className="detail-chip cmd">/{cmd}</span>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <div className="detail-label">Source</div>
        <div className="detail-source">{plugin.source}</div>
      </div>

      <style>{`
        .plugin-registry-detail {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          overflow-y: auto;
          flex-shrink: 0;
        }
        .plugin-registry-detail .detail-back {
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
        .plugin-registry-detail .detail-back:hover { color: var(--text); }
        .plugin-registry-detail .detail-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }
        .plugin-registry-detail .detail-icon {
          width: 36px;
          height: 36px;
          background: var(--bg-hover);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .plugin-registry-detail .detail-name { font-weight: 700; font-size: 14px; }
        .plugin-registry-detail .detail-author {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .plugin-registry-detail .detail-actions {
          display: flex;
          gap: 6px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }
        .plugin-registry-detail .detail-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 12px;
          border: none;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          font-weight: 500;
        }
        .plugin-registry-detail .detail-btn.link {
          background: var(--bg-hover);
          color: var(--text);
        }
        .plugin-registry-detail .detail-btn.link:hover { background: var(--border); }
        .plugin-registry-detail .detail-btn.install {
          background: var(--accent);
          color: #fff;
        }
        .plugin-registry-detail .detail-btn.install:hover { opacity: 0.9; }
        .plugin-registry-detail .detail-installed-badge {
          font-size: 11px;
          color: var(--green);
          padding: 5px 12px;
          font-weight: 500;
        }
        .plugin-registry-detail .detail-section { padding: 12px; }
        .plugin-registry-detail .detail-label {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 6px;
          font-weight: 600;
        }
        .plugin-registry-detail .detail-text {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .plugin-registry-detail .detail-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .plugin-registry-detail .detail-chip {
          padding: 3px 8px;
          background: var(--bg-input);
          border-radius: 4px;
          font-size: 11px;
          color: var(--text-secondary);
        }
        .plugin-registry-detail .detail-chip.cmd {
          font-family: 'Geist Mono', monospace;
          color: var(--accent);
        }
        .plugin-registry-detail .detail-source {
          font-size: 11px;
          font-family: 'Geist Mono', monospace;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
