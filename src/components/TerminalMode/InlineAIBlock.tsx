import React, { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Terminal, Copy } from 'lucide-react';
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
          {question && <span className="tn-ai-sep">·</span>}
          {question && <span className="tn-ai-question">{question}</span>}
        </div>
        {!streaming && duration != null && (
          <span className="tn-ai-duration">{formatDuration(duration)}</span>
        )}
      </div>

      {/* Response content — render entries in natural order when available */}
      {entries && entries.length > 0 ? (
        <div className="tn-ai-body">
          {entries.map((entry, i) => {
            if (entry.kind === 'text') {
              return (
                <div key={`text-${i}`} className="tn-ai-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre({ children }) {
                        const codeEl = children as React.ReactElement;
                        const codeText = extractText(codeEl);
                        const isRunnable = runnableCommands.has(codeText.trim());
                        return (
                          <div className="tn-ai-code-wrapper">
                            <pre>{children}</pre>
                            <div className="tn-ai-code-actions">
                              {isRunnable && (
                                <span className="tn-ai-code-icon tn-ai-code-run" title="Run" onClick={() => onRunCommand(codeText.trim())}>
                                  <Terminal size={12} />
                                </span>
                              )}
                              <span className="tn-ai-code-icon tn-ai-code-copy" title="Copy" onClick={() => handleCopyCode(codeText)}>
                                <Copy size={12} />
                              </span>
                            </div>
                          </div>
                        );
                      },
                    }}
                  >
                    {entry.text}
                  </ReactMarkdown>
                </div>
              );
            }
            if (entry.kind === 'tool') {
              const hasOutput = entry.call.output != null;
              return (
                <div key={entry.call.id || `tool-${i}`} className={`tn-ai-entry-tool ${hasOutput ? '' : 'tn-ai-entry-tool-active'}`}>
                  <span className="tn-ai-tool-name">{entry.call.name}</span>
                  <span className="tn-ai-tool-input">{entry.call.input}</span>
                  {hasOutput && !entry.call.isError && <span className="tn-ai-tool-done"> ✓</span>}
                  {entry.call.isError && <span className="tn-ai-tool-error"> ✗</span>}
                  {!hasOutput && streaming && <span className="tn-ai-tool-spinner" />}
                </div>
              );
            }
            return null;
          })}
        </div>
      ) : content ? (
        <div className="tn-ai-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre({ children }) {
                const codeEl = children as React.ReactElement;
                const codeText = extractText(codeEl);
                const isRunnable = runnableCommands.has(codeText.trim());
                return (
                  <div className="tn-ai-code-wrapper">
                    <pre>{children}</pre>
                    <div className="tn-ai-code-actions">
                      {isRunnable && (
                        <span className="tn-ai-code-icon tn-ai-code-run" title="Run" onClick={() => onRunCommand(codeText.trim())}>
                          <Terminal size={12} />
                        </span>
                      )}
                      <span className="tn-ai-code-icon tn-ai-code-copy" title="Copy" onClick={() => handleCopyCode(codeText)}>
                        <Copy size={12} />
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
      ) : null}

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
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

const styles = `
  .tn-ai-block {
    background: var(--bg-secondary);
    border-radius: 5px;
    padding: 10px 11px;
    border: 1px solid #2d2454;
    margin-bottom: 10px;
    font-family: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace;
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
  .tn-ai-body {
    padding-left: 20px;
  }
  .tn-ai-content {
    color: #b4b8c0;
    font-size: 11.5px;
    line-height: 1.6;
    margin-bottom: 6px;
  }
  .tn-ai-block > .tn-ai-content {
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
    background: var(--bg-input);
    padding: 1px 4px;
    border-radius: 2px;
    color: #e5e7eb;
    font-size: 11px;
  }
  .tn-ai-code-wrapper {
    position: relative;
  }
  .tn-ai-code-wrapper pre {
    background: var(--bg-secondary);
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
    top: 0;
    bottom: 0;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tn-ai-code-icon {
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: color 0.15s;
  }
  .tn-ai-code-run {
    color: #4b5563;
  }
  .tn-ai-code-run:hover {
    color: #22c55e;
  }
  .tn-ai-code-copy {
    color: #4b5563;
  }
  .tn-ai-code-copy:hover {
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
  .tn-ai-entry-tool {
    color: #6b7280;
    font-size: 10.5px;
    margin-bottom: 4px;
    padding: 3px 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tn-ai-entry-tool-active {
    color: #8b5cf6;
  }
  .tn-ai-tool-name {
    color: #8b5cf6;
    font-weight: 500;
  }
  .tn-ai-tool-input {
    color: #6b7280;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .tn-ai-tool-done {
    color: #22c55e;
    font-size: 10px;
  }
  .tn-ai-tool-error {
    color: #ef4444;
    font-size: 10px;
  }
  .tn-ai-tool-spinner {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #8b5cf6;
    animation: tn-ai-pulse 1.2s ease-in-out infinite;
  }
`;
