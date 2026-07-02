import React from 'react';
import { motion } from 'motion/react';
import { useSeedGrow } from '../../Chat/seedGrow';
import { SPRING, useReducedMotionTransition } from '../../Chat/motion';
import type { ToolCall, SwarmTask, SwarmApproval } from '../../../types';
import { cardBase, safeJsonParse, SWARM_GREEN, SWARM_RED } from './cardStyles';

interface Props {
  toolCall: ToolCall;
  tasks?: SwarmTask[];
  approvals?: SwarmApproval[];
  /** Card is born from the tail thinking row: mount with the grow-in entry. */
  seedGrow?: boolean;
}

export default function ApprovalActionCard({ toolCall, tasks = [], approvals = [], seedGrow }: Props) {
  const grow = useSeedGrow(seedGrow);
  const growTransition = useReducedMotionTransition(SPRING.pop);
  const baseName = toolCall.name.replace(/^mcp__swarm__/, '');
  const isApprove = baseName === 'approve_tool_call';
  const input = safeJsonParse<any>(toolCall.input) ?? {};
  const approvalId: string = input.approvalId ?? '';
  const approval = approvals.find((a) => a.id === approvalId);
  const tool = approval?.toolName ?? 'tool';
  const task = approval ? tasks.find((t) => t.id === approval.taskId) : undefined;
  const taskLabel = task?.title ?? (approval?.taskId ?? 'task');
  const color = isApprove ? SWARM_GREEN : SWARM_RED;
  return (
    <motion.div
      data-testid={isApprove ? 'swarm-approve-action-card' : 'swarm-deny-action-card'}
      style={{ ...cardBase, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, ...(grow ? { overflow: 'hidden' } : null) }}
      initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
      animate={grow ? { height: 'auto', paddingTop: 6, paddingBottom: 6, opacity: 1 } : undefined}
      transition={growTransition}
    >
      <span style={{ color }}>{isApprove ? '✓' : '✗'}</span>
      <span>
        {isApprove ? 'Approved' : 'Denied'}{' '}
        <code style={{ fontFamily: "'Geist Mono', monospace", background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>
          {tool}
        </code>{' '}
        on <b>{taskLabel}</b>
      </span>
    </motion.div>
  );
}
