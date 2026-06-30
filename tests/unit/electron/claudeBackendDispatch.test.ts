import { describe, it, expect, vi, afterEach } from 'vitest';

const { readSaiSetting, sendImpl: mockSendImpl } = vi.hoisted(() => ({ readSaiSetting: vi.fn(), sendImpl: vi.fn() }));
vi.mock('@electron/services/claude', () => ({ readSaiSetting, sendImpl: mockSendImpl }));

import { getClaudeBackendSetting, getClaudeBackend, __setClaudeBackendForTests } from '@electron/services/claudeBackend';
import { CliBackend } from '@electron/services/claudeBackend/cliBackend';

afterEach(() => { readSaiSetting.mockReset(); mockSendImpl.mockReset(); });

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

describe('CliBackend', () => {
  it('delegates send() to sendImpl with positional args', () => {
    const be = new CliBackend();
    be.send({ projectPath: '/p', message: 'hi', scope: 's' });
    expect(mockSendImpl).toHaveBeenCalledWith('/p', 'hi', undefined, undefined, undefined, undefined, 's');
  });
});

describe('getClaudeBackend', () => {
  afterEach(() => __setClaudeBackendForTests(null));
  it('returns a CliBackend when flag is cli/absent', () => {
    readSaiSetting.mockReturnValue(undefined);
    expect(getClaudeBackend()).toBeInstanceOf(CliBackend);
  });
  it('falls back to CliBackend when flag is sdk (no SDK backend yet)', () => {
    readSaiSetting.mockReturnValue('sdk');
    expect(getClaudeBackend()).toBeInstanceOf(CliBackend);
  });
});
