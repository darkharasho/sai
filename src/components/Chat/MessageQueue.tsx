import type { QueuedMessage } from '../../types';
import { X, Image, FileText, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SPRING, STAGGER, useReducedMotionTransition } from './motion';

interface MessageQueueProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
}

export default function MessageQueue({ queue, onRemove }: MessageQueueProps) {
  const chipTransition = useReducedMotionTransition(SPRING.gentle);

  if (queue.length === 0) return null;

  return (
    <div data-testid="queue-stagger" data-cadence-ms={String(STAGGER.tight)} className="message-queue">
      <AnimatePresence initial={false}>
        {queue.map((msg, i) => (
          <motion.div
            key={msg.id}
            data-testid="queue-chip"
            data-transition={JSON.stringify(chipTransition)}
            className="message-queue-card"
            layout
            initial={{ opacity: 0, x: -6, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, x: 0, height: 28, marginTop: i === 0 ? 0 : 3 }}
            exit={{ opacity: 0, x: -6, height: 0, marginTop: 0 }}
            transition={{ ...chipTransition, delay: (i * STAGGER.tight) / 1000 }}
          >
            <span className="message-queue-accent" />
            <span className="message-queue-index">{i + 1}</span>
            {msg.attachments && (
              <span className="message-queue-attachments">
                {msg.attachments.terminal && <Terminal size={11} />}
                {msg.attachments.files > 0 && <FileText size={11} />}
                {msg.attachments.images > 0 && <><Image size={11} />{msg.attachments.images > 1 && <span className="message-queue-attach-count">{msg.attachments.images}</span>}</>}
              </span>
            )}
            <span className="message-queue-text">{msg.text}</span>
            <button
              className="message-queue-remove"
              title="Remove from queue"
              onClick={() => onRemove(msg.id)}
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <style>{`
        .message-queue {
          display: flex;
          flex-direction: column;
          padding: 0 15% 6px;
          flex-shrink: 0;
        }
        .message-queue-card {
          display: flex;
          align-items: center;
          background: rgba(199, 145, 12, 0.04);
          border: 1px solid rgba(199, 145, 12, 0.1);
          border-radius: 8px;
          padding: 0 10px 0 0;
          font-size: 12px;
          color: var(--text-muted);
          overflow: hidden;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .message-queue-card:hover {
          background: rgba(199, 145, 12, 0.08);
          border-color: rgba(199, 145, 12, 0.18);
        }
        .message-queue-accent {
          width: 3px;
          align-self: stretch;
          background: var(--accent);
          opacity: 0.4;
          border-radius: 3px 0 0 3px;
          flex-shrink: 0;
          margin-right: 8px;
          transition: opacity 0.15s ease;
        }
        .message-queue-card:hover .message-queue-accent {
          opacity: 0.7;
        }
        .message-queue-index {
          opacity: 0.35;
          font-size: 10px;
          font-weight: 600;
          min-width: 12px;
          flex-shrink: 0;
          margin-right: 6px;
          font-variant-numeric: tabular-nums;
        }
        .message-queue-attachments {
          display: flex;
          align-items: center;
          gap: 3px;
          margin-right: 8px;
          color: var(--accent);
          opacity: 0.55;
          flex-shrink: 0;
        }
        .message-queue-card:hover .message-queue-attachments {
          opacity: 0.8;
        }
        .message-queue-attach-count {
          font-size: 10px;
          margin-left: -1px;
        }
        .message-queue-text {
          flex: 1;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          min-width: 0;
          letter-spacing: 0.01em;
        }
        .message-queue-remove {
          margin-left: 8px;
          opacity: 0;
          cursor: pointer;
          background: none;
          border: none;
          color: var(--text-muted);
          padding: 2px;
          display: flex;
          align-items: center;
          flex-shrink: 0;
          border-radius: 4px;
          transition: all 0.15s ease;
        }
        .message-queue-card:hover .message-queue-remove {
          opacity: 0.5;
        }
        .message-queue-remove:hover {
          opacity: 1 !important;
          color: var(--accent-hover);
          background: rgba(199, 145, 12, 0.1);
        }
      `}</style>
    </div>
  );
}
