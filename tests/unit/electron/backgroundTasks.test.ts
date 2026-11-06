import { describe, it, expect } from 'vitest';
import {
  foldBackgroundTaskFrame,
  clearFinishedTasks,
  isPossiblyStuck,
  isTerminalDetail,
  visibleTasks,
  STUCK_AFTER_MS,
  type BackgroundTaskDetail,
} from '../../../electron/services/claudeBackend/backgroundTasks';

const sys = (subtype: string, extra: Record<string, unknown>) => ({ type: 'system', subtype, ...extra });
const empty = () => new Map<string, BackgroundTaskDetail>();

describe('foldBackgroundTaskFrame', () => {
  it('started builds a record', () => {
    const m = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'a', description: 'Research X', subagent_type: 'Explore' }), 1000);
    const t = m.get('a')!;
    expect(t).toMatchObject({ id: 'a', description: 'Research X', kind: 'Explore', isAgent: true, isShell: false, status: 'running', startedAt: 1000, endedAt: null });
  });

  it('shell kind', () => {
    const t = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 's', description: 'npm run dev', task_type: 'local_bash' }), 0).get('s')!;
    expect(t).toMatchObject({ kind: 'shell', isShell: true, isAgent: false });
  });

  it('workflow kind', () => {
    const t = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'w', description: 'wf', task_type: 'local_workflow', workflow_name: 'spec' }), 0).get('w')!;
    expect(t.kind).toBe('spec');
  });

  it('progress updates usage', () => {
    let m = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'a', description: 'd', task_type: 'local_agent' }), 1000);
    m = foldBackgroundTaskFrame(m, sys('task_progress', { task_id: 'a', description: 'd', usage: { total_tokens: 18400, tool_uses: 23, duration_ms: 1 }, last_tool_name: 'Grep', summary: 'Searching' }), 5000);
    expect(m.get('a')).toMatchObject({ totalTokens: 18400, toolUses: 23, lastToolName: 'Grep', summary: 'Searching', lastEventAt: 5000, isAgent: true, startedAt: 1000 });
  });

  it('progress before started', () => {
    const m = foldBackgroundTaskFrame(empty(), sys('task_progress', { task_id: 'z', description: 'Late joiner', usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 } }), 7000);
    expect(m.get('z')).toMatchObject({ status: 'running', startedAt: 7000, description: 'Late joiner' });
  });

  it('notification finishes', () => {
    let m = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'a', description: 'd' }), 0);
    m = foldBackgroundTaskFrame(m, sys('task_notification', { task_id: 'a', status: 'failed', summary: 'boom' }), 9000);
    expect(m.get('a')).toMatchObject({ status: 'failed', summary: 'boom', endedAt: 9000 });
    expect(isTerminalDetail(m.get('a')!)).toBe(true);
  });

  it('killed maps to stopped', () => {
    let m = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'a', description: 'd' }), 0);
    m = foldBackgroundTaskFrame(m, sys('task_updated', { task_id: 'a', patch: { status: 'killed', end_time: 4242 } }), 9000);
    expect(m.get('a')).toMatchObject({ status: 'stopped', endedAt: 4242 });
  });

  it('task_updated error is kept', () => {
    let m = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'a', description: 'd' }), 0);
    m = foldBackgroundTaskFrame(m, sys('task_updated', { task_id: 'a', patch: { status: 'failed', error: 'nope' } }), 10);
    expect(m.get('a')).toMatchObject({ status: 'failed', error: 'nope', endedAt: 10 });
  });

  it('skip_transcript hidden', () => {
    let m = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'h', description: 'housekeeping', skip_transcript: true }), 0);
    m = foldBackgroundTaskFrame(m, sys('task_progress', { task_id: 'h', description: 'housekeeping', usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 } }), 5);
    m = foldBackgroundTaskFrame(m, sys('task_started', { task_id: 'v2', description: 'second' }), 3);
    m = foldBackgroundTaskFrame(m, sys('task_started', { task_id: 'v1', description: 'first' }), 1);
    expect(visibleTasks(m).map((t) => t.id)).toEqual(['v1', 'v2']);
  });

  it('non-task frame is identity', () => {
    const m = empty();
    expect(foldBackgroundTaskFrame(m, { type: 'assistant' }, 0)).toBe(m);
    expect(foldBackgroundTaskFrame(m, sys('task_progress', {}), 0)).toBe(m);
  });

  it('does not mutate the input map', () => {
    const m = empty();
    const next = foldBackgroundTaskFrame(m, sys('task_started', { task_id: 'a', description: 'd' }), 0);
    expect(m.size).toBe(0);
    expect(next.size).toBe(1);
  });
});

describe('clearFinishedTasks', () => {
  it('keeps running only', () => {
    let m = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'a', description: 'd' }), 0);
    m = foldBackgroundTaskFrame(m, sys('task_started', { task_id: 'b', description: 'd' }), 0);
    m = foldBackgroundTaskFrame(m, sys('task_notification', { task_id: 'b', status: 'completed' }), 1);
    expect([...clearFinishedTasks(m).keys()]).toEqual(['a']);
  });
});

describe('isPossiblyStuck', () => {
  const agent = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 'a', description: 'd', subagent_type: 'Explore' }), 0).get('a')!;
  const shell = foldBackgroundTaskFrame(empty(), sys('task_started', { task_id: 's', description: 'd', task_type: 'local_bash' }), 0).get('s')!;
  it('agent quiet for the threshold is stuck', () => {
    expect(STUCK_AFTER_MS).toBe(120_000);
    expect(isPossiblyStuck(agent, 120_000)).toBe(true);
    expect(isPossiblyStuck(agent, 119_999)).toBe(false);
  });
  it('shells never stuck', () => {
    expect(isPossiblyStuck(shell, 600_000)).toBe(false);
  });
  it('finished agent not stuck', () => {
    expect(isPossiblyStuck({ ...agent, status: 'completed', endedAt: 1 }, 600_000)).toBe(false);
  });
});
