import { useState } from 'react';
import type { AIEntry } from './types';

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

interface InlineAIBlockProps {
  question: string;
  content: string;
  suggestedCommands?: string[];
  streaming?: boolean;
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
  entries,
  aiProvider = 'claude',
  onRunCommand,
  onCopy,
}: InlineAIBlockProps) {
  const [dismissedIndices, setDismissedIndices] = useState<Set<number>>(new Set());

  const providerLabel = PROVIDER_LABELS[aiProvider] ?? 'Claude';

  function handleSkip(index: number) {
    setDismissedIndices(prev => new Set([...prev, index]));
  }

  return (
    <div className="tn-ai-block">
      {/* Header with question inline */}
      <div className="tn-ai-header">
        <span className="tn-ai-icon">⬡</span>
        <span className="tn-ai-label">{providerLabel}</span>
        {streaming && <span className="tn-ai-streaming" />}
        <span className="tn-ai-sep">·</span>
        <span className="tn-ai-question">{question}</span>
      </div>

      {/* Response content */}
      {content && (
        <div className="tn-ai-content">{content}</div>
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

      {/* Suggested commands */}
      {suggestedCommands && suggestedCommands.length > 0 && (
        <div className="tn-ai-commands">
          {suggestedCommands.map((cmd, i) => {
            if (dismissedIndices.has(i)) return null;
            return (
              <div key={i} className="tn-ai-cmd-row">
                <code>{cmd}</code>
                <div className="tn-ai-cmd-actions">
                  <span
                    className="tn-ai-cmd-run"
                    data-action="run"
                    onClick={() => onRunCommand(cmd)}
                  >
                    ⏎ Run
                  </span>
                  <span
                    className="tn-ai-cmd-skip"
                    data-action="skip"
                    onClick={() => handleSkip(i)}
                  >
                    Skip
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
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
    gap: 6px;
    margin-bottom: 8px;
  }
  .tn-ai-icon {
    color: #8b5cf6;
    font-size: 12px;
    line-height: 1;
  }
  .tn-ai-label {
    color: #8b5cf6;
    font-size: 11px;
    font-weight: 600;
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
  }
  .tn-ai-question {
    color: #7c7f85;
    font-size: 11px;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tn-ai-content {
    color: #b4b8c0;
    font-size: 11.5px;
    line-height: 1.6;
    padding-left: 20px;
    margin-bottom: 10px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tn-ai-content code {
    background: #1a1e24;
    padding: 1px 4px;
    border-radius: 2px;
    color: #e5e7eb;
    font-size: 11px;
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
  .tn-ai-commands {
    margin-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tn-ai-cmd-row {
    background: #0a0d0f;
    border-radius: 4px;
    padding: 6px 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid #1e2328;
  }
  .tn-ai-cmd-row code {
    color: #e5e7eb;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .tn-ai-cmd-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .tn-ai-cmd-run {
    color: #22c55e;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(34, 197, 94, 0.06);
  }
  .tn-ai-cmd-run:hover {
    background: rgba(34, 197, 94, 0.15);
  }
  .tn-ai-cmd-skip {
    color: #6b7280;
    font-size: 10px;
    cursor: pointer;
  }
  .tn-ai-cmd-skip:hover {
    color: #9ca3af;
  }
`;
