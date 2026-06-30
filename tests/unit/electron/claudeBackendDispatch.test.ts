import { describe, it, expect, vi, afterEach } from 'vitest';

const { readSaiSetting } = vi.hoisted(() => ({ readSaiSetting: vi.fn() }));
vi.mock('@electron/services/claude', () => ({ readSaiSetting }));

import { getClaudeBackendSetting } from '@electron/services/claudeBackend';

afterEach(() => { readSaiSetting.mockReset(); });

describe('getClaudeBackendSetting', () => {
  it("defaults to 'cli' when unset", () => {
    readSaiSetting.mockReturnValue(undefined);
    expect(getClaudeBackendSetting()).toBe('cli');
  });
  it("returns 'sdk' when set to sdk", () => {
    readSaiSetting.mockReturnValue('sdk');
    expect(getClaudeBackendSetting()).toBe('sdk');
  });
  it("falls back to 'cli' for unknown values", () => {
    readSaiSetting.mockReturnValue('weird');
    expect(getClaudeBackendSetting()).toBe('cli');
  });
});
