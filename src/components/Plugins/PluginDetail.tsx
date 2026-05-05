import { ArrowLeft, Trash2 } from 'lucide-react';
import PluginIcon from './PluginIcon';
import type { Plugin } from '../../types';
import { DOT_MASK_URL } from '../../lib/assets';

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
        <ArrowLeft size={12} /> Back to plugins
      </button>

      <div className="detail-header">
        <div className="detail-icon"><PluginIcon name={plugin.name} size={20} /></div>
        <div>
          <div className="detail-name">{plugin.name}</div>
          <div className="detail-source">{plugin.source}</div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="detail-btn danger" onClick={() => onUninstall(plugin.name)}>
          <Trash2 size={12} /> Uninstall
        </button>
        <span className="detail-status-badge">
          <span className={`status-dot ${plugin.enabled ? 'active' : 'inactive'}`} />
          {plugin.enabled ? 'Enabled' : 'Disabled'}
        </span>
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
        .detail-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          font-size: 10px;
          font-weight: 600;
          color: var(--text-muted);
          line-height: 1;
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
