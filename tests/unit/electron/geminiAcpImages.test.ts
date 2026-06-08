import { describe, it, expect, vi } from 'vitest';

// Stub Electron and its services before importing gemini.ts
vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}));
vi.mock('../../../electron/services/notify', () => ({
  notifyCompletion: vi.fn(),
}));
vi.mock('../../../electron/services/workspace', () => ({
  getOrCreate: vi.fn(),
  get: vi.fn(),
  touchActivity: vi.fn(),
}));
vi.mock('../../../electron/services/gemini-acp', () => ({
  createGeminiAcpClient: vi.fn(),
}));

import { acpContentToToolResult } from '../../../electron/services/gemini';

describe('acpContentToToolResult', () => {
  it('returns a plain string when there are no images', () => {
    const content = [{ type: 'content', content: { type: 'text', text: 'hello' } }];
    expect(acpContentToToolResult(content)).toBe('hello');
  });

  it('returns an array with text + image block when an image is present', () => {
    const content = [
      { type: 'content', content: { type: 'text', text: 'see:' } },
      { type: 'content', content: { type: 'image', mimeType: 'image/png', data: 'AAAA' } },
    ];
    expect(acpContentToToolResult(content)).toEqual([
      { type: 'text', text: 'see:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
  });
});
