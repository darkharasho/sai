import { describe, it, expect, vi, beforeEach } from 'vitest';

const handleMock = vi.fn();
const onMock = vi.fn();
vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: (...a: unknown[]) => onMock(...a), handle: (...a: unknown[]) => handleMock(...a) },
  app: { getPath: vi.fn(() => '/tmp') },
}));
vi.mock('../../../electron/services/notify', () => ({ notifyCompletion: vi.fn() }));
vi.mock('../../../electron/services/workspace', () => ({
  getOrCreate: vi.fn(), get: vi.fn(), touchActivity: vi.fn(),
}));

import { registerKimiHandlers, KIMI_CONFIG } from '../../../electron/services/kimi';

describe('registerKimiHandlers', () => {
  beforeEach(() => { handleMock.mockClear(); onMock.mockClear(); });

  it('registers the kimi:* IPC namespace', () => {
    registerKimiHandlers({} as any);
    const handled = handleMock.mock.calls.map(c => c[0]);
    const listened = onMock.mock.calls.map(c => c[0]);
    expect(handled).toEqual(expect.arrayContaining(['kimi:models', 'kimi:start']));
    expect(listened).toEqual(expect.arrayContaining(['kimi:send', 'kimi:stop', 'kimi:approve', 'kimi:setSessionId']));
  });

  it('spawns `kimi acp` with kimi-k3 as default model', () => {
    expect(KIMI_CONFIG).toMatchObject({
      key: 'kimi', command: 'kimi', args: ['acp'], defaultModel: 'kimi-k3', label: 'Kimi ACP',
    });
  });
});
