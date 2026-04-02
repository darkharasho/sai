import type { QueuedMessage } from '../../types';
import { X } from 'lucide-react';

interface MessageQueueProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
}

export default function MessageQueue({ queue, onRemove }: MessageQueueProps) {
  if (queue.length === 0) return null;

  return (
    <div className="message-queue">
      {queue.map((msg, i) => (
        <div key={msg.id} className="message-queue-card">
          <span className="message-queue-index">{i + 1}.</span>
          <span className="message-queue-text">{msg.text}</span>
          <button
            className="message-queue-remove"
            title="Remove from queue"
            onClick={() => onRemove(msg.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <style>{`
        .message-queue {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0 8px 4px;
          flex-shrink: 0;
        }
        .message-queue-card {
          display: flex;
          align-items: center;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 12px;
          height: 24px;
          color: var(--text-secondary, #c4c4e0);
        }
        .message-queue-index {
          opacity: 0.4;
          margin-right: 6px;
          font-size: 11px;
          min-width: 14px;
          flex-shrink: 0;
        }
        .message-queue-text {
          flex: 1;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .message-queue-remove {
          margin-left: 8px;
          opacity: 0.35;
          cursor: pointer;
          background: none;
          border: none;
          color: inherit;
          padding: 0 2px;
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .message-queue-remove:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
