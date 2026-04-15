import { ArrowLeft, ExternalLink, Globe, Package, Radio } from 'lucide-react';
import McpIcon from './McpIcon';
import type { RegistryMcpServer, McpServerConfig } from '../../types';

interface McpRegistryDetailProps {
  server: RegistryMcpServer;
  onBack: () => void;
  onInstall: (config: McpServerConfig) => void;
}

export default function McpRegistryDetail({ server, onBack, onInstall }: McpRegistryDetailProps) {
  const handleInstall = () => {
    onInstall({
      name: server.name,
      transport: server.transport,
      ...(server.transport === 'stdio'
        ? { command: 'npx', args: [server.name] }
        : { url: server.source }),
    });
  };

  return (
    <div className="mcp-registry-detail">
      <button className="detail-back" onClick={onBack}>
        <ArrowLeft size={12} /> Back to browse
      </button>

      <div className="detail-header">
        <McpIcon iconUrl={server.iconUrl} size={20} className="detail-icon" imgClassName="detail-icon-img" />
        <div>
          <div className="detail-name">{server.title || server.name}</div>
          {server.version && <div className="detail-version">v{server.version}</div>}
        </div>
      </div>

      <div className="detail-actions">
        {server.repositoryUrl && (
          <button className="detail-btn link" onClick={() => window.open(server.repositoryUrl, '_blank')}>
            <ExternalLink size={12} /> Repository
          </button>
        )}
        {server.websiteUrl && (
          <button className="detail-btn link" onClick={() => window.open(server.websiteUrl, '_blank')}>
            <Globe size={12} /> Website
          </button>
        )}
        {!server.installed ? (
          <button className="detail-btn install" onClick={handleInstall}>
            Install
          </button>
        ) : (
          <span className="detail-installed-badge">Installed</span>
        )}
      </div>

      <div className="detail-section">
        <div className="detail-label">Description</div>
        <div className="detail-desc">{server.description || 'No description available.'}</div>
      </div>

      <div className="detail-section">
        <div className="detail-label">Transport</div>
        <div className="detail-transport-badge">{server.transport}</div>
      </div>

      {server.remotes.length > 0 && (
        <div className="detail-section">
          <div className="detail-label"><Radio size={10} /> Endpoints ({server.remotes.length})</div>
          {server.remotes.map((r, i) => (
            <div key={i} className="detail-row">
              <span className="detail-row-type">{r.type}</span>
              <span className="detail-row-val">{r.url}</span>
            </div>
          ))}
        </div>
      )}

      {server.packages.length > 0 && (
        <div className="detail-section">
          <div className="detail-label"><Package size={10} /> Packages ({server.packages.length})</div>
          {server.packages.map((pkg, i) => (
            <div key={i} className="detail-package">
              <div className="detail-pkg-header">
                <span className="detail-pkg-registry">{pkg.registryType}</span>
                <span className="detail-pkg-id">{pkg.identifier}</span>
              </div>
              {pkg.transport && (
                <div className="detail-pkg-meta">Transport: {pkg.transport.type}</div>
              )}
              {pkg.environmentVariables && pkg.environmentVariables.length > 0 && (
                <div className="detail-pkg-envs">
                  <div className="detail-pkg-env-title">Environment Variables</div>
                  {pkg.environmentVariables.map((ev, j) => (
                    <div key={j} className="detail-pkg-env">
                      <span className="env-name">{ev.name}{ev.required ? ' *' : ''}</span>
                      <span className="env-desc">{ev.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {server.source && (
        <div className="detail-section">
          <div className="detail-label">Source</div>
          <div className="detail-source">{server.source}</div>
        </div>
      )}

      <style>{`
        .mcp-registry-detail {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          overflow-y: auto;
          flex-shrink: 0;
        }
        .mcp-registry-detail .detail-back {
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
        .mcp-registry-detail .detail-back:hover { color: var(--text); }
        .mcp-registry-detail .detail-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }
        .mcp-registry-detail .detail-icon {
          width: 36px;
          height: 36px;
          background: var(--bg-hover);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          flex-shrink: 0;
        }
        .mcp-registry-detail .detail-icon-img {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          object-fit: cover;
          flex-shrink: 0;
        }
        .mcp-registry-detail .detail-name { font-weight: 700; font-size: 14px; }
        .mcp-registry-detail .detail-version {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .mcp-registry-detail .detail-actions {
          display: flex;
          gap: 6px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .mcp-registry-detail .detail-btn {
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
        .mcp-registry-detail .detail-btn.link {
          background: var(--bg-hover);
          color: var(--text);
        }
        .mcp-registry-detail .detail-btn.link:hover { background: var(--border); }
        .mcp-registry-detail .detail-btn.install {
          background: var(--accent);
          color: #fff;
        }
        .mcp-registry-detail .detail-btn.install:hover { opacity: 0.9; }
        .mcp-registry-detail .detail-installed-badge {
          font-size: 11px;
          color: var(--green);
          padding: 5px 12px;
          font-weight: 500;
        }
        .mcp-registry-detail .detail-section { padding: 12px; }
        .mcp-registry-detail .detail-label {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 6px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .mcp-registry-detail .detail-desc {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .mcp-registry-detail .detail-transport-badge {
          display: inline-block;
          padding: 2px 8px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 4px;
          font-size: 10px;
          font-family: 'Geist Mono', monospace;
          color: var(--text-secondary);
        }
        .mcp-registry-detail .detail-row {
          display: flex;
          gap: 6px;
          align-items: baseline;
          padding: 4px 8px;
          background: var(--bg-input);
          border-radius: 4px;
          margin-bottom: 3px;
        }
        .mcp-registry-detail .detail-row-type {
          font-size: 9px;
          font-weight: 600;
          color: var(--accent);
          text-transform: uppercase;
          flex-shrink: 0;
        }
        .mcp-registry-detail .detail-row-val {
          font-size: 10px;
          font-family: 'Geist Mono', monospace;
          color: var(--text-secondary);
          word-break: break-all;
        }
        .mcp-registry-detail .detail-package {
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px;
          margin-bottom: 6px;
        }
        .mcp-registry-detail .detail-pkg-header {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .mcp-registry-detail .detail-pkg-registry {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--accent);
          background: var(--bg-hover);
          padding: 1px 5px;
          border-radius: 3px;
        }
        .mcp-registry-detail .detail-pkg-id {
          font-size: 11px;
          font-family: 'Geist Mono', monospace;
          color: var(--text);
          word-break: break-all;
        }
        .mcp-registry-detail .detail-pkg-meta {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 4px;
        }
        .mcp-registry-detail .detail-pkg-envs {
          margin-top: 6px;
          border-top: 1px solid var(--border);
          padding-top: 6px;
        }
        .mcp-registry-detail .detail-pkg-env-title {
          font-size: 9px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
        .mcp-registry-detail .detail-pkg-env {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 3px 0;
        }
        .mcp-registry-detail .detail-pkg-env .env-name {
          font-size: 10px;
          font-family: 'Geist Mono', monospace;
          color: var(--text);
          font-weight: 600;
        }
        .mcp-registry-detail .detail-pkg-env .env-desc {
          font-size: 10px;
          color: var(--text-muted);
        }
        .mcp-registry-detail .detail-source {
          font-size: 11px;
          font-family: 'Geist Mono', monospace;
          color: var(--text-muted);
          word-break: break-all;
        }
      `}</style>
    </div>
  );
}
