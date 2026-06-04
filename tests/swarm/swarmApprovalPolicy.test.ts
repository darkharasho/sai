import { describe, it, expect } from 'vitest';
import { shouldRequireApproval } from '@/lib/swarmApprovalPolicy';

describe('shouldRequireApproval', () => {
  it('auto-read auto-approves real read tools', () => {
    expect(shouldRequireApproval('auto-read', 'Read')).toBe(false);
    expect(shouldRequireApproval('auto-read', 'Grep')).toBe(false);
    expect(shouldRequireApproval('auto-read', 'Glob')).toBe(false);
  });

  it('auto-read pauses on real write tools', () => {
    expect(shouldRequireApproval('auto-read', 'Edit')).toBe(true);
    expect(shouldRequireApproval('auto-read', 'Write')).toBe(true);
    expect(shouldRequireApproval('auto-read', 'Bash')).toBe(true);
  });

  it('auto-read still handles legacy snake_case names', () => {
    expect(shouldRequireApproval('auto-read', 'read_file')).toBe(false);
    expect(shouldRequireApproval('auto-read', 'bash')).toBe(true);
  });

  it('always-ask pauses on everything, including reads', () => {
    expect(shouldRequireApproval('always-ask', 'Read')).toBe(true);
  });

  it('auto never pauses', () => {
    expect(shouldRequireApproval('auto', 'Bash')).toBe(false);
  });
});
