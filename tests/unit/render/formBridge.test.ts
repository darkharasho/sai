import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { registerPendingForm, submitForm, _resetForTests } from '../../../src/render/formBridge';

beforeEach(() => { _resetForTests(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('formBridge', () => {
  it('resolves with the submitted value', async () => {
    const { promise } = registerPendingForm(1000);
    submitForm({ choice: 'B' });
    await expect(promise).resolves.toEqual({ ok: true, value: { choice: 'B' } });
  });

  it('resolves dismissed on timeout', async () => {
    const { promise } = registerPendingForm(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toEqual({ ok: false, dismissed: true, error: 'form timed out' });
  });

  it('is FIFO: first submit resolves the first-registered form', async () => {
    const a = registerPendingForm(5000);
    const b = registerPendingForm(5000);
    submitForm('first');
    submitForm('second');
    await expect(a.promise).resolves.toEqual({ ok: true, value: 'first' });
    await expect(b.promise).resolves.toEqual({ ok: true, value: 'second' });
  });

  it('submitForm with no pending form is a no-op', () => {
    expect(() => submitForm('orphan')).not.toThrow();
  });

  it('cancel resolves dismissed and removes the form from the queue', async () => {
    const { promise, cancel } = registerPendingForm(5000);
    cancel();
    await expect(promise).resolves.toEqual({ ok: false, dismissed: true, error: 'form cancelled' });
    expect(() => submitForm('late')).not.toThrow();
  });

  it('a submitted form clears its timeout (no late dismissal)', async () => {
    const { promise } = registerPendingForm(1000);
    submitForm('done');
    vi.advanceTimersByTime(2000);
    await expect(promise).resolves.toEqual({ ok: true, value: 'done' });
  });
});
