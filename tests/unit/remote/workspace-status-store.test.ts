import { describe, it, expect } from 'vitest';
import { createWorkspaceStatusStore } from '../../../src/renderer-remote/lib/workspaceStatusStore';

describe('workspaceStatusStore', () => {
  it('notifies subscribers when a workspace status changes', () => {
    const s = createWorkspaceStatusStore();
    const events: Array<{ projectPath: string; status: any }> = [];
    s.subscribe((projectPath, status) => events.push({ projectPath, status }));
    s.set('/a', { busy: true, streaming: false, completed: false, approval: false });
    s.set('/a', { busy: true, streaming: true, completed: false, approval: false });
    expect(events).toHaveLength(2);
    expect(s.get('/a')).toEqual({ busy: true, streaming: true, completed: false, approval: false });
  });

  it('clears entries when all flags are false', () => {
    const s = createWorkspaceStatusStore();
    s.set('/a', { busy: true, streaming: false, completed: false, approval: false });
    s.set('/a', { busy: false, streaming: false, completed: false, approval: false });
    expect(s.get('/a')).toBeUndefined();
  });

  it('priority() returns single-state label', () => {
    const s = createWorkspaceStatusStore();
    expect(s.priority(undefined)).toBe('idle');
    expect(s.priority({ busy: false, streaming: false, completed: false, approval: false })).toBe('idle');
    expect(s.priority({ busy: true, streaming: false, completed: true, approval: false })).toBe('busy');
    expect(s.priority({ busy: true, streaming: true, completed: false, approval: false })).toBe('streaming');
    expect(s.priority({ busy: false, streaming: false, completed: true, approval: false })).toBe('completed');
    expect(s.priority({ busy: true, streaming: true, completed: true, approval: true })).toBe('approval');
  });
});
