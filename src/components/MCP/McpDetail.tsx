import { ArrowLeft, RotateCcw, Trash2, Pencil, LogOut, Power } from 'lucide-react';
import { useState } from 'react';
import type { McpCapabilities } from '../../types';
import { MCP_SOURCE_ICON, MCP_TERMINAL_HINT, type McpRow } from './mcpView';
import McpAuthCard, { isHttpUrl } from './McpAuthCard';

interface McpDetailProps {
  row: McpRow;
  capabilities: McpCapabilities;
  available: boolean;
  busy: boolean;
  error: string | null;
  onBack(): void;
  onReconnect(row: McpRow): void;
  onToggle(row: McpRow): void;
  onSignIn(row: McpRow): void;
  onCancelAuth(row: McpRow): void;
  onSubmitCallbackUrl(row: McpRow, url: string): void;
  onSignOut(row: McpRow): void;
  onEdit(row: McpRow): void;
  onRemove(row: McpRow): void;
}

const MASK = '••••••';
/** Remote MCP URLs sometimes carry an API key: show the endpoint, mask every
 *  query value, and drop credentials and the fragment. */
export function maskUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { return raw.split(/[?#]/)[0]; }
  const keys = [...new Set(u.searchParams.keys())];
  const query = keys.length ? `?${keys.map((k) => `${k}=${MASK}`).join('&')}` : '';
  return `${u.protocol}//${u.host}${u.pathname}${query}`;
}

const SOURCE_LABEL = { user: 'global', project: 'project', plugin: 'plugin', claudeai: 'claude.ai' } as const;
const TOOL_PREVIEW = 8;

function pillText(row: McpRow): string {
  if (!row.enabled) return 'Disabled';
  if (row.auth?.phase === 'waiting' && (!row.auth.authUrl || isHttpUrl(row.auth.authUrl))) return 'Waiting for browser sign-in…';
  switch (row.live?.status) {
    case 'connected': return row.live.serverInfo ? `Connected · ${row.live.serverInfo.name} v${row.live.serverInfo.version}` : 'Connected';
    case 'pending': return 'Connecting…';
    case 'needs-auth': return 'Needs sign-in';
    case 'failed': return `Failed — ${row.live.error || 'unknown error'}`;
    case 'disabled': return 'Disabled';
    default: return 'Status unknown';
  }
}

export default function McpDetail(props: McpDetailProps) {
  const { row, capabilities: caps, available, busy, error } = props;
  const [showAllTools, setShowAllTools] = useState(false);
  const Icon = MCP_SOURCE_ICON[row.source];
  const remote = row.transport !== 'stdio';
  const live = available && !busy;
  const tools = row.live?.tools ?? [];
  const shownTools = showAllTools ? tools : tools.slice(0, TOOL_PREVIEW);
  const server = row.server;
  const url = server?.url ?? row.live?.config?.url;
  const transportLabel = row.transport === 'streamable-http' ? 'http' : row.transport === 'unknown' ? 'remote' : row.transport;

  return (
    <div className="mcp-detail">
      <button className="mcp-back" onClick={props.onBack}><ArrowLeft size={12} /> Servers</button>

      <div className="mcp-dhd">
        <div className="mcp-dht">
          <div className="mcp-ico lg"><Icon size={16} /></div>
          <div className="mcp-info">
            <div className="mcp-dnm">{row.displayName}</div>
            <div className="mcp-ds">{transportLabel} · {row.source === 'plugin' && row.pluginShort ? `plugin: ${row.pluginShort}` : SOURCE_LABEL[row.source]}</div>
          </div>
        </div>
        <span className="mcp-pill"><span className={`mcp-dot ${row.dot}`} />{pillText(row)}</span>
        <div className="mcp-acts">
          {row.fix === 'sign-in' && caps.authenticate && !row.auth && (
            <button className="mcp-btn pri" disabled={!live} onClick={() => props.onSignIn(row)}>Sign in</button>
          )}
          {row.fix === 'sign-in' && !caps.authenticate && (
            <span className="mcp-hint" title="Run `claude` in a terminal, then /mcp">Sign in from a terminal: claude → /mcp</span>
          )}
          <button className="mcp-btn" disabled={!live || !caps.reconnect} onClick={() => props.onReconnect(row)}>
            <RotateCcw size={11} /> Reconnect
          </button>
          {row.source !== 'claudeai' && (
            <button className="mcp-btn" disabled={busy} onClick={() => props.onToggle(row)}>
              <Power size={11} /> {row.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
          {remote && caps.clearAuth && row.live?.status === 'connected' && (
            <button className="mcp-btn" disabled={!live} onClick={() => props.onSignOut(row)}><LogOut size={11} /> Sign out</button>
          )}
          {row.editable && <button className="mcp-btn ghost" disabled={busy} onClick={() => props.onEdit(row)}><Pencil size={11} /> Edit</button>}
          {row.removable && <button className="mcp-btn ghost danger" disabled={busy} onClick={() => props.onRemove(row)}><Trash2 size={11} /> Remove</button>}
        </div>
        {!row.editable && <div className="mcp-ds mcp-dhint">{MCP_TERMINAL_HINT}</div>}
        {error && <div className="mcp-derr" role="alert">{error}</div>}
      </div>

      {row.auth && (
        <McpAuthCard
          auth={row.auth}
          canPasteCallback={caps.submitCallbackUrl}
          disabled={!live}
          onRetry={() => props.onSignIn(row)}
          onCancel={() => props.onCancelAuth(row)}
          onSubmitCallbackUrl={(u) => props.onSubmitCallbackUrl(row, u)}
        />
      )}

      <div className="mcp-sec">
        <h4>Tools{tools.length ? ` · ${tools.length}` : ''}</h4>
        {tools.length === 0 && (
          <div className="mcp-ds">{row.live?.status === 'needs-auth' ? 'Tools appear after sign-in.' : 'No tools reported.'}</div>
        )}
        {shownTools.map((t) => (
          <div key={t.name} className="mcp-tool" title={t.description}>
            {t.name}{t.description && <span>{t.description}</span>}
          </div>
        ))}
        {tools.length > TOOL_PREVIEW && (
          <button className="mcp-link" onClick={() => setShowAllTools((s) => !s)}>
            {showAllTools ? 'Show fewer' : `+ ${tools.length - TOOL_PREVIEW} more`}
          </button>
        )}
      </div>

      <div className="mcp-sec">
        <h4>Config</h4>
        <div className="mcp-config">
          {server?.command && <div><span className="mcp-ck">command:</span> {server.command}</div>}
          {server?.args?.length ? <div><span className="mcp-ck">args:</span> {server.args.join(' ')}</div> : null}
          {url && <div><span className="mcp-ck">url:</span> {maskUrl(url)}</div>}
          {server?.env && Object.keys(server.env).length > 0 && (
            <div><span className="mcp-ck">env:</span> {Object.keys(server.env).map((k) => `${k}=••••••`).join(' ')}</div>
          )}
          {server?.headers && Object.keys(server.headers).length > 0 && (
            <div><span className="mcp-ck">headers:</span> {Object.keys(server.headers).map((k) => `${k}: ••••••`).join(', ')}</div>
          )}
          {!server && !url && <div className="mcp-ck">Managed outside SAI</div>}
        </div>
      </div>
    </div>
  );
}
