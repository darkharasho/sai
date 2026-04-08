import { Check, X, Pencil } from 'lucide-react';
import type { ApprovalBlock as ApprovalBlockType } from './types';

interface ApprovalBlockProps {
  block: ApprovalBlockType;
  onApprove: (block: ApprovalBlockType) => void;
  onReject: (block: ApprovalBlockType) => void;
  onEdit: (block: ApprovalBlockType) => void;
}

export default function ApprovalBlock({ block, onApprove, onReject, onEdit }: ApprovalBlockProps) {
  const isPending = block.status === 'pending';

  return (
    <div className={`tm-approval-block ${block.status !== 'pending' ? 'tm-approval-resolved' : ''}`}>
      <div className="tm-approval-content">
        <div className="tm-approval-command">
          <span className="tm-approval-prompt">{'\u276F'}</span> {block.command}
        </div>
        {isPending && (
          <div className="tm-approval-actions">
            <span className="tm-icon" title="Edit" onClick={() => onEdit(block)}>
              <Pencil size={11} />
            </span>
            <span className="tm-approval-divider">{'\u2502'}</span>
            <span className="tm-approval-approve" title="Approve" onClick={() => onApprove(block)}>
              <Check size={11} />
              approve
            </span>
            <span className="tm-approval-reject" title="Reject" onClick={() => onReject(block)}>
              <X size={11} />
              reject
            </span>
          </div>
        )}
      </div>

      <style>{`
        .tm-approval-block {
          border: 1px solid var(--border);
          border-radius: 4px;
          overflow: hidden;
        }
        .tm-approval-resolved {
          opacity: 0.5;
        }
        .tm-approval-content {
          background: var(--bg);
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tm-approval-command {
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text);
          flex: 1;
        }
        .tm-approval-prompt {
          color: var(--accent);
          opacity: 0.8;
        }
        .tm-approval-actions {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-shrink: 0;
        }
        .tm-approval-divider {
          color: var(--border);
        }
        .tm-approval-approve {
          color: var(--green);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 2px 8px;
          border: 1px solid rgba(63, 185, 80, 0.2);
          border-radius: 3px;
          font-size: 10px;
        }
        .tm-approval-approve:hover {
          border-color: rgba(63, 185, 80, 0.4);
        }
        .tm-approval-reject {
          color: var(--red);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          opacity: 0.5;
          font-size: 10px;
        }
        .tm-approval-reject:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
