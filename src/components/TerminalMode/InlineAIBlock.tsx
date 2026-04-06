import { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, Copy } from 'lucide-react';
import type { AIEntry } from './types';

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

interface InlineAIBlockProps {
  question: string;
  content: string;
  suggestedCommands?: string[];
  streaming?: boolean;
  duration?: number;
  entries?: AIEntry[];
  aiProvider?: 'claude' | 'codex' | 'gemini';
  onRunCommand: (cmd: string) => void;
  onCopy?: (text: string) => void;
}

export default function InlineAIBlock({
  question,
  content,
  suggestedCommands,
  streaming,
  duration,
  entries,
  aiProvider = 'claude',
  onRunCommand,
  onCopy,
}: InlineAIBlockProps) {
  const providerLabel = PROVIDER_LABELS[aiProvider] ?? 'Claude';

  const runnableCommands = new Set(suggestedCommands ?? []);

  const handleCopyCode = useCallback((text: string) => {
    if (onCopy) onCopy(text);
    else navigator.clipboard.writeText(text);
  }, [onCopy]);

  return (
    <div className="tn-ai-block">
      {/* Header with question inline */}
      <div className="tn-ai-header">
        <div className="tn-ai-header-left">
          <span className="tn-ai-icon">⬡</span>
          <span className="tn-ai-label">{providerLabel}</span>
          {streaming && <span className="tn-ai-streaming" />}
          <span className="tn-ai-sep">·</span>
          <span className="tn-ai-question">{question}</span>
        </div>
        {!streaming && duration != null && (
          <span className="tn-ai-duration">{formatDuration(duration)}</span>
        )}
      </div>

      {/* Response content — rendered as markdown */}
      {content && (
        <div className="tn-ai-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre({ children }) {
                // Extract text content from the code element inside pre
                const codeEl = children as React.ReactElement;
                const codeText = extractText(codeEl);
                const isRunnable = runnableCommands.has(codeText.trim());

                return (
                  <div className="tn-ai-code-wrapper">
                    <pre>{children}</pre>
                    <div className="tn-ai-code-actions">
                      {isRunnable && (
                        <span
                          className="tn-ai-code-btn tn-ai-code-run"
                          title="Run"
                          onClick={() => onRunCommand(codeText.trim())}
                        >
                          <Play size={10} />
                        </span>
                      )}
                      <span
                        className="tn-ai-code-btn tn-ai-code-copy"
                        title="Copy"
                        onClick={() => handleCopyCode(codeText)}
                      >
                        <Copy size={10} />
                      </span>
                    </div>
                  </div>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="tn-ai-entries">
          {entries.map((entry, i) =>
            entry.kind === 'text' ? (
              <div key={i} className="tn-ai-entry-text">{entry.text}</div>
            ) : (
              <div key={i} className="tn-ai-entry-tool">{entry.call.name}: {entry.call.input}</div>
            )
          )}
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

/** Recursively extract text from React elements */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText(node.props.children);
  }
  return '';
}

const styles = `
  .tn-ai-block {
    background: #13111e;
    border-radius: 5px;
    padding: 10px 11px;
    border: 1px solid #2d2454;
    margin-bottom: 10px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
  }
  .tn-ai-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 8px;
  }
  .tn-ai-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }
  .tn-ai-icon {
    color: #8b5cf6;
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }
  .tn-ai-label {
    color: #8b5cf6;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .tn-ai-streaming {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8b5cf6;
    animation: tn-ai-pulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes tn-ai-pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
  .tn-ai-sep {
    color: #4b5563;
    font-size: 11px;
    flex-shrink: 0;
  }
  .tn-ai-question {
    color: #7c7f85;
    font-size: 11px;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tn-ai-duration {
    color: #4b5563;
    font-size: 10px;
    flex-shrink: 0;
  }
  .tn-ai-content {
    color: #b4b8c0;
    font-size: 11.5px;
    line-height: 1.6;
    padding-left: 20px;
    margin-bottom: 10px;
  }
  .tn-ai-content p {
    margin: 0 0 6px;
  }
  .tn-ai-content p:last-child {
    margin-bottom: 0;
  }
  .tn-ai-content strong {
    color: #e5e7eb;
    font-weight: 600;
  }
  .tn-ai-content em {
    color: #9ca3af;
  }
  .tn-ai-content code {
    background: #1a1e24;
    padding: 1px 4px;
    border-radius: 2px;
    color: #e5e7eb;
    font-size: 11px;
  }
  .tn-ai-code-wrapper {
    position: relative;
  }
  .tn-ai-code-wrapper pre {
    background: #0a0d0f;
    border: 1px solid #1e2328;
    border-radius: 4px;
    padding: 8px 10px;
    padding-right: 56px;
    margin: 6px 0;
    overflow-x: auto;
  }
  .tn-ai-code-wrapper pre code {
    background: none;
    padding: 0;
    font-size: 11px;
    color: #e5e7eb;
  }
  .tn-ai-code-actions {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .tn-ai-code-wrapper:hover .tn-ai-code-actions {
    opacity: 1;
  }
  .tn-ai-code-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .tn-ai-code-run {
    color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }
  .tn-ai-code-run:hover {
    background: rgba(34, 197, 94, 0.25);
  }
  .tn-ai-code-copy {
    color: #6b7280;
    background: rgba(107, 114, 128, 0.1);
  }
  .tn-ai-code-copy:hover {
    background: rgba(107, 114, 128, 0.25);
    color: #9ca3af;
  }
  .tn-ai-content ul, .tn-ai-content ol {
    margin: 4px 0;
    padding-left: 18px;
  }
  .tn-ai-content li {
    margin-bottom: 2px;
  }
  .tn-ai-content a {
    color: #58a6ff;
    text-decoration: none;
  }
  .tn-ai-content a:hover {
    text-decoration: underline;
  }
  .tn-ai-entries {
    padding-left: 20px;
    margin-bottom: 10px;
  }
  .tn-ai-entry-text {
    color: #b4b8c0;
    font-size: 11.5px;
    line-height: 1.6;
    margin-bottom: 4px;
  }
  .tn-ai-entry-tool {
    color: #8b5cf6;
    font-size: 11px;
    margin-bottom: 4px;
  }
`;
