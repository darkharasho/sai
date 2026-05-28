import { describe, it, expect } from 'vitest';
import { withNodeMemoryCap } from '../../../electron/services/shellEnv';

describe('withNodeMemoryCap', () => {
  it('is a no-op when capMB is 0', () => {
    const env = { FOO: 'bar' };
    expect(withNodeMemoryCap(env, 0)).toEqual(env);
  });

  it('is a no-op when capMB is negative', () => {
    const env = { FOO: 'bar' };
    expect(withNodeMemoryCap(env, -1)).toEqual(env);
  });

  it('injects NODE_OPTIONS when capMB > 0 and env has none', () => {
    const out = withNodeMemoryCap({ FOO: 'bar' }, 4096);
    expect(out.NODE_OPTIONS).toBe('--max-old-space-size=4096');
    expect(out.FOO).toBe('bar');
  });

  it('appends to existing NODE_OPTIONS without max-old-space-size', () => {
    const out = withNodeMemoryCap({ NODE_OPTIONS: '--enable-source-maps' }, 2048);
    expect(out.NODE_OPTIONS).toBe('--enable-source-maps --max-old-space-size=2048');
  });

  it('respects an existing --max-old-space-size and leaves env untouched', () => {
    const env = { NODE_OPTIONS: '--max-old-space-size=16384' };
    expect(withNodeMemoryCap(env, 2048)).toEqual(env);
  });

  it('floors fractional caps', () => {
    const out = withNodeMemoryCap({}, 4096.7);
    expect(out.NODE_OPTIONS).toBe('--max-old-space-size=4096');
  });
});
