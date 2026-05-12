import React from 'react';
import type { ToolCall, SwarmTask } from '../../../types';
import { cardBase, safeJsonParse } from './cardStyles';

interface Props {
  toolCall: ToolCall;
  tasks?: SwarmTask[];
}

export default function PauseResumeCard({ toolCall, tasks = [] }: Props) {
  const baseName = toolCall.name.replace(/^mcp__swarm__/, '');
  const isPause = baseName === 'pause_task';
  const input = safeJsonParse<any>(toolCall.input) ?? {};
  const ref: string = input.taskRef ?? '';
  const live = tasks.find((t) => t.id === ref || t.title === ref || t.branch === ref);
  const title = live?.title ?? ref ?? 'task';
  return (
    <div
      data-testid={isPause ? 'swarm-pause-card' : 'swarm-resume-card'}
      style={{ ...cardBase, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9 }}
    >
      <span>{isPause ? '⏸' : '▶'}</span>
      <span>
        {isPause ? 'Paused' : 'Resumed'} "<b>{title}</b>"
      </span>
    </div>
  );
}
