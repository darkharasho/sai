import React from 'react';
import { motion } from 'motion/react';
import { useSeedGrow } from '../../Chat/seedGrow';
import { SPRING, useReducedMotionTransition } from '../../Chat/motion';
import type { ToolCall, SwarmTask } from '../../../types';
import { cardBase, safeJsonParse } from './cardStyles';

interface Props {
  toolCall: ToolCall;
  tasks?: SwarmTask[];
  /** Card is born from the tail thinking row: mount with the grow-in entry. */
  seedGrow?: boolean;
}

export default function PauseResumeCard({ toolCall, tasks = [], seedGrow }: Props) {
  const grow = useSeedGrow(seedGrow);
  const growTransition = useReducedMotionTransition(SPRING.pop);
  const baseName = toolCall.name.replace(/^mcp__swarm__/, '');
  const isPause = baseName === 'pause_task';
  const input = safeJsonParse<any>(toolCall.input) ?? {};
  const ref: string = input.taskRef ?? '';
  const live = tasks.find((t) => t.id === ref || t.title === ref || t.branch === ref);
  const title = live?.title ?? ref ?? 'task';
  return (
    <motion.div
      data-testid={isPause ? 'swarm-pause-card' : 'swarm-resume-card'}
      style={{ ...cardBase, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9, ...(grow ? { overflow: 'hidden' } : null) }}
      initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
      animate={grow ? { height: 'auto', paddingTop: 6, paddingBottom: 6, opacity: 1 } : undefined}
      transition={growTransition}
    >
      <span>{isPause ? '⏸' : '▶'}</span>
      <span>
        {isPause ? 'Paused' : 'Resumed'} "<b>{title}</b>"
      </span>
    </motion.div>
  );
}
