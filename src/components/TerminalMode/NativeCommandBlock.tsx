import { useState } from 'react';
import { Copy, Sparkles, RotateCw } from 'lucide-react';
import type { SegmentedBlock } from './BlockSegmenter';

const LONG_OUTPUT_LINES = 30;

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function extractPromptUser(promptText: string): string {
  // Extract "user@host:path" portion from prompt text like "user@host:~$ "
  const match = promptText.match(/(\S+[@:]\S+)/);
  return match ? match[1] : promptText.trim();
}

interface NativeCommandBlockProps {
  block: SegmentedBlock;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  active?: boolean;
  aiSuggested?: boolean;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
}

export default function NativeCommandBlock({
  block,
  collapsed,
  onToggleCollapse,
  active,
  aiSuggested,
  onCopy,
  onAskAI,
  onRerun,
}: NativeCommandBlockProps) {
  const [showAll, setShowAll] = useState(false);

  const outputLines = block.output ? block.output.split('\n') : [];
  const isLong = outputLines.length > LONG_OUTPUT_LINES;
  const isClamped = isLong && !showAll;

  const promptColor = block.isRemote ? '#f59e0b' : '#22c55e';

  const blockClass = [
    'tn-block',
    collapsed ? 'tn-block-collapsed' : '',
    active ? 'tn-block-active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={blockClass}>
      {/* Header */}
      <div
        className="tn-block-header"
        onClick={() => onToggleCollapse?.()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          {active && <span className="tn-active-dot" />}
          <span
            className="tn-prompt"
            style={{ color: promptColor }}
            data-color={promptColor}
          >
            {extractPromptUser(block.promptText)}
          </span>
          <span className="tn-command">{block.command}</span>
          {aiSuggested && (
            <span className="tn-via-ai">via AI</span>
          )}
        </div>

        <div className="tn-block-actions" onClick={(e) => e.stopPropagation()}>
          <span className="tn-icon" title="Copy output" onClick={() => onCopy(block.output)}>
            <Copy size={11} />
          </span>
          <span className="tn-icon" title="Ask AI" onClick={() => onAskAI(block)}>
            <Sparkles size={11} />
          </span>
          <span className="tn-icon" title="Rerun" onClick={() => onRerun(block.command)}>
            <RotateCw size={11} />
          </span>
          <span className="tn-duration">{formatDuration(block.duration)}</span>
        </div>
      </div>

      {/* Output — hidden when collapsed */}
      {!collapsed && block.output && (
        <>
          <div
            className={`tn-block-output${isClamped ? ' tn-block-output-clamped' : ''}`}
            style={isClamped ? { maxHeight: '300px', overflowY: 'hidden' } : undefined}
          >
            {block.output}
          </div>
          {isLong && (
            <div
              className="tn-block-show-all"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show less' : `Show all (${outputLines.length} lines)`}
            </div>
          )}
        </>
      )}

      <style>{`
        .tn-block {
          background: #111417;
          border: 1px solid #1a1e24;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }
        .tn-block-collapsed {
          opacity: 0.6;
        }
        .tn-block-active {
          border-color: #22c55e;
        }
        .tn-block-header {
          padding: 6px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          user-select: none;
          gap: 8px;
        }
        .tn-prompt {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          flex-shrink: 0;
        }
        .tn-command {
          color: #e6edf3;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tn-via-ai {
          font-size: 10px;
          color: #a78bfa;
          background: rgba(139, 92, 246, 0.15);
          padding: 1px 5px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .tn-block-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          opacity: 0;
          transition: opacity 0.15s;
          flex-shrink: 0;
        }
        .tn-block:hover .tn-block-actions {
          opacity: 1;
        }
        .tn-icon {
          color: #6e7681;
          cursor: pointer;
          display: flex;
          align-items: center;
          transition: color 0.15s;
        }
        .tn-icon:hover {
          color: #e6edf3;
        }
        .tn-duration {
          font-size: 10px;
          color: #6e7681;
          font-family: 'JetBrains Mono', monospace;
        }
        .tn-block-output {
          padding: 8px 10px;
          font-family: 'JetBrains Mono', monospace;
          color: #8b949e;
          font-size: 11px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-all;
          border-left: 2px solid #1e2328;
        }
        .tn-block-show-all {
          padding: 4px 10px;
          font-size: 10px;
          color: #58a6ff;
          cursor: pointer;
          font-family: 'JetBrains Mono', monospace;
        }
        .tn-block-show-all:hover {
          text-decoration: underline;
        }
        .tn-active-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22c55e;
          flex-shrink: 0;
          animation: tn-pulse 1.5s ease-in-out infinite;
        }
        @keyframes tn-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
