import { Copy, Sparkles, RotateCw } from 'lucide-react';
import type { CommandBlock as CommandBlockType } from './types';

interface CommandBlockProps {
  block: CommandBlockType;
  onCopy: (text: string) => void;
  onAskAI: (block: CommandBlockType) => void;
  onRerun: (command: string) => void;
  isGrouped?: 'first' | 'middle' | 'last' | 'only';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function CommandBlock({ block, onCopy, onAskAI, onRerun, isGrouped }: CommandBlockProps) {
  const isRunning = block.exitCode === null;
  const isSuccess = block.exitCode === 0;
  const isFail = block.exitCode !== null && block.exitCode !== 0;

  const borderRadius = isGrouped === 'first' ? '4px 4px 0 0'
    : isGrouped === 'middle' ? '0'
    : isGrouped === 'last' ? '0 0 4px 4px'
    : '4px';

  const borderColor = isFail ? 'rgba(248, 81, 73, 0.27)' : 'var(--border)';
  const showTopSeparator = isGrouped === 'middle' || isGrouped === 'last';

  return (
    <div style={{
      border: `1px solid ${borderColor}`,
      borderRadius,
      overflow: 'hidden',
      ...(showTopSeparator ? { borderTop: '1px solid var(--bg-hover)' } : {}),
    }}>
      {/* Command row */}
      <div className="tm-block-header">
        <span className="tm-command-text">$ {block.command}</span>
        <div className="tm-block-actions">
          <span className="tm-icon" title="Copy output" onClick={() => onCopy(block.output)}>
            <Copy size={11} />
          </span>
          <span className="tm-icon" title="Ask AI" onClick={() => onAskAI(block)}>
            <Sparkles size={11} />
          </span>
          <span className="tm-icon" title="Rerun" onClick={() => onRerun(block.command)}>
            <RotateCw size={11} />
          </span>
          {isRunning && <span className="tm-status tm-status-running">running</span>}
          {isSuccess && <span className="tm-status tm-status-success">{'\u2713'} {formatDuration(block.duration!)}</span>}
          {isFail && <span className="tm-status tm-status-fail">{'\u2717'} exit {block.exitCode}</span>}
        </div>
      </div>

      {/* Output */}
      {block.output && (
        <div className="tm-block-output">
          {block.output}
        </div>
      )}

      <style>{`
        .tm-block-header {
          background: var(--bg);
          padding: 6px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--bg-hover);
        }
        .tm-command-text {
          color: #58a6ff;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
        .tm-block-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tm-icon {
          color: var(--text-muted);
          opacity: 0.4;
          cursor: pointer;
          display: flex;
          align-items: center;
          transition: opacity 0.15s, color 0.15s;
        }
        .tm-icon:hover {
          opacity: 1;
          color: var(--text);
        }
        .tm-status {
          font-size: 10px;
          margin-left: 4px;
        }
        .tm-status-running {
          color: var(--accent);
        }
        .tm-status-success {
          color: var(--green);
        }
        .tm-status-fail {
          color: var(--red);
        }
        .tm-block-output {
          background: var(--bg);
          padding: 8px 10px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-all;
        }
      `}</style>
    </div>
  );
}
