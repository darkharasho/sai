import { useState } from 'react';

interface Props {
  name: string;
  input?: Record<string, unknown>;
  result?: string | Record<string, unknown>;
  status: 'running' | 'done' | 'error';
}

export default function ToolCard({ name, input, result, status }: Props) {
  const [expanded, setExpanded] = useState(false);
  const dot = status === 'done' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-amber-500';
  return (
    <div className="border border-neutral-800 rounded-md my-2 text-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-900"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span className="font-mono">{name}</span>
        <span className="ml-auto text-xs text-neutral-500">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs font-mono text-neutral-400 space-y-2">
          {input && (
            <div>
              <div className="text-neutral-500">input</div>
              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(input, null, 2)}</pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <div className="text-neutral-500">result</div>
              <pre className="whitespace-pre-wrap break-all">{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
