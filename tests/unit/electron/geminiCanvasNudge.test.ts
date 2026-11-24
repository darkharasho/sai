// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-test-userdata') },
  BrowserWindow: vi.fn(),
}));

import { geminiSessionPreamble } from '../../../electron/services/gemini';
import { CHAT_CANVAS_NUDGE } from '../../../electron/services/chatNudges';

describe('gemini first-prompt preamble', () => {
  it('carries the canvas nudge on the first prompt of a session', () => {
    const p = geminiSessionPreamble('META', false);
    expect(p).toContain('META');
    expect(p).toContain(CHAT_CANVAS_NUDGE);
    expect(p.endsWith('\n\n')).toBe(true);
  });

  it('carries the canvas nudge even without a meta preamble', () => {
    expect(geminiSessionPreamble('', false)).toContain(CHAT_CANVAS_NUDGE);
  });

  it('adds nothing once the session exists', () => {
    expect(geminiSessionPreamble('META', true)).toBe('');
  });
});
