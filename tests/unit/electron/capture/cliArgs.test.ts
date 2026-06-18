import { describe, it, expect } from 'vitest';
import { spectacleArgs, grimArgs, screencaptureArgs } from '../../../../electron/capture/cliArgs';

describe('cliArgs', () => {
  it('spectacle: background, no-notify, active window, output path', () => {
    expect(spectacleArgs('/tmp/x.png')).toEqual(['-b', '-n', '-a', '-o', '/tmp/x.png']);
  });
  it('grim: just the output path', () => {
    expect(grimArgs('/tmp/x.png')).toEqual(['/tmp/x.png']);
  });
  it('screencapture: silent, no shadow, output path', () => {
    expect(screencaptureArgs('/tmp/x.png')).toEqual(['-x', '-o', '/tmp/x.png']);
  });
});
