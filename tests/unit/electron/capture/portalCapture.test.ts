import { describe, it, expect, vi } from 'vitest';
import { capturePortal, type PortalCaptureDeps, type PortalStream } from '../../../../electron/capture/portalCapture';

const stream = (over: Partial<PortalStream> = {}): PortalStream => ({
  nodeId: 42,
  restoreToken: 'fresh-token',
  close: async () => {},
  ...over,
});

const baseDeps = (over: Partial<PortalCaptureDeps>): PortalCaptureDeps => ({
  available: () => true,
  openStream: async () => stream(),
  grabFrame: async () => ({ base64: 'PNG', rgba: Buffer.from([1, 2, 3]) }),
  readToken: () => 'old-token',
  writeToken: () => {},
  ...over,
});

describe('capturePortal', () => {
  it('captures a frame and persists the fresh single-use restore token', async () => {
    const writeToken = vi.fn();
    const openStream = vi.fn(async () => stream());
    const r = await capturePortal(baseDeps({ writeToken, openStream }));
    expect(r).toEqual({ ok: true, base64: 'PNG', rgba: Buffer.from([1, 2, 3]) });
    expect(openStream).toHaveBeenCalledWith('old-token');
    expect(writeToken).toHaveBeenCalledWith('fresh-token');
  });

  it('reports unavailable when the portal or frame grabber is missing', async () => {
    const r = await capturePortal(baseDeps({ available: () => false }));
    expect(r).toEqual({ ok: false, reason: 'unavailable', message: expect.stringContaining('unavailable') });
  });

  it('clears a stored token when the picker is declined so the next attempt starts clean', async () => {
    const writeToken = vi.fn();
    const r = await capturePortal(baseDeps({
      writeToken,
      openStream: async () => { throw new Error('the picker was cancelled'); },
    }));
    expect(r).toEqual({ ok: false, reason: 'declined', message: expect.stringContaining('cancelled') });
    expect(writeToken).toHaveBeenCalledWith(null);
  });

  it('does not clear anything when declining with no stored token', async () => {
    const writeToken = vi.fn();
    await capturePortal(baseDeps({
      readToken: () => null,
      writeToken,
      openStream: async () => { throw new Error('timed out'); },
    }));
    expect(writeToken).not.toHaveBeenCalled();
  });

  it('closes the session even when the frame grab fails', async () => {
    const close = vi.fn(async () => {});
    const r = await capturePortal(baseDeps({
      openStream: async () => stream({ close }),
      grabFrame: async () => { throw new Error('gst exploded'); },
    }));
    expect(r).toEqual({ ok: false, reason: 'error', message: expect.stringContaining('gst exploded') });
    expect(close).toHaveBeenCalled();
  });

  it('closes the session after a successful capture', async () => {
    const close = vi.fn(async () => {});
    await capturePortal(baseDeps({ openStream: async () => stream({ close }) }));
    expect(close).toHaveBeenCalled();
  });
});
