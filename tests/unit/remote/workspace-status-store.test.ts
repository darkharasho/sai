import { describe, it, expect } from 'vitest';
import { createWorkspaceStatusStore } from '../../../src/renderer-remote/lib/workspaceStatusStore';

const empty = { busy: false, streaming: false, completed: false, approval: false, awaitingQuestion: false };

describe('workspaceStatusStore', () => {
  it('notifies subscribers when a workspace status changes', () => {
    const s = createWorkspaceStatusStore();
    const events: Array<{ projectPath: string; status: any }> = [];
    s.subscribe((projectPath, status) => events.push({ projectPath, status }));
    s.set('/a', { ...empty, busy: true });
    s.set('/a', { ...empty, busy: true, streaming: true });
    expect(events).toHaveLength(2);
    expect(s.get('/a')).toEqual({ ...empty, busy: true, streaming: true });
  });

  it('clears entries when all flags are false', () => {
    const s = createWorkspaceStatusStore();
    s.set('/a', { ...empty, busy: true });
    s.set('/a', { ...empty });
    expect(s.get('/a')).toBeUndefined();
  });

  it('clears entries when only awaitingQuestion was set and it goes false', () => {
    const s = createWorkspaceStatusStore();
    s.set('/a', { ...empty, awaitingQuestion: true });
    expect(s.get('/a')).toBeDefined();
    s.set('/a', { ...empty });
    expect(s.get('/a')).toBeUndefined();
  });

  it('priority() returns single-state label', () => {
    const s = createWorkspaceStatusStore();
    expect(s.priority(undefined)).toBe('idle');
    expect(s.priority({ ...empty })).toBe('idle');
    expect(s.priority({ ...empty, busy: true, completed: true })).toBe('busy');
    expect(s.priority({ ...empty, busy: true, streaming: true })).toBe('streaming');
    expect(s.priority({ ...empty, completed: true })).toBe('completed');
    expect(s.priority({ ...empty, busy: true, streaming: true, completed: true, approval: true })).toBe('approval');
  });

  it('priority() places awaitingQuestion above streaming and below approval', () => {
    const s = createWorkspaceStatusStore();
    expect(s.priority({ ...empty, awaitingQuestion: true })).toBe('awaitingQuestion');
    expect(s.priority({ ...empty, awaitingQuestion: true, streaming: true, busy: true })).toBe('awaitingQuestion');
    expect(s.priority({ ...empty, awaitingQuestion: true, approval: true })).toBe('approval');
  });
});
