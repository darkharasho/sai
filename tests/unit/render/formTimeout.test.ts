import { describe, it, expect } from 'vitest';
import { formTimeoutMs } from '../../../src/render/formTimeout';

describe('formTimeoutMs', () => {
  it('defaults to 180000 when no timeout given', () => {
    expect(formTimeoutMs({})).toBe(180000);
    expect(formTimeoutMs(undefined)).toBe(180000);
    expect(formTimeoutMs({ timeoutMs: 'nope' })).toBe(180000);
  });
  it('passes through a valid timeout', () => {
    expect(formTimeoutMs({ timeoutMs: 60000 })).toBe(60000);
  });
  it('clamps below 10000 and above 600000', () => {
    expect(formTimeoutMs({ timeoutMs: 5 })).toBe(10000);
    expect(formTimeoutMs({ timeoutMs: 9999999 })).toBe(600000);
  });
});
