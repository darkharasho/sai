import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSaveQueue } from '@/lib/sessionSaveQueue';
import type { ChatSession } from '@/types';

function makeSession(id: string): ChatSession {
  const now = Date.now();
  return { id, title: 't', messages: [], messageCount: 0, createdAt: now, updatedAt: now };
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createSaveQueue', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('serializes saves for the same session id', async () => {
    const order: string[] = [];
    const first = deferred<void>();
    const saveFn = vi.fn()
      .mockImplementationOnce(() => { order.push('start-1'); return first.promise; })
      .mockImplementationOnce(() => { order.push('start-2'); return Promise.resolve(); });
    const queue = createSaveQueue(saveFn);
    const s = makeSession('a');
    const p1 = queue('/p', s, 0);
    const p2 = queue('/p', s, 5);
    await flush();
    expect(order).toEqual(['start-1']); // second save must wait
    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start-1', 'start-2']);
    expect(saveFn).toHaveBeenNthCalledWith(2, '/p', s, 5);
  });

  it('runs saves for different session ids concurrently', async () => {
    const first = deferred<void>();
    const started: string[] = [];
    const saveFn = vi.fn((_p: string, sess: ChatSession) => {
      started.push(sess.id);
      return sess.id === 'a' ? first.promise : Promise.resolve();
    });
    const queue = createSaveQueue(saveFn);
    const pa = queue('/p', makeSession('a'));
    const pb = queue('/p', makeSession('b'));
    await flush();
    expect(started).toEqual(['a', 'b']); // b did not wait on a
    first.resolve();
    await Promise.all([pa, pb]);
  });

  it('keeps the queue alive after a failed save', async () => {
    const saveFn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const queue = createSaveQueue(saveFn);
    const s = makeSession('a');
    await expect(queue('/p', s)).rejects.toThrow('boom');
    await expect(queue('/p', s)).resolves.toBeUndefined();
  });

  it('dispatches a throttled sai-persist-error event on failure', async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('sai-persist-error', listener);
    try {
      const saveFn = vi.fn().mockRejectedValue(
        new DOMException('full', 'QuotaExceededError'),
      );
      const queue = createSaveQueue(saveFn);
      await queue('/p', makeSession('a')).catch(() => {});
      await queue('/p', makeSession('b')).catch(() => {});
      expect(events).toHaveLength(1); // second error throttled
      expect(events[0].detail.quota).toBe(true);
    } finally {
      window.removeEventListener('sai-persist-error', listener);
    }
  });
});
