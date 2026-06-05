import { describe, it, expect } from 'vitest';
import { deriveSwarmMirror, applySwarmPatch } from '../../src/lib/swarmStatusMirror';
import type { SwarmTask } from '../../src/types';

function makeTask(overrides: Partial<SwarmTask> = {}): SwarmTask {
  return {
    id: 't1',
    workspaceId: '/repo',
    sessionId: 'sess-abc',
    title: 'demo',
    prompt: 'do thing',
    provider: 'claude' as any,
    model: 'sonnet',
    approvalPolicy: 'auto',
    status: 'streaming',
    branch: 'feat/demo',
    baseBranch: 'main',
    worktreePath: null,
    createdAt: 0,
    lastActivityAt: 0,
    costEstimate: 0,
    toolCallCount: 0,
    ...overrides,
  };
}

describe('deriveSwarmMirror', () => {
  it('returns null for chat-scope messages', () => {
    expect(deriveSwarmMirror({ type: 'done', scope: 'chat' }, [makeTask()])).toBeNull();
    expect(deriveSwarmMirror({ type: 'done' }, [makeTask()])).toBeNull();
  });

  it('returns null when no task matches the scope', () => {
    expect(deriveSwarmMirror({ type: 'done', scope: 'other-sess' }, [makeTask()])).toBeNull();
  });

  it('emits done patch when streaming task sees done/result', () => {
    const t = makeTask();
    const r1 = deriveSwarmMirror({ type: 'done', scope: 'sess-abc' }, [t], 100);
    expect(r1).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'done', lastActivityAt: 100 } });
    const r2 = deriveSwarmMirror({ type: 'result', scope: 'sess-abc' }, [t], 100);
    expect(r2).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'done', lastActivityAt: 100 } });
  });

  it('does not transition non-streaming tasks on done', () => {
    const t = makeTask({ status: 'done' });
    expect(deriveSwarmMirror({ type: 'done', scope: 'sess-abc' }, [t])).toBeNull();
  });

  it('marks failed when a result reports is_error', () => {
    const t = makeTask();
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc', is_error: true }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'failed', lastActivityAt: 50 } });
  });

  it('marks failed on an error_max_turns result subtype', () => {
    const t = makeTask();
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc', subtype: 'error_max_turns' }, [t], 50);
    expect(r?.patch).toMatchObject({ kind: 'status', status: 'failed' });
  });

  it('marks failed only on a fatal error message, not benign stderr', () => {
    const t = makeTask();
    expect(deriveSwarmMirror({ type: 'error', scope: 'sess-abc', text: 'warning: deprecated' }, [t], 50)).toBeNull();
    const r = deriveSwarmMirror({ type: 'error', scope: 'sess-abc', fatal: true, text: 'crash' }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'failed', lastActivityAt: 50 } });
  });

  it('terminalizes a task that completes while awaiting_approval', () => {
    const t = makeTask({ status: 'awaiting_approval' });
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc' }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'done', lastActivityAt: 50 } });
  });

  it('carries costEstimate from total_cost_usd on the terminal patch', () => {
    const t = makeTask();
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc', total_cost_usd: 0.42 }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'done', costEstimate: 0.42, lastActivityAt: 50 } });
  });

  it('marks failed AND records cost when an errored result carries total_cost_usd', () => {
    const t = makeTask();
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc', is_error: true, total_cost_usd: 0.1 }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'failed', costEstimate: 0.1, lastActivityAt: 50 } });
  });

  it('counts tool_use blocks in assistant messages', () => {
    const t = makeTask();
    const msg = {
      type: 'assistant',
      scope: 'sess-abc',
      message: {
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', name: 'Bash', input: {} },
          { type: 'tool_use', name: 'Write', input: {} },
        ],
      },
    };
    expect(deriveSwarmMirror(msg, [t], 7)).toEqual({
      taskId: 't1',
      patch: { kind: 'toolCount', delta: 2, lastActivityAt: 7 },
    });
  });

  it('returns null for assistant messages with no tool_use blocks', () => {
    const t = makeTask();
    const msg = { type: 'assistant', scope: 'sess-abc', message: { content: [{ type: 'text', text: 'hi' }] } };
    expect(deriveSwarmMirror(msg, [t])).toBeNull();
  });
});

describe('applySwarmPatch', () => {
  it('applies status patch', () => {
    const t = makeTask();
    const next = applySwarmPatch(t, { kind: 'status', status: 'done', lastActivityAt: 99 });
    expect(next.status).toBe('done');
    expect(next.lastActivityAt).toBe(99);
  });

  it('increments tool count', () => {
    const t = makeTask({ toolCallCount: 3 });
    const next = applySwarmPatch(t, { kind: 'toolCount', delta: 2, lastActivityAt: 12 });
    expect(next.toolCallCount).toBe(5);
    expect(next.lastActivityAt).toBe(12);
  });

  it('applies costEstimate from a status patch when present', () => {
    const t = makeTask({ costEstimate: 0 });
    const next = applySwarmPatch(t, { kind: 'status', status: 'done', costEstimate: 0.42, lastActivityAt: 99 });
    expect(next.costEstimate).toBe(0.42);
    expect(next.status).toBe('done');
  });
});
