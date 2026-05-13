import { describe, it, expect } from 'vitest';
import { shouldRequireApproval, READ_TOOLS } from '@/lib/swarmApprovalPolicy';

describe('shouldRequireApproval', () => {
  it('auto-read pauses on writes', () => {
    expect(shouldRequireApproval('auto-read', 'bash')).toBe(true);
    expect(shouldRequireApproval('auto-read', 'read_file')).toBe(false);
  });
  it('always-ask pauses on everything', () => {
    expect(shouldRequireApproval('always-ask', 'read_file')).toBe(true);
  });
  it('auto never pauses', () => {
    expect(shouldRequireApproval('auto', 'bash')).toBe(false);
  });
});

describe('READ_TOOLS', () => {
  it('contains the documented read-only tool names', () => {
    for (const t of ['read_file', 'list_files', 'grep', 'glob', 'search']) {
      expect(READ_TOOLS.has(t)).toBe(true);
    }
  });
});
