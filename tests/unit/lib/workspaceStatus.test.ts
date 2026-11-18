import { describe, it, expect } from 'vitest';
import { workspaceDisplayState, waitingWorkspacesFrom } from '../../../src/lib/workspaceStatus';

describe('workspaceDisplayState', () => {
  it('returns inactive when no flags and not open', () => {
    expect(workspaceDisplayState(undefined)).toBe('inactive');
    expect(workspaceDisplayState({})).toBe('inactive');
  });

  it('returns alive when isOpen and no active flags', () => {
    expect(workspaceDisplayState(undefined, { isOpen: true })).toBe('alive');
    expect(workspaceDisplayState({}, { isOpen: true })).toBe('alive');
  });

  it('approval beats everything', () => {
    expect(workspaceDisplayState({ approval: true, busy: true, completed: true }, { isOpen: true })).toBe('approval');
  });

  it('busy beats done and alive', () => {
    expect(workspaceDisplayState({ busy: true, completed: true }, { isOpen: true })).toBe('busy');
    expect(workspaceDisplayState({ streaming: true }, { isOpen: true })).toBe('busy');
    // Spec change 2026-06-11: awaitingQuestion is its own state now, no longer
    // folded into busy (it hid which workspace was waiting for an answer).
    expect(workspaceDisplayState({ awaitingQuestion: true }, { isOpen: true })).toBe('question');
  });

  it('done when completed and not busy', () => {
    expect(workspaceDisplayState({ completed: true }, { isOpen: true })).toBe('done');
    expect(workspaceDisplayState({ completed: true })).toBe('done');
  });

  it('inactive when not open and no flags', () => {
    expect(workspaceDisplayState({ completed: false })).toBe('inactive');
  });
});

describe('question indicator state (audit 2026-06-11)', () => {
  it('awaitingQuestion maps to question, above busy and below approval', () => {
    expect(workspaceDisplayState({ awaitingQuestion: true, busy: true })).toBe('question');
    expect(workspaceDisplayState({ awaitingQuestion: true, approval: true })).toBe('approval');
    expect(workspaceDisplayState({ busy: true })).toBe('busy');
  });
});

describe('waitingWorkspacesFrom', () => {
  it('marks a workspace waiting when it has a wait scope and nothing streaming', () => {
    expect([...waitingWorkspacesFrom(['/a/b:sess-1'], [])]).toEqual(['/a/b']);
  });

  it('a streaming turn in the same workspace means working, not waiting', () => {
    expect(waitingWorkspacesFrom(['/a/b:sess-1'], ['/a/b:sess-2']).size).toBe(0);
  });

  it('streaming elsewhere does not affect it', () => {
    expect([...waitingWorkspacesFrom(['/a/b:chat'], ['/c/d:sess-9'])]).toEqual(['/a/b']);
  });
});
