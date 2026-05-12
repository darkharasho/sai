import React from 'react';
import type { ToolCall, SwarmTask, SwarmApproval } from '../../../types';
import SpawnTaskCard from './SpawnTaskCard';
import QueryStatusCard from './QueryStatusCard';
import LandCard from './LandCard';
import DiscardCard from './DiscardCard';
import PauseResumeCard from './PauseResumeCard';
import ApprovalActionCard from './ApprovalActionCard';

interface Props {
  toolCall: ToolCall;
  expanded?: boolean;
  tasks?: SwarmTask[];
  approvals?: SwarmApproval[];
  onFocusTask?: (taskId: string) => void;
  onRebaseRetry?: (taskRef: string) => void;
}

const SWARM_PREFIX = 'mcp__swarm__';

/**
 * Returns a purpose-built card component for orchestrator swarm tools.
 *
 * Returns `null` for non-swarm tool calls so the caller can fall back to the
 * default `<ToolCallCard>` rendering.
 */
export default function SwarmToolCardSelector(props: Props): React.ReactElement | null {
  const { toolCall, tasks, approvals, onFocusTask, onRebaseRetry } = props;
  if (!toolCall.name?.startsWith(SWARM_PREFIX)) return null;
  const baseName = toolCall.name.slice(SWARM_PREFIX.length);
  switch (baseName) {
    case 'spawn_task':
    case 'spawn_tasks':
      return <SpawnTaskCard toolCall={toolCall} tasks={tasks} onFocusTask={onFocusTask} />;
    case 'query_status':
      return <QueryStatusCard toolCall={toolCall} />;
    case 'land':
      return <LandCard toolCall={toolCall} onRebaseRetry={onRebaseRetry} />;
    case 'discard':
      return <DiscardCard toolCall={toolCall} />;
    case 'pause_task':
    case 'resume_task':
      return <PauseResumeCard toolCall={toolCall} tasks={tasks} />;
    case 'approve_tool_call':
    case 'deny_tool_call':
      return <ApprovalActionCard toolCall={toolCall} tasks={tasks} approvals={approvals} />;
    default:
      // Unknown swarm tool — fall back to the default renderer so we don't
      // silently swallow new tools the orchestrator might learn.
      return null;
  }
}
