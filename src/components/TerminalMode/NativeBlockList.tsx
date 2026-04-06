import { useRef, useEffect, useState, useCallback } from 'react';
import { Wrench } from 'lucide-react';
import NativeCommandBlock from './NativeCommandBlock';
import InlineAIBlock from './InlineAIBlock';
import ApprovalBlock from './ApprovalBlock';
import type { SegmentedBlock } from './BlockSegmenter';
import type { ApprovalBlock as ApprovalBlockType, ToolApprovalBlock as ToolApprovalBlockType } from './types';

export type DisplayItem =
  | { type: 'command'; block: SegmentedBlock; aiSuggested?: boolean; active?: boolean }
  | { type: 'ai'; id: string; question: string; content: string; suggestedCommands: string[]; streaming: boolean; aiProvider?: 'claude' | 'codex' | 'gemini'; duration?: number }
  | { type: 'approval'; block: ApprovalBlockType }
  | { type: 'tool-approval'; block: ToolApprovalBlockType };

interface NativeBlockListProps {
  items: DisplayItem[];
  activeBlockId: string | null;
  fullWidth?: boolean;
  cwd?: string;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
  onRunSuggested: (command: string) => void;
  onApprove: (block: ApprovalBlockType) => void;
  onReject: (block: ApprovalBlockType) => void;
  onEdit: (block: ApprovalBlockType) => void;
  onToolApprove: (block: ToolApprovalBlockType) => void;
  onToolReject: (block: ToolApprovalBlockType) => void;
  onToolAlwaysAllow: (block: ToolApprovalBlockType) => void;
}

const AUTO_COLLAPSE_THRESHOLD = 10;

export default function NativeBlockList({
  items,
  activeBlockId,
  fullWidth,
  cwd,
  onCopy,
  onAskAI,
  onRerun,
  onRunSuggested,
  onApprove,
  onReject,
  onEdit,
  onToolApprove,
  onToolReject,
  onToolAlwaysAllow,
}: NativeBlockListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Track manual expand/collapse overrides per block ID
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [items]);

  const handleToggleCollapse = useCallback((id: string, currentlyCollapsed: boolean) => {
    if (currentlyCollapsed) {
      // Expand: remove from manualCollapsed, add to manualExpanded
      setManualCollapsed(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setManualExpanded(prev => new Set([...prev, id]));
    } else {
      // Collapse: remove from manualExpanded, add to manualCollapsed
      setManualExpanded(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setManualCollapsed(prev => new Set([...prev, id]));
    }
  }, []);

  // Count command blocks to determine auto-collapse threshold
  const commandBlocks = items.filter(item => item.type === 'command');
  const commandCount = commandBlocks.length;

  function isCollapsed(item: DisplayItem & { type: 'command' }): boolean {
    const id = item.block.id;
    const isActive = item.active || id === activeBlockId;

    // Active block is never collapsed
    if (isActive) return false;

    // Manual collapsed takes priority
    if (manualCollapsed.has(id)) return true;

    // Auto-collapse: find how many command blocks back this one is
    const blockIndex = commandBlocks.findIndex(b => b.type === 'command' && b.block.id === id);
    const distanceFromEnd = commandCount - 1 - blockIndex;
    const autoCollapse = distanceFromEnd >= AUTO_COLLAPSE_THRESHOLD;

    // Auto-collapsed but not manually expanded
    if (autoCollapse && !manualExpanded.has(id)) return true;

    return false;
  }

  return (
    <div className={`tn-block-list${fullWidth ? ' tn-full-width' : ''}`}>
      <div className="tn-spacer" />

      {items.length === 0 && (
        <div className="tn-welcome">
          <div className="tn-welcome-title">Terminal Mode</div>
          <div className="tn-welcome-section">
            <div className="tn-welcome-row">
              <span className="tn-welcome-key">Enter</span> Run shell command
            </div>
            <div className="tn-welcome-row">
              <span className="tn-welcome-key">⌘K</span> Ask AI
            </div>
            <div className="tn-welcome-row">
              <span className="tn-welcome-key">⌘⇧K</span> Collapse/expand all
            </div>
          </div>
          <div className="tn-welcome-hint">Hover a block to copy, ask AI, or rerun</div>
        </div>
      )}

      {items.map((item, i) => {
        if (item.type === 'command') {
          const collapsed = isCollapsed(item);
          const id = item.block.id;
          return (
            <div key={id} style={undefined}>
              <NativeCommandBlock
                block={item.block}
                collapsed={collapsed}
                onToggleCollapse={() => handleToggleCollapse(id, collapsed)}
                active={item.active || id === activeBlockId}
                aiSuggested={item.aiSuggested}
                cwd={cwd}
                onCopy={onCopy}
                onAskAI={onAskAI}
                onRerun={onRerun}
              />
            </div>
          );
        }

        if (item.type === 'ai') {
          return (
            <div key={item.id} style={undefined}>
              <InlineAIBlock
                question={item.question}
                content={item.content}
                suggestedCommands={item.suggestedCommands}
                streaming={item.streaming}
                duration={item.duration}
                aiProvider={item.aiProvider}
                onRunCommand={onRunSuggested}
                onCopy={onCopy}
              />
            </div>
          );
        }

        if (item.type === 'approval') {
          return (
            <div key={item.block.id} style={undefined}>
              <ApprovalBlock
                block={item.block}
                onApprove={onApprove}
                onReject={onReject}
                onEdit={onEdit}
              />
            </div>
          );
        }

        if (item.type === 'tool-approval') {
          const block = item.block;
          return (
            <div key={block.id} style={undefined}>
              <div className={`tm-tool-approval ${block.status !== 'pending' ? 'tm-tool-resolved' : ''}`}>
                <div className="tm-tool-approval-header">
                  <span className="tm-tool-approval-label">
                    <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>
                      <Wrench size={12} />
                    </span>
                    {block.toolName}
                  </span>
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
            </div>
          );
        }

        return null;
      })}

      <div ref={bottomRef} style={{ overflowAnchor: 'auto' }} />

      <style>{`
        .tn-block-list {
          flex: 1;
          min-height: 0;
          padding: 14px 15% 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          transition: padding 0.3s ease;
        }
        .tn-block-list.tn-full-width {
          padding-left: 16px;
          padding-right: 16px;
        }
        .tn-spacer {
          flex: 1 0 0px;
          overflow-anchor: none;
        }
        .tn-welcome {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.8;
          margin-bottom: 16px;
        }
        .tn-welcome-title {
          color: var(--accent);
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .tn-welcome-section {
          margin-bottom: 8px;
        }
        .tn-welcome-row {
          padding-left: 8px;
        }
        .tn-welcome-key {
          color: var(--text);
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 0 4px;
          font-size: 11px;
          margin-right: 8px;
        }
        .tn-welcome-hint {
          padding-left: 8px;
          color: var(--text-muted);
          font-size: 11px;
          margin-top: 4px;
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
