import { useId, useState } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { isHttpUrl } from './McpAuthCard';
import type { McpServer, McpServerConfig } from '../../types';

type Transport = McpServerConfig['transport'];
type Pair = { key: string; value: string };

interface McpServerFormProps {
  mode: 'add' | 'edit';
  /** Required in edit mode. */
  initial?: McpServer;
  /** Offer the "This project" target. */
  hasProject: boolean;
  onBack(): void;
  onSubmit(config: McpServerConfig): void;
}

const toPairs = (o?: Record<string, string>): Pair[] => Object.entries(o ?? {}).map(([key, value]) => ({ key, value }));
const fromPairs = (p: Pair[]) => Object.fromEntries(p.filter((x) => x.key.trim()).map((x) => [x.key.trim(), x.value]));
/** A row with a value but no name would be dropped silently on save. */
const hasNamelessRow = (p: Pair[]) => p.some((x) => !x.key.trim() && x.value !== '');

function PairEditor({ pairs, setPairs, keyPlaceholder, addLabel, label, error, errorId }: {
  pairs: Pair[]; setPairs(p: Pair[]): void; keyPlaceholder: string; addLabel: string; label: string;
  error?: string; errorId: string;
}) {
  const update = (i: number, field: keyof Pair, v: string) => setPairs(pairs.map((p, j) => (j === i ? { ...p, [field]: v } : p)));
  return (
    <>
      {pairs.map((p, i) => (
        <div key={i} className="env-row">
          <input
            className="form-input mono env-key"
            value={p.key}
            onChange={(e) => update(i, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            aria-label={`${label} name`}
            aria-invalid={error && !p.key.trim() && p.value !== '' ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          <span className="env-eq">=</span>
          <input
            className="form-input mono env-val"
            value={p.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder="value"
            aria-label={`${label} value`}
          />
          <button className="env-remove" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => setPairs(pairs.filter((_, j) => j !== i))}><X size={12} /></button>
        </div>
      ))}
      <button className="add-env-btn" onClick={() => setPairs([...pairs, { key: '', value: '' }])}><Plus size={10} /> {addLabel}</button>
      {error && <div id={errorId} className="form-error" role="alert">{error}</div>}
    </>
  );
}

export default function McpServerForm({ mode, initial, hasProject, onBack, onSubmit }: McpServerFormProps) {
  const editing = mode === 'edit';
  const uid = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [transport, setTransport] = useState<Transport>(initial?.transport ?? 'stdio');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(initial?.args?.join(' ') ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [envVars, setEnvVars] = useState<Pair[]>(toPairs(initial?.env));
  const [headers, setHeaders] = useState<Pair[]>(toPairs(initial?.headers));
  const [target, setTarget] = useState<'user' | 'project'>(initial?.source === 'project' ? 'project' : 'user');
  // Errors appear on the first submit attempt, then track the fields live.
  const [attempted, setAttempted] = useState(false);

  const isStdio = transport === 'stdio';
  // Messages never include field values: headers and env commonly hold secrets.
  const errors = {
    name: name.trim() ? undefined : 'Name is required.',
    command: isStdio && !command.trim() ? 'Command is required.' : undefined,
    url: isStdio ? undefined
      : !url.trim() ? 'URL is required.'
      : !isHttpUrl(url.trim()) ? 'URL must start with http:// or https://.' : undefined,
    headers: !isStdio && hasNamelessRow(headers) ? 'Header name is required.' : undefined,
    env: hasNamelessRow(envVars) ? 'Variable name is required.' : undefined,
  };
  const isValid = !Object.values(errors).some(Boolean);
  const shown = (e?: string) => (attempted ? e : undefined);

  const handleSubmit = () => {
    setAttempted(true);
    if (!isValid) return;
    const env = fromPairs(envVars);
    const hdrs = fromPairs(headers);
    onSubmit({
      name: name.trim(),
      transport,
      ...(isStdio
        ? { command: command.trim(), ...(args.trim() ? { args: args.trim().split(/\s+/) } : {}) }
        : { url: url.trim(), ...(Object.keys(hdrs).length ? { headers: hdrs } : {}) }),
      ...(Object.keys(env).length ? { env } : {}),
      source: target,
    });
  };

  const fieldProps = (id: string, error?: string) => ({
    id: `${uid}-${id}`,
    'aria-invalid': shown(error) ? true : undefined,
    'aria-describedby': shown(error) ? `${uid}-${id}-err` : undefined,
  });
  const fieldError = (id: string, error?: string) =>
    shown(error) ? <div id={`${uid}-${id}-err`} className="form-error" role="alert">{error}</div> : null;

  return (
    <div className="mcp-server-form">
      <button className="mcp-back" onClick={onBack}>
        <ArrowLeft size={12} /> {editing ? 'Back' : 'Back to servers'}
      </button>

      <div className="add-form">
        <div className="add-title">{editing ? 'Edit MCP Server' : 'Add MCP Server'}</div>

        <div className="form-field">
          <label className="form-label" htmlFor={`${uid}-name`}>Name</label>
          <input
            className="form-input"
            {...fieldProps('name', errors.name)}
            value={name}
            readOnly={editing}
            onChange={e => setName(e.target.value)}
            placeholder="my-server"
          />
          {fieldError('name', errors.name)}
        </div>

        {editing ? (
          <div className="form-field">
            <span className="form-label">Saved in</span>
            <div className="form-static">{target === 'project' ? 'Project config' : 'Global config'}</div>
          </div>
        ) : hasProject && (
          <div className="form-field">
            <span className="form-label" id={`${uid}-target`}>Save to</span>
            <div className="transport-toggle" role="group" aria-labelledby={`${uid}-target`}>
              <button className={`transport-btn ${target === 'user' ? 'active' : ''}`} aria-pressed={target === 'user'} onClick={() => setTarget('user')}>Global</button>
              <button className={`transport-btn ${target === 'project' ? 'active' : ''}`} aria-pressed={target === 'project'} onClick={() => setTarget('project')}>This project</button>
            </div>
          </div>
        )}

        <div className="form-field">
          <span className="form-label" id={`${uid}-transport`}>Transport</span>
          <div className="transport-toggle" role="group" aria-labelledby={`${uid}-transport`}>
            {(['stdio', 'sse', 'streamable-http'] as Transport[]).map(t => (
              <button
                key={t}
                className={`transport-btn ${transport === t ? 'active' : ''}`}
                aria-pressed={transport === t}
                onClick={() => setTransport(t)}
              >
                {t === 'streamable-http' ? 'HTTP' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {isStdio ? (
          <>
            <div className="form-field">
              <label className="form-label" htmlFor={`${uid}-command`}>Command</label>
              <input
                className="form-input mono"
                {...fieldProps('command', errors.command)}
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="npx -y @my/server"
              />
              {fieldError('command', errors.command)}
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor={`${uid}-args`}>Arguments <span className="form-optional">(optional)</span></label>
              <input
                className="form-input mono"
                id={`${uid}-args`}
                value={args}
                onChange={e => setArgs(e.target.value)}
                placeholder="--port 3000"
              />
            </div>
          </>
        ) : (
          <>
            <div className="form-field">
              <label className="form-label" htmlFor={`${uid}-url`}>URL</label>
              <input
                className="form-input mono"
                {...fieldProps('url', errors.url)}
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
              />
              {fieldError('url', errors.url)}
            </div>
            <div className="form-field">
              <span className="form-label">Headers <span className="form-optional">(optional)</span></span>
              <PairEditor
                pairs={headers} setPairs={setHeaders} keyPlaceholder="Header" addLabel="Add header" label="Header"
                error={shown(errors.headers)} errorId={`${uid}-headers-err`}
              />
            </div>
          </>
        )}

        <div className="form-field">
          <span className="form-label">Environment Variables <span className="form-optional">(optional)</span></span>
          <PairEditor
            pairs={envVars} setPairs={setEnvVars} keyPlaceholder="KEY" addLabel="Add variable" label="Variable"
            error={shown(errors.env)} errorId={`${uid}-env-err`}
          />
        </div>

        <button className="submit-btn" onClick={handleSubmit}>
          {editing ? 'Save' : 'Add Server'}
        </button>
      </div>
    </div>
  );
}
