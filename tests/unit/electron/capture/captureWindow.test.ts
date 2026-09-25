import { describe, it, expect, vi } from 'vitest';
import { captureWindowFlow, type CaptureWindowDeps } from '../../../../electron/capture/captureWindow';

const BLANK = Buffer.alloc(4000); // all zero → blank
const CONTENT = (() => { const b = Buffer.alloc(4000); b.fill(200); return b; })();

const baseDeps = (over: Partial<CaptureWindowDeps>): CaptureWindowDeps => ({
  listWindows: async () => [{ id: 'a', title: 'MyApp' }],
  captureSource: async () => ({ base64: 'AAA', rgba: CONTENT, empty: false }),
  captureCli: async () => ({ base64: 'CLI', rgba: CONTENT }),
  captureDisplay: async () => ({ base64: 'SCREEN', rgba: CONTENT }),
  chain: ['desktopCapturer'],
  projectNames: ['MyApp'],
  selfSourceId: 'sai',
  selfClasses: ['sai'],
  raiseWindow: async () => true,
  activeWindowTitle: async () => 'MyApp',
  selfTitle: 'SAI',
  settleMs: 0,
  sleep: async () => {},
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

  it('returns a target-miss error instead of capturing an unrelated window', async () => {
    const r = await captureWindowFlow({ target: 'conduit-ui' }, baseDeps({
      listWindows: async () => [{ id: 'a', title: '' }],
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('No window matching "conduit-ui"') });
  });

  it('refuses the CLI fallback when the active window is SAI (never captures SAI)', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      chain: ['desktopCapturer', 'spectacle'],
      captureSource: async () => ({ base64: 'BLANK', rgba: BLANK, empty: false }),
      activeWindowTitle: async () => 'SAI',
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('foreground') });
  });

  it('excludes SAI windows by class even when the title is a workspace name', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      listWindows: async () => [{ id: 'other', title: 'axiom', klass: 'sai' }],
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('no external app window') });
  });

  describe('target handling (the portal cannot honour a target)', () => {
    it('prefers the inferred window over the remembered portal selection', async () => {
      const portal = vi.fn(async () => ({ ok: true as const, base64: 'PORTAL', rgba: CONTENT }));
      const r = await captureWindowFlow({ target: 'MyApp' }, baseDeps({ portal }));
      expect(r).toEqual({ ok: true, __mcpImage: { base64: 'AAA', mimeType: 'image/png' }, window: 'MyApp' });
      expect(portal).not.toHaveBeenCalled();
    });

    it('never falls back to the portal when a target was given', async () => {
      const portal = vi.fn(async () => ({ ok: true as const, base64: 'PORTAL', rgba: CONTENT }));
      const r = await captureWindowFlow({ target: 'Firefox' }, baseDeps({
        listWindows: async () => [{ id: 'a', title: 'MyApp' }],
        portal,
      }));
      expect(r).toEqual({
        ok: false,
        candidates: ['MyApp'],
        message: expect.stringContaining('No window matching "Firefox"'),
      });
      expect(portal).not.toHaveBeenCalled();
    });
  });

  describe('portal fallback', () => {
    it('is used when no window could be inferred', async () => {
      const r = await captureWindowFlow({}, baseDeps({
        listWindows: async () => [],
        portal: async () => ({ ok: true, base64: 'PORTAL', rgba: CONTENT }),
      }));
      expect(r).toEqual({ ok: true, __mcpImage: { base64: 'PORTAL', mimeType: 'image/png' }, window: 'portal selection' });
    });

    it('reports a decline rather than a generic no-window error', async () => {
      const r = await captureWindowFlow({}, baseDeps({
        listWindows: async () => [],
        portal: async () => ({ ok: false, reason: 'declined', message: 'Screen capture was not granted' }),
      }));
      expect(r).toEqual({ ok: false, message: expect.stringContaining('not granted') });
    });

    it('reports no external window when the portal is unavailable', async () => {
      const r = await captureWindowFlow({}, baseDeps({
        listWindows: async () => [],
        portal: async () => ({ ok: false, reason: 'unavailable', message: 'screen-capture portal unavailable' }),
      }));
      expect(r).toEqual({ ok: false, message: expect.stringContaining('no external app window') });
    });

    it('ignores a blank portal frame', async () => {
      const r = await captureWindowFlow({}, baseDeps({
        listWindows: async () => [],
        portal: async () => ({ ok: true, base64: 'BLANKPNG', rgba: BLANK }),
      }));
      expect(r).toEqual({ ok: false, message: expect.stringContaining('no external app window') });
    });
  });

  describe('focus settling', () => {
    it('waits for a raised window to become active before capturing', async () => {
      let active = 'SAI';
      const r = await captureWindowFlow({}, baseDeps({
        chain: ['spectacle'],
        settleMs: 1000,
        activeWindowTitle: async () => active,
        raiseWindow: async () => { setTimeout(() => { active = 'MyApp'; }, 0); return true; },
        sleep: async () => { await new Promise((res) => setTimeout(res, 0)); },
      }));
      expect(r).toEqual({ ok: true, __mcpImage: { base64: 'CLI', mimeType: 'image/png' }, window: 'MyApp' });
    });

    it('gives up once the settle budget is exhausted', async () => {
      const r = await captureWindowFlow({}, baseDeps({
        chain: ['spectacle'],
        settleMs: 300,
        activeWindowTitle: async () => 'Something Else',
      }));
      expect(r).toEqual({ ok: false, message: expect.stringContaining('foreground') });
    });
  });

  describe('display capture', () => {
    it('captures the whole monitor and skips window inference', async () => {
      const listWindows = vi.fn(async () => []);
      const r = await captureWindowFlow({ display: true }, baseDeps({ listWindows }));
      expect(r).toEqual({ ok: true, __mcpImage: { base64: 'SCREEN', mimeType: 'image/png' }, window: 'display' });
      expect(listWindows).not.toHaveBeenCalled();
    });

    it('reports a blank display frame', async () => {
      const r = await captureWindowFlow({ display: true }, baseDeps({
        captureDisplay: async () => ({ base64: 'S', rgba: BLANK }),
      }));
      expect(r).toEqual({ ok: false, message: expect.stringContaining('empty frame') });
    });

    it('errors when no display backend exists', async () => {
      const r = await captureWindowFlow({ display: true }, baseDeps({ captureDisplay: undefined }));
      expect(r).toEqual({ ok: false, message: expect.stringContaining('not available') });
    });
  });

  describe('diagnostics', () => {
    const trace = () => {
      const events: Array<{ ev: string; data?: Record<string, unknown> }> = [];
      return { events, log: (ev: string, data?: Record<string, unknown>) => { events.push({ ev, data }); } };
    };
    const names = (t: { events: Array<{ ev: string }> }) => t.events.map((e) => e.ev);

    it('records the window list and the pick on a successful capture', async () => {
      const t = trace();
      await captureWindowFlow({}, baseDeps({ log: t.log }));
      expect(names(t)).toEqual(['flow.start', 'windows.listed', 'infer.result', 'backend.ok']);
      expect(t.events[1].data).toMatchObject({ count: 1 });
      expect(t.events[2].data).toMatchObject({ kind: 'pick', pick: 'MyApp' });
    });

    it('records the active window at focus timeout, which is the diagnosis', async () => {
      const t = trace();
      await captureWindowFlow({}, baseDeps({
        log: t.log,
        chain: ['spectacle'],
        activeWindowTitle: async () => 'SAI',
      }));
      const timeout = t.events.find((e) => e.ev === 'focus.timeout');
      expect(timeout?.data).toMatchObject({ window: 'MyApp', activeTitle: 'SAI', raised: true });
      expect(names(t)).toContain('result.focusFailed');
    });

    it('records why the portal was skipped for an explicit target', async () => {
      const t = trace();
      await captureWindowFlow({ target: 'MyApp' }, baseDeps({
        log: t.log,
        captureSource: async () => ({ base64: 'X', rgba: BLANK, empty: false }),
      }));
      expect(t.events.find((e) => e.ev === 'portal.skipped')?.data).toMatchObject({ why: 'explicit target' });
      expect(names(t)).not.toContain('portal.attempt');
    });

    it('stays silent when no log sink is injected', async () => {
      await expect(captureWindowFlow({}, baseDeps({}))).resolves.toMatchObject({ ok: true });
    });
  });
});
