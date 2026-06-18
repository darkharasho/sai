import { describe, it, expect } from 'vitest';
import { selectBackendChain, type CaptureEnv } from '../../../../electron/capture/selectBackend';

const env = (o: Partial<CaptureEnv>): CaptureEnv => ({
  platform: 'linux', sessionType: undefined, desktop: undefined, has: () => true, ...o,
});

describe('selectBackendChain', () => {
  it('windows: desktopCapturer only', () => {
    expect(selectBackendChain(env({ platform: 'win32' }))).toEqual(['desktopCapturer']);
  });

  it('macOS: desktopCapturer then screencapture', () => {
    expect(selectBackendChain(env({ platform: 'darwin' }))).toEqual(['desktopCapturer', 'screencapture']);
  });

  it('linux X11: desktopCapturer only', () => {
    expect(selectBackendChain(env({ platform: 'linux', sessionType: 'x11' }))).toEqual(['desktopCapturer']);
  });

  it('linux Wayland + KDE: desktopCapturer then spectacle', () => {
    expect(selectBackendChain(env({ sessionType: 'wayland', desktop: 'KDE' }))).toEqual(['desktopCapturer', 'spectacle']);
  });

  it('linux Wayland + wlroots: desktopCapturer then grim', () => {
    expect(selectBackendChain(env({ sessionType: 'wayland', desktop: 'sway' }))).toEqual(['desktopCapturer', 'grim']);
  });

  it('omits fallbacks whose binary is missing', () => {
    expect(selectBackendChain(env({ sessionType: 'wayland', desktop: 'KDE', has: () => false })))
      .toEqual(['desktopCapturer']);
  });
});
