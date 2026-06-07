import { describe, it, expect } from 'vitest';
import { workspaceDisplayState } from '../../../src/lib/workspaceStatus';

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
    expect(workspaceDisplayState({ awaitingQuestion: true }, { isOpen: true })).toBe('busy');
  });

  it('done when completed and not busy', () => {
    expect(workspaceDisplayState({ completed: true }, { isOpen: true })).toBe('done');
    expect(workspaceDisplayState({ completed: true })).toBe('done');
  });

  it('inactive when not open and no flags', () => {
    expect(workspaceDisplayState({ completed: false })).toBe('inactive');
  });
});
