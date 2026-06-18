import { describe, it, expect } from 'vitest';
import { captureWindowFlow, type CaptureWindowDeps } from '../../../../electron/capture/captureWindow';

const BLANK = Buffer.alloc(4000); // all zero → blank
const CONTENT = (() => { const b = Buffer.alloc(4000); b.fill(200); return b; })();

const baseDeps = (over: Partial<CaptureWindowDeps>): CaptureWindowDeps => ({
  listWindows: async () => [{ id: 'a', title: 'MyApp' }],
  captureSource: async () => ({ base64: 'AAA', rgba: CONTENT, empty: false }),
  captureCli: async () => ({ base64: 'CLI', rgba: CONTENT }),
  chain: ['desktopCapturer'],
  projectNames: ['MyApp'],
  selfSourceId: 'sai',
  raiseWindow: async () => true,
  activeWindowTitle: async () => 'MyApp',
  selfTitle: 'SAI',
  ...over,
});

describe('captureWindowFlow', () => {
  it('returns the desktopCapturer image when not blank', async () => {
    const r = await captureWindowFlow({}, baseDeps({}));
    expect(r).toEqual({ ok: true, __mcpImage: { base64: 'AAA', mimeType: 'image/png' }, window: 'MyApp' });
  });

  it('falls back to the CLI backend when desktopCapturer is blank', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      chain: ['desktopCapturer', 'spectacle'],
      captureSource: async () => ({ base64: 'BLANK', rgba: BLANK, empty: false }),
    }));
    expect(r).toEqual({ ok: true, __mcpImage: { base64: 'CLI', mimeType: 'image/png' }, window: 'MyApp' });
  });

  it('returns candidates when inference is ambiguous', async () => {
    const r = await captureWindowFlow({ target: 'app' }, baseDeps({
      listWindows: async () => [{ id: 'a', title: 'App one' }, { id: 'b', title: 'App two' }],
    }));
    expect(r).toEqual({ ok: false, candidates: ['App one', 'App two'], message: expect.stringContaining('target') });
  });

  it('returns a no-window message when only SAI is present', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      listWindows: async () => [{ id: 'sai', title: 'SAI' }],
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('no external app window') });
  });

  it('reports an empty-frame failure when every backend is blank', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      chain: ['desktopCapturer', 'spectacle'],
      captureSource: async () => ({ base64: 'X', rgba: BLANK, empty: false }),
      captureCli: async () => ({ base64: 'Y', rgba: BLANK }),
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('empty frame') });
  });

  it('advances to the CLI backend when desktopCapturer throws', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      chain: ['desktopCapturer', 'spectacle'],
      captureSource: async () => { throw new Error('boom'); },
    }));
    expect(r).toEqual({ ok: true, __mcpImage: { base64: 'CLI', mimeType: 'image/png' }, window: 'MyApp' });
  });

  it('refuses the CLI fallback when the active window is SAI (never captures SAI)', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      chain: ['desktopCapturer', 'spectacle'],
      captureSource: async () => ({ base64: 'BLANK', rgba: BLANK, empty: false }),
      activeWindowTitle: async () => 'SAI',
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('foreground') });
  });
});
