import { useRef, useEffect } from 'react';
import CommandBlock from './CommandBlock';
import AIResponseBlock from './AIResponseBlock';
import ApprovalBlock from './ApprovalBlock';
import type { Block, CommandBlock as CommandBlockType, AIResponseBlock as AIResponseBlockType, ApprovalBlock as ApprovalBlockType } from './types';

interface TerminalModeBlockListProps {
  blocks: Block[];
  onCopy: (text: string) => void;
  onAskAI: (block: CommandBlockType) => void;
  onRerun: (command: string) => void;
  onApprove: (block: ApprovalBlockType) => void;
  onReject: (block: ApprovalBlockType) => void;
  onEdit: (block: ApprovalBlockType) => void;
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
  if (block.type === 'ai-response') return 'rgba(163, 113, 247, 0.27)';
  if (block.type === 'approval') return 'rgba(210, 153, 34, 0.2)';
  return null;
}

export default function TerminalModeBlockList({
  blocks, onCopy, onAskAI, onRerun, onApprove, onReject, onEdit,
}: TerminalModeBlockListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks.length]);

  return (
    <div className="tm-block-list">
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
            {block.type === 'ai-response' && (
              <AIResponseBlock block={block} onCopy={onCopy} />
            )}
            {block.type === 'approval' && (
              <ApprovalBlock block={block} onApprove={onApprove} onReject={onReject} onEdit={onEdit} />
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />

      <style>{`
        .tm-block-list {
          flex: 1;
          padding: 16px 15% 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .tm-connector {
          border-left: 2px solid;
          margin-left: 16px;
          height: 8px;
        }
      `}</style>
    </div>
  );
}
