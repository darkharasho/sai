import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: class {}, shell: {} }));

import { cloneAuthEnv } from '../../../electron/services/github-auth';

describe('cloneAuthEnv', () => {
  it('passes the token as a one-off github.com auth header', () => {
    const env = cloneAuthEnv('gho_abc', {});
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    const b64 = String(env.GIT_CONFIG_VALUE_0).replace('Authorization: Basic ', '');
    expect(Buffer.from(b64, 'base64').toString()).toBe('x-access-token:gho_abc');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('appends after existing GIT_CONFIG_* entries', () => {
    const env = cloneAuthEnv('t', { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'a', GIT_CONFIG_KEY_1: 'b' });
    expect(env.GIT_CONFIG_COUNT).toBe('3');
    expect(env.GIT_CONFIG_KEY_0).toBe('a');
    expect(env.GIT_CONFIG_KEY_2).toBe('http.https://github.com/.extraheader');
  });
});
