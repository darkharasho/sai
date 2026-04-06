import { useState } from 'react';
import type { SegmentedBlock } from './BlockSegmenter';

const LONG_OUTPUT_LINES = 30;

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function extractPromptParts(promptText: string): { user: string; path: string } {
  // Try to extract "user" and "~/path" from prompt text
  const match = promptText.match(/^(\S+?)[@:]?\s*(~[^\s$#%]*|\/[^\s$#%]*)/);
  if (match) return { user: match[1], path: match[2] };
  // Fallback: just use the whole prompt
  const clean = promptText.replace(/[\$#%>\s]+$/, '').trim();
  return { user: clean, path: '' };
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

  const { user, path } = extractPromptParts(block.promptText);
  const isRemote = block.isRemote;

  if (collapsed) {
    return (
      <div className="tn-block-collapsed" onClick={() => onToggleCollapse?.()}>
        <div className="tn-block-collapsed-inner">
          <div>
            <span className="tn-chevron">▶</span>
            <span className="tn-user" style={{ color: isRemote ? '#f59e0b' : '#22c55e' }} data-color={isRemote ? '#f59e0b' : '#22c55e'}>{user}</span>
            {path && <span className="tn-path">{` ${path}`}</span>}
            {' '}<span className="tn-dollar">$</span>{' '}
            <span className="tn-cmd-collapsed">{block.command}</span>
          </div>
          <span className="tn-duration-dim">{formatDuration(block.duration)}</span>
        </div>

        <style>{collapsedStyles}</style>
      </div>
    );
  }

  return (
    <div className={`tn-block ${active ? 'tn-block-active' : ''}`}>
      <div className="tn-block-header" onClick={() => onToggleCollapse?.()}>
        <div>
          <span className="tn-chevron">▼</span>
          <span className="tn-user" style={{ color: isRemote ? '#f59e0b' : '#22c55e' }} data-color={isRemote ? '#f59e0b' : '#22c55e'}>{user}</span>
          {path && <span className="tn-path">{` ${path}`}</span>}
          {' '}<span className="tn-dollar">$</span>{' '}
          <span className="tn-cmd">{block.command}</span>
          {aiSuggested && <span className="tn-via-ai">via AI</span>}
        </div>
        <div className="tn-header-right">
          {active && <span className="tn-active-dot" />}
          <span className="tn-duration-dim">{formatDuration(block.duration)}</span>
        </div>
      </div>

      {block.output && (
        <>
          <div
            className={`tn-block-output${isClamped ? ' tn-block-output-clamped' : ''}`}
            style={isClamped ? { maxHeight: '300px', overflowY: 'hidden' } : undefined}
          >
            {block.output}
          </div>
          {isLong && (
            <div className="tn-block-show-all" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show less' : `Show all (${outputLines.length} lines)`}
            </div>
          )}
        </>
      )}

      <style>{expandedStyles}</style>
    </div>
  );
}

const collapsedStyles = `
  .tn-block-collapsed {
    margin-bottom: 8px;
  }
  .tn-block-collapsed-inner {
    background: #111417;
    border-radius: 5px;
    padding: 7px 11px;
    border: 1px solid #161a1e;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    opacity: 0.6;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
  }
  .tn-block-collapsed-inner:hover {
    opacity: 0.8;
  }
  .tn-chevron {
    color: #4b5563;
    font-size: 10px;
    margin-right: 6px;
  }
  .tn-user {
    font-size: 12px;
  }
  .tn-path {
    color: #3b82f6;
    font-size: 12px;
  }
  .tn-dollar {
    color: #4b5563;
  }
  .tn-cmd-collapsed {
    color: #9ca3af;
  }
  .tn-duration-dim {
    color: #4b5563;
    font-size: 10px;
    flex-shrink: 0;
  }
`;

const expandedStyles = `
  .tn-block {
    background: #111417;
    border-radius: 5px;
    padding: 10px 11px;
    border: 1px solid #1a1e24;
    margin-bottom: 10px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
  }
  .tn-block-active {
    border-color: #22c55e40;
  }
  .tn-block-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    cursor: pointer;
    user-select: none;
  }
  .tn-chevron {
    color: #4b5563;
    font-size: 10px;
    margin-right: 6px;
  }
  .tn-user {
    font-size: 12px;
  }
  .tn-path {
    color: #3b82f6;
    font-size: 12px;
  }
  .tn-dollar {
    color: #4b5563;
  }
  .tn-cmd {
    color: #e5e7eb;
  }
  .tn-via-ai {
    color: #8b5cf6;
    font-size: 9px;
    margin-left: 6px;
    opacity: 0.5;
  }
  .tn-header-right {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }
  .tn-exit {
    font-size: 10px;
  }
  .tn-duration-dim {
    color: #4b5563;
    font-size: 10px;
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
  .tn-block-output {
    color: #9ca3af;
    font-size: 11px;
    line-height: 1.6;
    border-left: 2px solid #1e2328;
    margin-left: 8px;
    padding-left: 10px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .tn-block-show-all {
    margin-left: 8px;
    padding-left: 10px;
    padding-top: 4px;
    font-size: 10px;
    color: #58a6ff;
    cursor: pointer;
  }
  .tn-block-show-all:hover {
    text-decoration: underline;
  }
`;
