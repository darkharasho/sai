import { useMemo, useState } from 'react';
import type { PendingCodexMcpElicitation } from '../../types';

interface Props {
  request: PendingCodexMcpElicitation;
  onResolve: (decision: import('../../../electron/services/codexBackend').CodexMcpElicitationDecision) => void;
}

type Property = { type?: string; enum?: Array<string | number | boolean | null> };

export default function McpElicitationPanel({ request, onResolve }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = useMemo(() => request.mode !== 'form' ? [] : Object.entries((request.requestedSchema.properties ?? {}) as Record<string, Property>).slice(0, 20), [request]);
  const submit = () => {
    if (request.mode === 'url') return onResolve({ action: 'accept', content: null });
    const content: Record<string, unknown> = {};
    for (const [name, schema] of fields) {
      const value = values[name];
      if (value === undefined || value === '') continue;
      content[name] = schema.type === 'number' || schema.type === 'integer' ? Number(value) : schema.type === 'boolean' ? value === 'true' : value;
    }
    onResolve({ action: 'accept', content });
  };

  return <section className="app-server-input-panel" data-testid="codex-mcp-elicitation">
    <strong>MCP input needed</strong>
    <div>{request.serverName}</div>
    <p>{request.message}</p>
    {request.mode === 'url' ? <><code>{request.url}</code><p>This request may require completing the shown URL outside SAI.</p></> : fields.map(([name, schema]) => <label key={name}>{name}
      {schema.enum ? <select aria-label={name} value={values[name] ?? ''} onChange={event => setValues(prev => ({ ...prev, [name]: event.target.value }))}><option value="">Select…</option>{schema.enum.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>
        : <input aria-label={name} type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} value={values[name] ?? ''} onChange={event => setValues(prev => ({ ...prev, [name]: event.target.value.slice(0, 2000) }))} />}
    </label>)}
    <div className="app-server-input-actions">
      <button type="button" onClick={submit}>Submit</button>
      <button type="button" onClick={() => onResolve({ action: 'decline' })}>Decline</button>
      <button type="button" onClick={() => onResolve({ action: 'cancel' })}>Cancel</button>
    </div>
  </section>;
}
