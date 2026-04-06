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
      <div className="tn-ai-header">
        <span className="tn-ai-icon">⬡</span>
        <span className="tn-ai-label">{providerLabel}</span>
        {streaming && <span className="tn-ai-streaming" />}
        {onCopy && content && (
          <button
            className="tn-ai-copy"
            onClick={() => onCopy(content)}
            title="Copy"
          >
            Copy
          </button>
        )}
      </div>

      <div className="tn-ai-question">{question}</div>

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

      {suggestedCommands && suggestedCommands.length > 0 && (
        <div className="tn-ai-commands">
          {suggestedCommands.map((cmd, i) => {
            if (dismissedIndices.has(i)) return null;
            return (
              <div key={i} className="tn-ai-cmd-row">
                <code>{cmd}</code>
                <button
                  className="tn-ai-cmd-run"
                  data-action="run"
                  onClick={() => onRunCommand(cmd)}
                >
                  Run
                </button>
                <button
                  className="tn-ai-cmd-skip"
                  data-action="skip"
                  onClick={() => handleSkip(i)}
                >
                  Skip
                </button>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .tn-ai-block {
          background: #13111e;
          border: 1px solid #2d2454;
          border-radius: 4px;
          overflow: hidden;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
        .tn-ai-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-bottom: 1px solid #2d2454;
        }
        .tn-ai-icon {
          color: #8b5cf6;
          font-size: 14px;
          line-height: 1;
        }
        .tn-ai-label {
          color: #8b5cf6;
          font-size: 11px;
          font-weight: 500;
        }
        .tn-ai-streaming {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #8b5cf6;
          animation: tn-ai-pulse 1.2s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes tn-ai-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
        .tn-ai-copy {
          margin-left: auto;
          background: none;
          border: none;
          color: #8b5cf6;
          font-size: 10px;
          cursor: pointer;
          padding: 2px 6px;
        }
        .tn-ai-question {
          padding: 8px 12px 4px;
          color: #a89ec9;
          font-style: italic;
          font-size: 12px;
          line-height: 1.5;
        }
        .tn-ai-content {
          padding: 4px 12px 10px;
          color: #e2dff0;
          font-size: 12px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .tn-ai-entries {
          padding: 4px 12px 10px;
        }
        .tn-ai-entry-text {
          color: #e2dff0;
          font-size: 12px;
          line-height: 1.6;
          margin-bottom: 4px;
        }
        .tn-ai-entry-tool {
          color: #8b5cf6;
          font-size: 11px;
          margin-bottom: 4px;
        }
        .tn-ai-commands {
          padding: 4px 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tn-ai-cmd-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #0a0d0f;
          padding: 5px 8px;
          border-radius: 4px;
        }
        .tn-ai-cmd-row code {
          flex: 1;
          color: #e2dff0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          white-space: pre;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tn-ai-cmd-run {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
          border: 1px solid rgba(34, 197, 94, 0.3);
          border-radius: 3px;
          padding: 2px 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .tn-ai-cmd-run:hover {
          background: rgba(34, 197, 94, 0.25);
        }
        .tn-ai-cmd-skip {
          background: rgba(107, 114, 128, 0.15);
          color: #6b7280;
          border: 1px solid rgba(107, 114, 128, 0.3);
          border-radius: 3px;
          padding: 2px 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .tn-ai-cmd-skip:hover {
          background: rgba(107, 114, 128, 0.25);
        }
      `}</style>
    </div>
  );
}
