import React from 'react';
import type { ToolCall, SwarmTask, SwarmTaskStatus } from '../../../types';
import { cardBase, cardHeader, safeJsonParse, btnBase, btnPrimary, btnDanger } from './cardStyles';
import Sparkline from '../Sparkline';

interface DispatchedTask {
  /** Best-effort title parsed from the orchestrator's input. */
  title: string;
  /** Optional explicit prompt for the task (for dedupe / matching). */
  prompt?: string;
  /** linkName of the project this task was dispatched to (meta workspaces). */
  project?: string;
}

interface Props {
  toolCall: ToolCall;
  /** Live task list — used to resolve status pills + branch for matched tasks. */
  tasks?: SwarmTask[];
  /** Live diff stats keyed by task id — populated as tasks complete. */
  diffStats?: Map<string, { additions: number; deletions: number }>;
  /**
   * Per-task tool_use bucket counts over the last 60s (12 × 5s buckets).
   * When provided and the task has any non-zero buckets, a tiny inline
   * sparkline is rendered after the diff stats.
   */
  toolHistory?: Map<string, number[]>;
  onFocusTask?: (taskId: string) => void;
  onLand?: (taskId: string) => void;
  onDiscard?: (taskId: string) => void;
  onDiff?: (taskId: string) => void;
  onRetry?: (prompt: string) => void;
  /** Scroll the orchestrator chat to the inline approval card for this task. */
  onScrollToApproval?: (taskId: string) => void;
}

const STATUS_COLORS: Record<SwarmTaskStatus, string> = {
  queued: 'var(--text-muted)',
  streaming: 'var(--accent)',
  awaiting_approval: '#b44',
  paused: 'var(--text-muted)',
  done: '#3a8',
  failed: '#b44',
  landed: '#3a8',
  discarded: 'var(--text-muted)',
};

function StatusPill({ status }: { status: SwarmTaskStatus }) {
  const color = STATUS_COLORS[status] ?? 'var(--text-muted)';
  return (
    <span
      data-testid="swarm-status-pill"
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        textTransform: 'lowercase',
        letterSpacing: 0.4,
        whiteSpace: 'nowrap',
      }}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function parseDispatched(toolCall: ToolCall): DispatchedTask[] {
  const input = safeJsonParse<any>(toolCall.input);
  if (!input) return [];
  const baseName = toolCall.name.replace(/^mcp__swarm__/, '');
  if (baseName === 'spawn_task') {
    const title: string = input.title || input.prompt?.slice(0, 60) || 'task';
    return [{ title, prompt: input.prompt, project: input.project ?? undefined }];
  }
  if (baseName === 'spawn_tasks') {
    const prompts: string[] = Array.isArray(input.prompts) ? input.prompts : [];
    const projects: string[] = Array.isArray(input.projects) ? input.projects : [];
    return prompts.map((p, i) => ({ title: p.slice(0, 60), prompt: p, project: projects[i] ?? undefined }));
  }
  return [];
}

/**
 * Best-effort match: prefer tasks whose prompt matches verbatim, else fall
 * back to title prefix match. When a project linkName is available we first
 * try project-scoped matches so two tasks with identical prompts but different
 * projects resolve to distinct SwarmTasks.
 *
 * Priority order:
 *   1. exact prompt + same project (if project given)
 *   2. title prefix + same project (if project given)
 *   3. exact prompt (fallback — non-meta workspaces)
 *   4. title prefix
 */
function matchTask(dispatched: DispatchedTask, tasks: SwarmTask[]): SwarmTask | undefined {
  const proj = dispatched.project;
  if (dispatched.prompt) {
    if (proj) {
      const hit = tasks.find((t) => t.prompt === dispatched.prompt && t.projectLinkName === proj);
      if (hit) return hit;
    }
    const prefixWithProj = proj
      ? tasks.find((t) => t.title.startsWith(dispatched.title.slice(0, 40)) && t.projectLinkName === proj)
      : undefined;
    if (prefixWithProj) return prefixWithProj;
    const exact = tasks.find((t) => t.prompt === dispatched.prompt);
    if (exact) return exact;
  } else if (proj) {
    const hit = tasks.find((t) => t.title.startsWith(dispatched.title.slice(0, 40)) && t.projectLinkName === proj);
    if (hit) return hit;
  }
  return tasks.find((t) => t.title.startsWith(dispatched.title.slice(0, 40)));
}

export default function SpawnTaskCard({
  toolCall,
  tasks = [],
  diffStats,
  toolHistory,
  onFocusTask,
  onLand,
  onDiscard,
  onDiff,
  onRetry,
  onScrollToApproval,
}: Props) {
  const dispatched = parseDispatched(toolCall);
  const count = dispatched.length;

  return (
    <div data-testid="swarm-spawn-card" style={cardBase}>
      <div style={cardHeader}>
        <span>
          <span style={{ color: 'var(--accent)' }}>⚡</span>{' '}
          Spawned {count} task{count === 1 ? '' : 's'}
        </span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {dispatched.map((d, i) => {
          const live = matchTask(d, tasks);
          const status: SwarmTaskStatus = live?.status ?? 'queued';
          const stats = live ? diffStats?.get(live.id) : undefined;
          const showDiffStats = !!stats && (status === 'done' || status === 'landed');
          const toolCount = live?.toolCallCount ?? 0;
          const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();
          return (
            <li
              key={i}
              data-testid="swarm-spawn-row"
              data-task-id={live?.id}
              data-task-status={status}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 4,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>{d.title}</span>
                {(d.project || live?.projectLinkName) && (
                  <span style={{ marginLeft: 8, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    {d.project ?? live!.projectLinkName}
                  </span>
                )}
                {live?.branch && (
                  <span style={{
                    marginLeft: 8, opacity: 0.7,
                    fontFamily: "'Geist Mono', monospace", fontSize: 11,
                  }}>
                    {live.branch}
                  </span>
                )}
                {live && toolCount > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    · {toolCount} tool{toolCount === 1 ? '' : 's'}
                  </span>
                )}
                {showDiffStats && stats && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    <span style={{ color: '#3a8' }}>+{stats.additions}</span>{' '}
                    <span style={{ color: '#b44' }}>−{stats.deletions}</span>
                  </span>
                )}
                {(() => {
                  const hist = live ? toolHistory?.get(live.id) : undefined;
                  if (!hist || !hist.some(v => v > 0)) return null;
                  return (
                    <span
                      data-testid="swarm-spawn-row-sparkline"
                      style={{ marginLeft: 8, display: 'inline-flex', verticalAlign: 'middle', color: 'var(--accent)' }}
                    >
                      <Sparkline data={hist} width={50} height={12} fillOpacity={0.25} />
                    </span>
                  );
                })()}
              </div>
              <StatusPill status={status} />
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={stop}
                onKeyDown={stop}
              >
                {live && onFocusTask && (
                  <button
                    type="button"
                    style={btnBase}
                    onClick={(e) => { stop(e); onFocusTask(live.id); }}
                  >
                    Focus
                  </button>
                )}
                {live && status === 'awaiting_approval' && onScrollToApproval && (
                  <button
                    type="button"
                    style={btnBase}
                    onClick={(e) => { stop(e); onScrollToApproval(live.id); }}
                  >
                    → Approvals
                  </button>
                )}
                {live && status === 'done' && onDiff && (
                  <button type="button" style={btnBase} onClick={(e) => { stop(e); onDiff(live.id); }}>
                    Diff
                  </button>
                )}
                {live && status === 'done' && onDiscard && (
                  <button type="button" style={btnDanger} onClick={(e) => { stop(e); onDiscard(live.id); }}>
                    Discard
                  </button>
                )}
                {live && status === 'done' && onLand && (
                  <button type="button" style={btnPrimary} onClick={(e) => { stop(e); onLand(live.id); }}>
                    Land
                  </button>
                )}
                {live && (status === 'streaming' || status === 'queued') && onDiscard && (
                  <button type="button" style={btnDanger} onClick={(e) => { stop(e); onDiscard(live.id); }}>
                    Discard
                  </button>
                )}
                {status === 'failed' && onRetry && d.prompt && (
                  <button type="button" style={btnPrimary} onClick={(e) => { stop(e); onRetry(d.prompt!); }}>
                    Retry
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {dispatched.length === 0 && (
          <li style={{ opacity: 0.6, fontSize: 11 }}>No tasks parsed from input</li>
        )}
      </ul>
    </div>
  );
}
