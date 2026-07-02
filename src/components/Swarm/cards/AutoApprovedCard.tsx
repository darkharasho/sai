import React from 'react';
import { motion } from 'motion/react';
import { useSeedGrow } from '../../Chat/seedGrow';
import { SPRING, useReducedMotionTransition } from '../../Chat/motion';
import type { ToolCall } from '../../../types';
import { safeJsonParse } from './cardStyles';

interface Input {
  taskTitle?: string;
  toolName?: string;
  branch?: string;
}

interface Props {
  toolCall: ToolCall;
  /** Card is born from the tail thinking row: mount with the grow-in entry. */
  seedGrow?: boolean;
}

export default function AutoApprovedCard({ toolCall, seedGrow }: Props) {
  const grow = useSeedGrow(seedGrow);
  const growTransition = useReducedMotionTransition(SPRING.pop);
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  return (
    <motion.div
      data-testid="swarm-auto-approved-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        margin: '2px 0',
        fontSize: 10,
        color: 'var(--text-muted)',
        opacity: 0.65,
        fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
        ...(grow ? { overflow: 'hidden' } : null),
      }}
      initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
      animate={grow ? { height: 'auto', paddingTop: 3, paddingBottom: 3, opacity: 1 } : undefined}
      transition={growTransition}
    >
      <span style={{ color: '#3a8' }}>✓</span>
      <span>auto-approved</span>
      {input.toolName && (
        <span style={{ color: 'var(--text)' }}>{input.toolName}</span>
      )}
      {input.taskTitle && (
        <span style={{ opacity: 0.7 }}>· {input.taskTitle}</span>
      )}
      {input.branch && (
        <span style={{ opacity: 0.5 }}>· {input.branch}</span>
      )}
    </motion.div>
  );
}
