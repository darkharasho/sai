import { describe, it, expect } from 'vitest';
import { resolveTaskRef } from '../../src/lib/swarmRef';

const tasks = [
  { id: 'abc123', title: 'refactor auth' },
  { id: 'def456', title: 'fix flaky test' },
] as any[];

describe('resolveTaskRef', () => {
  it('matches by id', () => { expect(resolveTaskRef(tasks, 'abc123')?.id).toBe('abc123'); });
  it('matches by title prefix', () => { expect(resolveTaskRef(tasks, 'fix flaky')?.id).toBe('def456'); });
  it('returns null on ambiguity', () => {
    expect(resolveTaskRef([{id:'a',title:'foo bar'},{id:'b',title:'foo baz'}] as any, 'foo')).toBeNull();
  });
  it('returns null when no match', () => { expect(resolveTaskRef(tasks, 'nonsense')).toBeNull(); });
});
