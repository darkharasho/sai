import React from 'react';
import { motion } from 'motion/react';
import { useSeedGrow } from '../../Chat/seedGrow';
import { SPRING, useReducedMotionTransition } from '../../Chat/motion';
import type { ToolCall } from '../../../types';
import { cardBase, safeJsonParse } from './cardStyles';

interface Props {
  toolCall: ToolCall;
  /** Card is born from the tail thinking row: mount with the grow-in entry. */
  seedGrow?: boolean;
}

export default function DiscardCard({ toolCall, seedGrow }: Props) {
  const grow = useSeedGrow(seedGrow);
  const growTransition = useReducedMotionTransition(SPRING.pop);
  const input = safeJsonParse<any>(toolCall.input) ?? {};
  const branch: string = input.branch ?? input.taskRef ?? 'branch';
  return (
    <motion.div
      data-testid="swarm-discard-card"
      style={{ ...cardBase, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9, ...(grow ? { overflow: 'hidden' } : null) }}
      initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
      animate={grow ? { height: 'auto', paddingTop: 6, paddingBottom: 6, opacity: 1 } : undefined}
      transition={growTransition}
    >
      <span>🗑</span>
      <span>
        Discarded{' '}
        <code style={{ fontFamily: "'Geist Mono', monospace", background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>
          {branch}
        </code>
      </span>
    </motion.div>
  );
}
