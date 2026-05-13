import { describe, it, expect } from 'vitest';
import { swarmBranchName } from '@/lib/swarmSlug';

describe('swarmBranchName', () => {
  it('kebabs the title and appends a short id', () => {
    const b = swarmBranchName('Refactor Auth Middleware!', 'abc1234567');
    expect(b).toBe('swarm/refactor-auth-middleware-abc12345');
  });
  it('handles empty title', () => {
    expect(swarmBranchName('', 'abc12345')).toBe('swarm/task-abc12345');
  });
});
