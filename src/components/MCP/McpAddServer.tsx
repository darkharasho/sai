import { useState } from 'react';

type Transport = 'stdio' | 'sse' | 'streamable-http';

interface McpAddServerProps {
  onBack: () => void;
  onAdd: (config: {
    name: string;
    transport: Transport;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }) => void;
}

export default function McpAddServer({ onBack, onAdd }: McpAddServerProps) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<Transport>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleEnvChange = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...envVars];
    updated[index][field] = val;
    setEnvVars(updated);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!name.trim()) return;

    const env: Record<string, string> = {};
    for (const v of envVars) {
      if (v.key.trim()) env[v.key.trim()] = v.value;
    }

    onAdd({
      name: name.trim(),
      transport,
      ...(transport === 'stdio' ? {
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : undefined,
      } : {
        url: url.trim(),
      }),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    });
  };

  const isValid = name.trim() && (transport === 'stdio' ? command.trim() : url.trim());

  return (
    <div className="mcp-add-server">
      <button className="detail-back" onClick={onBack}>
        <span>←</span> Back to servers
      </button>

      <div className="add-form">
        <div className="add-title">Add MCP Server</div>

        <div className="form-field">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="my-server"
          />
        </div>

        <div className="form-field">
          <label className="form-label">Transport</label>
          <div className="transport-toggle">
            {(['stdio', 'sse', 'streamable-http'] as Transport[]).map(t => (
              <button
                key={t}
                className={`transport-btn ${transport === t ? 'active' : ''}`}
                onClick={() => setTransport(t)}
              >
                {t === 'streamable-http' ? 'HTTP' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {transport === 'stdio' ? (
          <>
            <div className="form-field">
              <label className="form-label">Command</label>
              <input
                className="form-input mono"
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="npx -y @my/server"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Arguments <span className="form-optional">(optional)</span></label>
              <input
                className="form-input mono"
                value={args}
                onChange={e => setArgs(e.target.value)}
                placeholder="--port 3000"
              />
            </div>
          </>
        ) : (
          <div className="form-field">
            <label className="form-label">URL</label>
            <input
              className="form-input mono"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="http://localhost:3000/sse"
            />
          </div>
        )}

        <div className="form-field">
          <label className="form-label">Environment Variables <span className="form-optional">(optional)</span></label>
          {envVars.map((v, i) => (
            <div key={i} className="env-row">
              <input
                className="form-input mono env-key"
                value={v.key}
                onChange={e => handleEnvChange(i, 'key', e.target.value)}
                placeholder="KEY"
              />
              <span className="env-eq">=</span>
              <input
                className="form-input mono env-val"
                value={v.value}
                onChange={e => handleEnvChange(i, 'value', e.target.value)}
                placeholder="value"
              />
              <button className="env-remove" onClick={() => handleRemoveEnvVar(i)}>×</button>
            </div>
          ))}
          <button className="add-env-btn" onClick={handleAddEnvVar}>+ Add variable</button>
        </div>

        <button
          className={`submit-btn ${isValid ? '' : 'disabled'}`}
          onClick={handleSubmit}
          disabled={!isValid}
        >
          Add Server
        </button>
      </div>

      <style>{`
        .mcp-add-server {
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
        .add-form { padding: 12px; }
        .add-title { font-weight: 700; font-size: 14px; margin-bottom: 12px; }
        .form-field { margin-bottom: 10px; }
        .form-label {
          display: block;
          font-size: 10px;
          color: var(--text-muted);
          margin-bottom: 4px;
          font-weight: 600;
        }
        .form-optional { color: var(--border); }
        .form-input {
          width: 100%;
          padding: 6px 10px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text);
          font-size: 11px;
          outline: none;
          font-family: inherit;
        }
        .form-input.mono { font-family: 'Geist Mono', monospace; }
        .form-input:focus { border-color: var(--accent); }
        .transport-toggle { display: flex; gap: 4px; }
        .transport-btn {
          padding: 4px 10px;
          background: var(--bg-hover);
          border: none;
          border-radius: 4px;
          font-size: 10px;
          color: var(--text-muted);
          cursor: pointer;
        }
        .transport-btn.active {
          background: var(--accent);
          color: #000;
          font-weight: 600;
        }
        .env-row {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 4px;
        }
        .env-key { flex: 2; }
        .env-eq { color: var(--text-muted); font-size: 11px; }
        .env-val { flex: 3; }
        .env-remove {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          padding: 0 4px;
        }
        .env-remove:hover { color: var(--red); }
        .add-env-btn {
          background: none;
          border: none;
          color: var(--accent);
          cursor: pointer;
          font-size: 10px;
          padding: 4px 0;
        }
        .submit-btn {
          width: 100%;
          padding: 8px;
          background: var(--accent);
          color: #000;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 12px;
          margin-top: 4px;
        }
        .submit-btn.disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .submit-btn:hover:not(.disabled) { background: var(--accent-hover); }
      `}</style>
    </div>
  );
}
