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
  const required = useMemo(() => new Set(request.mode === 'form' && Array.isArray(request.requestedSchema.required)
    ? request.requestedSchema.required.filter((name): name is string => typeof name === 'string') : []), [request]);
  const hasValue = (name: string, schema: Property) => {
    const value = values[name];
    if (value === undefined || value === '') return false;
    return schema.type !== 'number' && schema.type !== 'integer' || Number.isFinite(Number(value));
  };
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
    {request.mode === 'url' ? <><code>{request.url}</code><p>This request may require completing the shown URL outside SAI.</p></> : fields.map(([name, schema]) => <label key={name}>{name}{required.has(name) ? <small> Required</small> : null}
      {schema.enum || schema.type === 'boolean' ? <select aria-label={name} value={values[name] ?? ''} onChange={event => setValues(prev => ({ ...prev, [name]: event.target.value }))}><option value="">Select…</option>{(schema.enum ?? [true, false]).map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>
        : <input aria-label={name} required={required.has(name)} type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} value={values[name] ?? ''} onChange={event => setValues(prev => ({ ...prev, [name]: event.target.value.slice(0, 2000) }))} />}
    </label>)}
    <div className="app-server-input-actions">
      <button type="button" onClick={submit} disabled={request.mode === 'form' && fields.some(([name, schema]) => required.has(name) && !hasValue(name, schema))}>Submit</button>
      <button type="button" onClick={() => onResolve({ action: 'decline' })}>Decline</button>
      <button type="button" onClick={() => onResolve({ action: 'cancel' })}>Cancel</button>
    </div>
  </section>;
}
