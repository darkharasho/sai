import { useRef, useEffect } from 'react';
import { Wrench } from 'lucide-react';
import CommandBlock from './CommandBlock';
import AIResponseBlock from './AIResponseBlock';
import ApprovalBlock from './ApprovalBlock';
import type { Block, CommandBlock as CommandBlockType, AIResponseBlock as AIResponseBlockType, ApprovalBlock as ApprovalBlockType, ToolApprovalBlock as ToolApprovalBlockType } from './types';

interface TerminalModeBlockListProps {
  blocks: Block[];
  aiProvider?: 'claude' | 'codex' | 'gemini';
  onCopy: (text: string) => void;
  onAskAI: (block: CommandBlockType) => void;
  onRerun: (command: string) => void;
  onApprove: (block: ApprovalBlockType) => void;
  onReject: (block: ApprovalBlockType) => void;
  onEdit: (block: ApprovalBlockType) => void;
  onToolApprove: (block: ToolApprovalBlockType) => void;
  onToolReject: (block: ToolApprovalBlockType) => void;
  onToolAlwaysAllow: (block: ToolApprovalBlockType) => void;
  fullWidth?: boolean;
  shrink?: boolean;
}

/** Determine the group position of a command block for connected rendering. */
function getGroupPosition(blocks: Block[], index: number): 'first' | 'middle' | 'last' | 'only' {
  const block = blocks[index];
  if (block.type !== 'command' || !block.groupId) return 'only';

  const prev = index > 0 ? blocks[index - 1] : null;
  const next = index < blocks.length - 1 ? blocks[index + 1] : null;
  const prevSameGroup = prev?.type === 'command' && prev.groupId === block.groupId;
  const nextSameGroup = next?.type === 'command' && next.groupId === block.groupId;

  if (!prevSameGroup && nextSameGroup) return 'first';
  if (prevSameGroup && nextSameGroup) return 'middle';
  if (prevSameGroup && !nextSameGroup) return 'last';
  return 'only';
}

/** Determine connector color based on block relationships. */
function getConnectorColor(block: Block): string | null {
  if (block.type === 'ai-prompt') return 'rgba(163, 113, 247, 0.27)';
  if (block.type === 'ai-response') return 'rgba(163, 113, 247, 0.27)';
  if (block.type === 'approval') return 'rgba(210, 153, 34, 0.2)';
  if (block.type === 'tool-approval') return 'rgba(163, 113, 247, 0.27)';
  return null;
}

export default function TerminalModeBlockList({
  blocks, aiProvider = 'claude', onCopy, onAskAI, onRerun, onApprove, onReject, onEdit,
  onToolApprove, onToolReject, onToolAlwaysAllow, fullWidth, shrink,
}: TerminalModeBlockListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [blocks]);


  return (
    <div className={`tm-block-list ${fullWidth ? 'tm-full-width' : ''} ${shrink ? 'tm-block-list-shrink' : ''}`} ref={listRef}>
      <div className="tm-spacer" />
      <div className="tm-welcome">
        <div className="tm-welcome-title">Terminal Mode</div>
        <div className="tm-welcome-section">
          <div className="tm-welcome-heading">Commands</div>
          <div className="tm-welcome-row"><span className="tm-welcome-key">Enter</span> Run shell command</div>
          <div className="tm-welcome-row"><span className="tm-welcome-key">Shift+Tab</span> Toggle AI mode</div>
        </div>
        <div className="tm-welcome-section">
          <div className="tm-welcome-heading">Block Actions</div>
          <div className="tm-welcome-row"><span className="tm-welcome-icon">Copy</span> Copy output to clipboard</div>
          <div className="tm-welcome-row"><span className="tm-welcome-icon">Sparkles</span> Ask AI about command output</div>
          <div className="tm-welcome-row"><span className="tm-welcome-icon">Rerun</span> Re-execute command</div>
        </div>
      </div>

      {blocks.map((block, i) => {
        const connectorColor = i > 0 ? getConnectorColor(block) : null;
        const needsGap = i > 0 && !connectorColor
          && !(block.type === 'command' && block.groupId
            && blocks[i - 1]?.type === 'command'
            && (blocks[i - 1] as CommandBlockType).groupId === block.groupId);

        return (
          <div key={block.id}>
            {connectorColor && (
              <div className="tm-connector" style={{ borderColor: connectorColor }} />
            )}
            {needsGap && <div style={{ height: 12 }} />}

            {block.type === 'command' && (
              <CommandBlock
                block={block}
                onCopy={onCopy}
                onAskAI={onAskAI}
                onRerun={onRerun}
                isGrouped={getGroupPosition(blocks, i)}
              />
            )}
            {block.type === 'ai-prompt' && (
              <div className="tm-ai-prompt">
                <span className="tm-ai-prompt-icon">✦</span>
                {block.content}
              </div>
            )}
            {block.type === 'ai-response' && (
              <AIResponseBlock block={block} onCopy={onCopy} aiProvider={aiProvider} />
            )}
            {block.type === 'approval' && (
              <ApprovalBlock block={block} onApprove={onApprove} onReject={onReject} onEdit={onEdit} />
            )}
            {block.type === 'tool-approval' && (
              <div className={`tm-tool-approval ${block.status !== 'pending' ? 'tm-tool-resolved' : ''}`}>
                <div className="tm-tool-approval-header">
                  <span className="tm-tool-approval-label"><span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}><Wrench size={12} /></span>{block.toolName}</span>
                  {block.status === 'approved' && <span className="tm-tool-status tm-tool-approved">✓ allowed</span>}
                  {block.status === 'rejected' && <span className="tm-tool-status tm-tool-rejected">✗ denied</span>}
                </div>
                <div className="tm-tool-approval-command">{block.command}</div>
                {block.status === 'pending' && (
                  <div className="tm-tool-approval-actions">
                    <button className="tm-tool-btn tm-tool-btn-approve" onClick={() => onToolApprove(block)}>Allow</button>
                    <button className="tm-tool-btn tm-tool-btn-always" onClick={() => onToolAlwaysAllow(block)}>Always allow</button>
                    <button className="tm-tool-btn tm-tool-btn-deny" onClick={() => onToolReject(block)}>Deny</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} style={{ overflowAnchor: 'auto' }} />

      <style>{`
        .tm-block-list {
          flex: 1;
          min-height: 0;
          padding: 16px 15% 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          transition: padding 0.3s ease;
        }
        .tm-block-list.tm-full-width {
          padding-left: 16px;
          padding-right: 16px;
        }
        .tm-block-list.tm-block-list-shrink {
          flex: 0;
          max-height: 30%;
        }
        .tm-spacer {
          flex: 1 0 0px;
          overflow-anchor: none;
        }
        .tm-connector {
          border-left: 2px solid;
          margin-left: 16px;
          height: 8px;
        }
        .tm-welcome {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.8;
          margin-bottom: 16px;
        }
        .tm-welcome-title {
          color: var(--accent);
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .tm-welcome-section {
          margin-bottom: 8px;
        }
        .tm-welcome-heading {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .tm-welcome-row {
          padding-left: 8px;
        }
        .tm-welcome-key {
          color: var(--text);
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 0 4px;
          font-size: 11px;
          margin-right: 8px;
        }
        .tm-welcome-icon {
          color: var(--text-muted);
          margin-right: 8px;
        }
        .tm-ai-prompt {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text);
          padding: 8px 12px;
          border: 1px solid rgba(163, 113, 247, 0.2);
          border-radius: 4px;
          background: var(--bg-secondary);
        }
        .tm-ai-prompt-icon {
          color: #a371f7;
          margin-right: 8px;
        }
        .tm-tool-approval {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          border: 1px solid rgba(163, 113, 247, 0.3);
          border-radius: 4px;
          background: var(--bg-secondary);
          overflow: hidden;
        }
        .tm-tool-resolved {
          opacity: 0.6;
        }
        .tm-tool-approval-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          border-bottom: 1px solid rgba(163, 113, 247, 0.13);
        }
        .tm-tool-approval-label {
          color: #a371f7;
          font-weight: 500;
          font-size: 11px;
        }
        .tm-tool-status {
          font-size: 10px;
          font-weight: 500;
        }
        .tm-tool-approved { color: var(--green); }
        .tm-tool-rejected { color: var(--red); }
        .tm-tool-approval-command {
          padding: 6px 10px;
          color: var(--text);
          word-break: break-all;
        }
        .tm-tool-approval-actions {
          display: flex;
          gap: 6px;
          padding: 6px 10px 8px;
          border-top: 1px solid rgba(163, 113, 247, 0.13);
        }
        .tm-tool-btn {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 3px;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text);
          cursor: pointer;
        }
        .tm-tool-btn:hover { background: var(--bg-hover); }
        .tm-tool-btn-approve { border-color: var(--green); color: var(--green); }
        .tm-tool-btn-approve:hover { background: rgba(63, 185, 80, 0.15); }
        .tm-tool-btn-always { border-color: #a371f7; color: #a371f7; }
        .tm-tool-btn-always:hover { background: rgba(163, 113, 247, 0.15); }
        .tm-tool-btn-deny { border-color: var(--red); color: var(--red); }
        .tm-tool-btn-deny:hover { background: rgba(248, 81, 73, 0.15); }
      `}</style>
    </div>
  );
}
