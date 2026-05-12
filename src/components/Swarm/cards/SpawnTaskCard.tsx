import React from 'react';
import type { ToolCall, SwarmTask, SwarmTaskStatus } from '../../../types';
import { cardBase, cardHeader, safeJsonParse } from './cardStyles';

interface DispatchedTask {
  /** Best-effort title parsed from the orchestrator's input. */
  title: string;
  /** Optional explicit prompt for the task (for dedupe / matching). */
  prompt?: string;
}

interface Props {
  toolCall: ToolCall;
  /** Live task list — used to resolve status pills + branch for matched tasks. */
  tasks?: SwarmTask[];
  onFocusTask?: (taskId: string) => void;
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
    return [{ title, prompt: input.prompt }];
  }
  if (baseName === 'spawn_tasks') {
    const prompts: string[] = Array.isArray(input.prompts) ? input.prompts : [];
    return prompts.map((p) => ({ title: p.slice(0, 60), prompt: p }));
  }
  return [];
}

/**
 * Best-effort match: prefer tasks whose prompt matches verbatim, else fall
 * back to title prefix match. We accept that the orchestrator might not have
 * surfaced a task ID yet; matched live state is purely an enrichment.
 */
function matchTask(dispatched: DispatchedTask, tasks: SwarmTask[]): SwarmTask | undefined {
  if (dispatched.prompt) {
    const exact = tasks.find((t) => t.prompt === dispatched.prompt);
    if (exact) return exact;
  }
  return tasks.find((t) => t.title.startsWith(dispatched.title.slice(0, 40)));
}

export default function SpawnTaskCard({ toolCall, tasks = [], onFocusTask }: Props) {
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
          const interactive = !!live && !!onFocusTask;
          return (
            <li
              key={i}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onFocusTask!(live!.id) : undefined}
              onKeyDown={interactive ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onFocusTask!(live!.id);
                }
              } : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 4,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                cursor: interactive ? 'pointer' : 'default',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>{d.title}</span>
                {live?.branch && (
                  <span style={{
                    marginLeft: 8, opacity: 0.7,
                    fontFamily: "'Geist Mono', monospace", fontSize: 11,
                  }}>
                    {live.branch}
                  </span>
                )}
              </div>
              <StatusPill status={live?.status ?? 'queued'} />
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
