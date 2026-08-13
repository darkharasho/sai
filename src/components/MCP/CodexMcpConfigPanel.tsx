import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import type { CodexMcpConfigServer, CodexMcpConfigSnapshot } from '../../../electron/services/codexBackend/types';

type Props = { available: boolean; reason?: string };
type Draft = { name: string; transport: 'stdio' | 'http'; command: string; args: string; url: string };
const emptyDraft = (): Draft => ({ name: '', transport: 'stdio', command: '', args: '', url: '' });

function toDraft(server: CodexMcpConfigServer): Draft {
  return server.transport === 'stdio'
    ? { name: server.name, transport: 'stdio', command: server.command, args: server.args.join('\n'), url: '' }
    : { name: server.name, transport: 'http', command: '', args: '', url: server.url };
}

function fromDraft(draft: Draft, existing?: CodexMcpConfigServer): CodexMcpConfigServer | null {
  const name = draft.name.trim();
  if (!name) return null;
  if (draft.transport === 'stdio') {
    const command = draft.command.trim();
    if (!command) return null;
    return {
      name, transport: 'stdio', command,
      args: draft.args.split('\n').map((arg) => arg.trim()).filter(Boolean),
      ...(existing?.transport === 'stdio' && existing.env ? { env: existing.env } : {}),
    };
  }
  const url = draft.url.trim();
  if (!url) return null;
  return { name, transport: 'http', url, ...(existing?.transport === 'http' && existing.httpHeaders ? { httpHeaders: existing.httpHeaders } : {}) };
}

/** Intentionally structural: never render commands, URLs, args, headers, or env values into confirmation UI. */
function redactedDiff(before: CodexMcpConfigServer[], after: CodexMcpConfigServer[]): string[] {
  const oldByName = new Map(before.map((server) => [server.name, server]));
  const newByName = new Map(after.map((server) => [server.name, server]));
  const lines: string[] = [];
  [...newByName.keys()].sort().forEach((name) => {
    const next = newByName.get(name)!;
    const prior = oldByName.get(name);
    if (!prior) lines.push(`Added ${next.transport} server ${name}`);
    else if (JSON.stringify(prior) !== JSON.stringify(next)) lines.push(`Updated ${next.transport} server ${name}`);
  });
  [...oldByName.keys()].sort().forEach((name) => {
    if (!newByName.has(name)) lines.push(`Removed ${oldByName.get(name)!.transport} server ${name}`);
  });
  return lines;
}

export default function CodexMcpConfigPanel({ available, reason }: Props) {
  const [snapshot, setSnapshot] = useState<CodexMcpConfigSnapshot | null>(null);
  const [servers, setServers] = useState<CodexMcpConfigServer[]>([]);
  const [editor, setEditor] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!available || !window.sai.codexMcpConfigGet) return;
    setLoading(true); setMessage(null);
    try {
      const result = await window.sai.codexMcpConfigGet();
      if (result.ok) { setSnapshot(result.snapshot); setServers(result.snapshot.servers); }
      else setMessage('Codex MCP configuration is unavailable.');
    } catch { setMessage('Unable to load Codex MCP configuration.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [available]); // availability change is an explicit lifecycle boundary

  const changes = useMemo(() => snapshot ? redactedDiff(snapshot.servers, servers) : [], [snapshot, servers]);
  const stage = () => {
    if (!editor) return;
    const existing = editor.index === null ? undefined : servers[editor.index];
    const server = fromDraft(editor.draft, existing);
    if (!server || servers.some((item, index) => item.name === server.name && index !== editor.index)) {
      setMessage('Use a unique server name and complete the required connection fields.'); return;
    }
    setServers((current) => editor.index === null ? [...current, server] : current.map((item, index) => index === editor.index ? server : item));
    setEditor(null); setMessage(null);
  };

  const save = async () => {
    if (!snapshot || !acknowledged || !window.sai.codexMcpConfigReplace) return;
    setLoading(true); setMessage(null);
    try {
      const result = await window.sai.codexMcpConfigReplace({
        expectedVersion: snapshot.version, servers, confirmationToken: 'confirm-global-user-mcp-config',
      });
      if (result.ok) {
        setSnapshot(result.snapshot); setServers(result.snapshot.servers); setReviewing(false); setAcknowledged(false);
        setMessage('Codex MCP configuration saved. New turns will use the updated global configuration.');
      } else if (result.code === 'conflict') {
        await load(); setReviewing(false); setAcknowledged(false);
        setMessage('Configuration changed elsewhere. Review the refreshed configuration before saving again.');
      } else setMessage('Unable to save Codex MCP configuration.');
    } catch { setMessage('Unable to save Codex MCP configuration.'); }
    finally { setLoading(false); }
  };

  if (!available) return <div className="codex-mcp-config-unavailable">{reason || 'Codex MCP configuration is unavailable.'}</div>;
  return <section className="codex-mcp-config" data-testid="codex-mcp-config">
    <div className="codex-mcp-config-heading"><div><strong>Global MCP configuration</strong><p>App Server only. Existing turns keep their current configuration.</p></div><button type="button" onClick={() => setEditor({ index: null, draft: emptyDraft() })}><Plus size={12} /> Add server</button></div>
    {loading && <div className="sidebar-empty">Loading configuration…</div>}
    {message && <div className="codex-mcp-config-message" role="status">{message}</div>}
    {!loading && snapshot && servers.length === 0 && <div className="sidebar-empty">No global Codex MCP servers configured.</div>}
    {!loading && servers.map((server, index) => <div className="codex-mcp-config-server" key={`${server.name}-${index}`}><div><strong>{server.name}</strong><span>{server.transport}</span></div><div><button type="button" aria-label={`Edit ${server.name}`} onClick={() => setEditor({ index, draft: toDraft(server) })}><Pencil size={12} /></button><button type="button" aria-label={`Remove ${server.name}`} onClick={() => setServers((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={12} /></button></div></div>)}
    {editor && <div className="codex-mcp-config-editor"><div className="codex-mcp-config-editor-title">{editor.index === null ? 'Add server' : 'Edit server'}<button type="button" aria-label="Cancel editor" onClick={() => setEditor(null)}><X size={12} /></button></div><label>Server name<input aria-label="Server name" value={editor.draft.name} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, name: event.target.value } })} /></label><label>Transport<select aria-label="Transport" value={editor.draft.transport} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, transport: event.target.value as Draft['transport'] } })}><option value="stdio">stdio</option><option value="http">http</option></select></label>{editor.draft.transport === 'stdio' ? <><label>Command<input aria-label="Command" value={editor.draft.command} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, command: event.target.value } })} /></label><label>Arguments (one per line)<textarea aria-label="Arguments" value={editor.draft.args} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, args: event.target.value } })} /></label></> : <label>URL<input aria-label="URL" value={editor.draft.url} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, url: event.target.value } })} /></label>}<button type="button" onClick={stage}>Stage server</button></div>}
    {changes.length > 0 && !editor && !reviewing && <button type="button" className="codex-mcp-config-review" onClick={() => { setReviewing(true); setAcknowledged(false); }}>Review changes</button>}
    {reviewing && <div className="codex-mcp-config-review-dialog" role="dialog" aria-label="Confirm global MCP configuration change"><strong>Confirm global MCP configuration change</strong><p>Only server names and transports are shown below; connection values remain redacted.</p><ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul><label><input aria-label="I understand this changes my global Codex MCP configuration" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I understand this changes my global Codex MCP configuration</label><div><button type="button" onClick={() => { setReviewing(false); setAcknowledged(false); }}>Cancel</button><button type="button" disabled={!acknowledged || loading} onClick={() => void save()}>Confirm and save</button></div></div>}
    <style>{`.codex-mcp-config{padding:12px;border-top:1px solid var(--border-hairline);font-size:11px}.codex-mcp-config-heading{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.codex-mcp-config-heading p{margin:3px 0 10px;color:var(--text-muted);line-height:1.35}.codex-mcp-config button{font:inherit}.codex-mcp-config-server{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--border-hairline)}.codex-mcp-config-server span{margin-left:6px;color:var(--text-muted)}.codex-mcp-config-server button{margin-left:4px}.codex-mcp-config-editor,.codex-mcp-config-review-dialog{display:grid;gap:7px;margin-top:9px;padding:9px;border:1px solid var(--border-hairline);border-radius:6px}.codex-mcp-config-editor-title{display:flex;justify-content:space-between;font-weight:650}.codex-mcp-config-editor label{display:grid;gap:3px}.codex-mcp-config-editor input,.codex-mcp-config-editor select,.codex-mcp-config-editor textarea{min-width:0;font:inherit}.codex-mcp-config-review{margin-top:10px}.codex-mcp-config-review-dialog p,.codex-mcp-config-review-dialog ul{margin:0;color:var(--text-muted);line-height:1.4}.codex-mcp-config-review-dialog ul{padding-left:18px}.codex-mcp-config-review-dialog>div{display:flex;justify-content:flex-end;gap:6px}.codex-mcp-config-message,.codex-mcp-config-unavailable{padding:10px 0;color:var(--text-muted);line-height:1.4}.codex-mcp-config-message{color:var(--error,#e07171)}`}</style>
  </section>;
}
