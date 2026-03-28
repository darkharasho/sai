import { useState } from 'react';
import type { ToolCall } from '../../types';

export default function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const icon = toolCall.type === 'file_edit' ? '✏️' :
               toolCall.type === 'terminal_command' ? '▶' :
               toolCall.type === 'file_read' ? '📄' : '🔧';

  return (
    <div className="tool-call-card" onClick={() => setExpanded(!expanded)}>
      <div className="tool-call-header">
        <span className="tool-call-icon">{icon}</span>
        <span className="tool-call-name">{toolCall.name}</span>
        <span className="tool-call-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="tool-call-body">
          {toolCall.input && <pre><code>{toolCall.input}</code></pre>}
          {toolCall.output && (
            <div className="tool-call-output">
              <pre><code>{toolCall.output}</code></pre>
            </div>
          )}
        </div>
      )}
      <style>{`
        .tool-call-card {
          margin: 8px 0;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          overflow: hidden;
        }
        .tool-call-header {
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .tool-call-header:hover { background: var(--bg-hover); }
        .tool-call-icon { font-size: 14px; }
        .tool-call-name { flex: 1; font-family: 'JetBrains Mono', monospace; }
        .tool-call-chevron { color: var(--text-muted); }
        .tool-call-body {
          padding: 8px 12px;
          border-top: 1px solid var(--border);
        }
        .tool-call-body pre { font-size: 12px; margin: 0; }
        .tool-call-output {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed var(--border);
        }
      `}</style>
    </div>
  );
}
