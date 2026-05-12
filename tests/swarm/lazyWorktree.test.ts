import { describe, it, expect } from 'vitest';
import { isWriteTool, materializeIfNeeded, WRITE_TOOLS, isLikelyReadOnlyPrompt } from '@/lib/swarmScheduler';

describe('lazy worktree', () => {
  it('classifies write tools', () => {
    expect(isWriteTool('edit_file')).toBe(true);
    expect(isWriteTool('read_file')).toBe(false);
  });
  it('exports the canonical write tools set', () => {
    expect(WRITE_TOOLS.has('bash')).toBe(true);
  });
  it('materializes once on first write call', async () => {
    const calls: string[] = [];
    const task = { id: 't', branch: 'b', baseBranch: 'main', worktreePath: null, workspaceId: '/p' } as any;
    const newPath = await materializeIfNeeded(task, 'edit_file', {
      worktreeAdd: async () => { calls.push('add'); return '/wt'; },
      updateTask: async () => {},
    });
    expect(calls).toEqual(['add']);
    expect(newPath).toBe('/wt');
  });
  it('no-ops on read tools', async () => {
    const task = { worktreePath: null } as any;
    const calls: string[] = [];
    const newPath = await materializeIfNeeded(task, 'read_file', {
      worktreeAdd: async () => { calls.push('add'); return '/wt'; },
      updateTask: async () => {},
    });
    expect(newPath).toBeNull();
    expect(calls).toEqual([]);
  });
  it('isLikelyReadOnlyPrompt matches common verbs', () => {
    expect(isLikelyReadOnlyPrompt('Explain the auth flow')).toBe(true);
    expect(isLikelyReadOnlyPrompt('What does X do?')).toBe(true);
    expect(isLikelyReadOnlyPrompt('Refactor the parser')).toBe(false);
  });
});
