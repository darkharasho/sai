import { useState, useEffect, useRef } from 'react';
import type { QueuedMessage } from '../../types';
import { ArrowUp, FileText, Image, ListOrdered, Terminal, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

interface MessageQueueProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onPromote: (id: string) => void;
}

export default function MessageQueue({ queue, onRemove, onPromote }: MessageQueueProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverTransition = useReducedMotionTransition(SPRING.pop);
  const badgeTransition = useReducedMotionTransition(SPRING.flick);
  const itemTransition = useReducedMotionTransition(SPRING.gentle);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (queue.length === 0 && open) setOpen(false);
  }, [queue.length, open]);

  if (queue.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.span
        ref={wrapRef}
        key="queue-badge-wrap"
        className="queue-badge-wrap"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={badgeTransition}
      >
        <button
          type="button"
          data-testid="queue-badge"
          className={`queue-badge${open ? ' queue-badge--open' : ''}`}
          onClick={() => setOpen(o => !o)}
          title={open ? undefined : `${queue.length} queued`}
        >
          <ListOrdered size={13} />
          <span className="queue-badge-count">{queue.length} queued</span>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              data-testid="queue-popover"
              className="queue-popover"
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={popoverTransition}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="queue-popover-header">
                <span className="queue-popover-title">Queued messages</span>
                <span className="queue-popover-count">{queue.length}</span>
              </div>
              <ul className="queue-popover-list">
                <AnimatePresence initial={false}>
                  {queue.map((msg, i) => (
                    <motion.li
                      key={msg.id}
                      data-testid="queue-item"
                      className="queue-item"
                      layout
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6, height: 0, paddingTop: 0, paddingBottom: 0 }}
                      transition={itemTransition}
                    >
                      <span className="queue-index">{i + 1}</span>
                      {msg.attachments && (msg.attachments.terminal || msg.attachments.files > 0 || msg.attachments.images > 0) && (
                        <span className="queue-attachments" data-testid="queue-attachments">
                          {msg.attachments.terminal && <Terminal size={11} />}
                          {msg.attachments.files > 0 && <FileText size={11} />}
                          {msg.attachments.images > 0 && (
                            <>
                              <Image size={11} />
                              {msg.attachments.images > 1 && (
                                <span className="queue-attach-count">{msg.attachments.images}</span>
                              )}
                            </>
                          )}
                        </span>
                      )}
                      <span className="queue-text">{msg.text}</span>
                      <span className="queue-actions">
                        {i > 0 && (
                          <button
                            type="button"
                            data-testid="queue-promote"
                            className="queue-action queue-action--promote"
                            title="Move to next"
                            onClick={() => onPromote(msg.id)}
                          >
                            <ArrowUp size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid="queue-remove"
                          className="queue-action queue-action--remove"
                          title="Remove"
                          onClick={() => onRemove(msg.id)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <style>{`
          .queue-badge-wrap {
            position: relative;
            display: inline-flex;
            align-items: center;
          }
          .queue-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px 3px 6px;
            border: none;
            border-radius: 5px;
            background: color-mix(in srgb, var(--accent) 6%, transparent);
            color: var(--accent);
            font-family: inherit;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
          }
          .queue-badge:hover {
            background: color-mix(in srgb, var(--accent) 12%, transparent);
          }
          .queue-badge--open {
            background: color-mix(in srgb, var(--accent) 16%, transparent);
          }
          .queue-badge-count { font-variant-numeric: tabular-nums; }

          .queue-popover {
            position: absolute;
            bottom: calc(100% + 8px);
            left: 0;
            width: 360px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 0;
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
            z-index: 10;
            color: var(--text);
            cursor: default;
          }
          .queue-popover-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-bottom: 1px solid var(--border);
            font-size: 11px;
          }
          .queue-popover-title { font-weight: 600; color: var(--text); }
          .queue-popover-count {
            color: var(--text-muted);
            margin-left: auto;
            font-variant-numeric: tabular-nums;
          }
          .queue-popover-list {
            list-style: none;
            padding: 4px 0;
            margin: 0;
            max-height: 280px;
            overflow-y: auto;
          }
          .queue-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 12px;
            font-size: 12px;
          }
          .queue-item:hover { background: rgba(255, 255, 255, 0.03); }
          .queue-index {
            color: var(--text-muted);
            font-weight: 600;
            font-size: 10px;
            width: 14px;
            flex-shrink: 0;
            font-variant-numeric: tabular-nums;
          }
          .queue-attachments {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            color: var(--accent);
            opacity: 0.6;
            flex-shrink: 0;
          }
          .queue-attach-count { font-size: 9px; margin-left: -1px; }
          .queue-text {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            color: var(--text);
          }
          .queue-actions {
            display: inline-flex;
            gap: 2px;
            flex-shrink: 0;
            opacity: 0;
            transition: opacity 0.15s;
          }
          .queue-item:hover .queue-actions { opacity: 1; }
          .queue-action {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 3px;
            border-radius: 3px;
            display: inline-flex;
            align-items: center;
            transition: color 0.15s, background 0.15s;
          }
          .queue-action:hover { color: var(--text); background: rgba(255, 255, 255, 0.06); }
          .queue-action--promote:hover {
            color: var(--accent);
            background: color-mix(in srgb, var(--accent) 10%, transparent);
          }
          .queue-action--remove:hover {
            color: var(--red);
            background: color-mix(in srgb, var(--red) 10%, transparent);
          }
        `}</style>
      </motion.span>
    </AnimatePresence>
  );
}
