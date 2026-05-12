import { describe, it, expect, vi } from 'vitest';
import { SwarmScheduler } from '@/lib/swarmScheduler';

describe('SwarmScheduler', () => {
  it('promotes up to cap from queued to streaming and calls onStart', () => {
    const onStart = vi.fn();
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([
      { id: 'a', status: 'queued' }, { id: 'b', status: 'queued' },
      { id: 'c', status: 'queued' }, { id: 'd', status: 'streaming' },
    ] as any);
    // setTasks triggers tick() internally; cap 2 minus 1 streaming = 1 free slot.
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
  it('does not promote when at cap', () => {
    const onStart = vi.fn();
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([{ id: 'a', status: 'streaming' }, { id: 'b', status: 'streaming' }, { id: 'c', status: 'queued' }] as any);
    expect(onStart).not.toHaveBeenCalled();
  });
});
