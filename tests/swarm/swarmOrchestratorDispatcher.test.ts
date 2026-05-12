import { describe, it, expect, vi } from 'vitest';
import { dispatchSwarmTool } from '../../src/lib/swarmOrchestratorDispatcher';

describe('dispatchSwarmTool', () => {
  it('spawn_task creates a task via the host', async () => {
    const host = { spawnTask: vi.fn().mockResolvedValue({ id: 't1', title: 'foo' }) } as any;
    const r: any = await dispatchSwarmTool('spawn_task', { prompt: 'foo' }, host);
    expect(host.spawnTask).toHaveBeenCalledWith({ prompt: 'foo' });
    expect(r).toEqual({ ok: true, task: { id: 't1', title: 'foo' } });
  });

  it('query_status returns the snapshot', async () => {
    const host = { snapshot: vi.fn().mockResolvedValue({ active: 2, approvals: 0, ready: 1, tasks: [] }) } as any;
    const r: any = await dispatchSwarmTool('query_status', {}, host);
    expect(r.snapshot.active).toBe(2);
  });
});
