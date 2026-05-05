import { useState, useEffect } from 'react';
import { ArrowLeft, RotateCcw, Server, Trash2 } from 'lucide-react';
import type { McpServer, McpTool } from '../../types';
import { DOT_MASK_URL } from '../../lib/assets';

interface McpDetailProps {
  server: McpServer;
  onBack: () => void;
  onRemove: (name: string) => void;
  onToggleEnabled: (name: string, enabled: boolean) => void;
  onRestart: (name: string) => void;
}

export default function McpDetail({ server, onBack, onRemove, onToggleEnabled, onRestart }: McpDetailProps) {
  const [tools, setTools] = useState<McpTool[]>([]);

  useEffect(() => {
    if (window.sai.mcpGetTools) {
      window.sai.mcpGetTools(server.name)
        .then((result: McpTool[]) => {
          if (Array.isArray(result)) setTools(result);
        })
        .catch(() => {});
    }
  }, [server.name]);

  const maskedEnv = server.env
    ? Object.fromEntries(
        Object.entries(server.env).map(([k, v]) => [k, v.length > 4 ? v.slice(0, 2) + '•••' : '•••'])
      )
    : null;

  return (
    <div className="mcp-detail">
      <button className="detail-back" onClick={onBack}>
        <ArrowLeft size={12} /> Back to servers
      </button>

      <div className="detail-header">
        <div className="detail-icon"><Server size={20} /></div>
        <div>
          <div className="detail-name">{server.name}</div>
          <div className={`detail-status ${server.enabled ? 'connected' : 'disconnected'}`}>
            <span className="status-dot-lg" /> {server.enabled ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="detail-btn restart" onClick={() => onRestart(server.name)}>
          <RotateCcw size={12} /> Restart
        </button>
        <button
          className="detail-btn toggle"
          onClick={() => onToggleEnabled(server.name, !server.enabled)}
        >
          {server.enabled ? 'Disable' : 'Enable'}
        </button>
        {server.source !== 'plugin' && (
          <button className="detail-btn danger" onClick={() => onRemove(server.name)}>
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>

      {tools.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Available Tools ({tools.length})</div>
          {tools.map(tool => (
            <div key={tool.name} className="tool-row">
              <span className="tool-name">{tool.name}</span>
              {tool.parameters && <span className="tool-param">{tool.parameters}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="detail-section">
        <div className="detail-label">Configuration</div>
        <div className="config-block">
          {server.command && <div><span className="config-key">"command":</span> "{server.command}"</div>}
          {server.args && <div><span className="config-key">"args":</span> {JSON.stringify(server.args)}</div>}
          {server.url && <div><span className="config-key">"url":</span> "{server.url}"</div>}
          {maskedEnv && (
            <div>
              <span className="config-key">"env":</span> {JSON.stringify(maskedEnv).replace(/"/g, '')}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .mcp-detail {
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
        .detail-status { font-size: 10px; display: flex; align-items: center; gap: 4px; }
        .detail-status.connected { color: var(--green); }
        .detail-status.disconnected { color: var(--red); }
        .status-dot-lg {
          display: inline-block;
          width: 9px;
          height: 9px;
          background: currentColor;
          -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
          mask: url("${DOT_MASK_URL}") center / contain no-repeat;
        }
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
        }
        .detail-btn.restart { background: var(--bg-hover); color: var(--accent); }
        .detail-btn.toggle { background: var(--bg-hover); color: var(--text-muted); }
        .detail-btn.danger { background: var(--red); color: #fff; }
        .detail-section { padding: 12px; }
        .detail-label {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 6px;
          font-weight: 600;
        }
        .tool-row {
          padding: 6px 10px;
          background: var(--bg-input);
          border-radius: 4px;
          margin-bottom: 3px;
          display: flex;
          justify-content: space-between;
        }
        .tool-name {
          font-family: 'Geist Mono', monospace;
          font-size: 11px;
        }
        .tool-param {
          font-size: 10px;
          color: var(--text-muted);
        }
        .config-block {
          padding: 8px 10px;
          background: var(--bg-input);
          border-radius: 6px;
          font-family: 'Geist Mono', monospace;
          font-size: 10px;
          color: var(--text-secondary);
          line-height: 1.6;
          border: 1px solid var(--border);
        }
        .config-key { color: var(--text-muted); }
      `}</style>
    </div>
  );
}
