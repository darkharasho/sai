import React from 'react';
import type { ToolCall, SwarmTask, SwarmApproval } from '../../../types';
import SpawnTaskCard from './SpawnTaskCard';
import QueryStatusCard from './QueryStatusCard';
import LandCard from './LandCard';
import DiscardCard from './DiscardCard';
import PauseResumeCard from './PauseResumeCard';
import ApprovalActionCard from './ApprovalActionCard';
import TaskCompletedCard from './TaskCompletedCard';
import TaskFailedCard from './TaskFailedCard';
import AutoApprovedCard from './AutoApprovedCard';
import BatchCompleteCard from './BatchCompleteCard';

interface Props {
  toolCall: ToolCall;
  expanded?: boolean;
  tasks?: SwarmTask[];
  approvals?: SwarmApproval[];
  diffStats?: Map<string, { additions: number; deletions: number }>;
  /** Per-task tool_use bucket counts over the last 60s (12 × 5s buckets). */
  toolHistory?: Map<string, number[]>;
  onFocusTask?: (taskId: string) => void;
  onRebaseRetry?: (taskRef: string) => void;
  onLand?: (taskId: string) => void;
  onDiscard?: (taskId: string) => void;
  onDiff?: (taskId: string) => void;
  onRetry?: (prompt: string) => void;
  onScrollToApproval?: (taskId: string) => void;
  onLandAllGreen?: () => void;
}

const SWARM_PREFIX = 'mcp__swarm__';

/**
 * Returns a purpose-built card component for orchestrator swarm tools.
 *
 * Returns `null` for non-swarm tool calls so the caller can fall back to the
 * default `<ToolCallCard>` rendering.
 */
export default function SwarmToolCardSelector(props: Props): React.ReactElement | null {
  const {
    toolCall, tasks, approvals, diffStats, toolHistory,
    onFocusTask, onRebaseRetry, onLand, onDiscard, onDiff, onRetry, onScrollToApproval,
    onLandAllGreen,
  } = props;
  if (!toolCall.name?.startsWith(SWARM_PREFIX)) return null;
  const baseName = toolCall.name.slice(SWARM_PREFIX.length);
  switch (baseName) {
    case 'spawn_task':
    case 'spawn_tasks':
      return (
        <SpawnTaskCard
          toolCall={toolCall}
          tasks={tasks}
          diffStats={diffStats}
          toolHistory={toolHistory}
          onFocusTask={onFocusTask}
          onLand={onLand}
          onDiscard={onDiscard}
          onDiff={onDiff}
          onRetry={onRetry}
          onScrollToApproval={onScrollToApproval}
        />
      );
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
    case 'task_completed':
      return (
        <TaskCompletedCard
          toolCall={toolCall}
          diffStats={diffStats}
          onLand={onLand}
          onDiscard={onDiscard}
          onDiff={onDiff}
        />
      );
    case 'task_failed':
      return <TaskFailedCard toolCall={toolCall} onRetry={onRetry} onDiscard={onDiscard} />;
    case 'auto_approved':
      return <AutoApprovedCard toolCall={toolCall} />;
    case 'batch_complete': {
      const hasLandable = !!tasks?.some(t => t.status === 'done');
      return (
        <BatchCompleteCard
          toolCall={toolCall}
          onLandAll={onLandAllGreen}
          hasLandable={hasLandable}
        />
      );
    }
    default:
      // Unknown swarm tool — fall back to the default renderer so we don't
      // silently swallow new tools the orchestrator might learn.
      return null;
  }
}
