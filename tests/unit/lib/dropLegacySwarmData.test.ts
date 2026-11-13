import { describe, it, expect, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { dropLegacySwarmData } from '@/lib/dropLegacySwarmData';

function stubDelete(fire: (req: any) => void) {
  const req: any = {};
  const spy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
    queueMicrotask(() => fire(req));
    return req;
  });
  return spy;
}

describe('dropLegacySwarmData', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deletes the sai-swarm database', async () => {
    const spy = stubDelete((r) => r.onsuccess?.());
    await dropLegacySwarmData();
    expect(spy).toHaveBeenCalledWith('sai-swarm');
  });

  it('resolves when the request errors', async () => {
    stubDelete((r) => r.onerror?.());
    await expect(dropLegacySwarmData()).resolves.toBeUndefined();
  });

  it('resolves when the request is blocked', async () => {
    stubDelete((r) => r.onblocked?.());
    await expect(dropLegacySwarmData()).resolves.toBeUndefined();
  });
});
