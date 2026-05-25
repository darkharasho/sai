import { describe, it, expect } from 'vitest';
import { PairingStore } from '@electron/services/remote/pairing-store';

describe('PairingStore', () => {
  it('issues and verifies a token', async () => {
    const store = new PairingStore(':memory:');
    const { deviceId, token } = await store.issue('iPhone');
    const found = await store.verify(token);
    expect(found?.id).toBe(deviceId);
    expect(found?.label).toBe('iPhone');
  });

  it('returns null for wrong token', async () => {
    const store = new PairingStore(':memory:');
    await store.issue('iPhone');
    expect(await store.verify('wrong-token')).toBeNull();
  });

  it('returns null after revoke', async () => {
    const store = new PairingStore(':memory:');
    const { deviceId, token } = await store.issue('iPhone');
    store.revoke(deviceId);
    expect(await store.verify(token)).toBeNull();
  });

  it('updates last_seen_at on verify', async () => {
    let t = 1000;
    const store = new PairingStore(':memory:', () => t++);
    const { token } = await store.issue('iPhone');
    const before = store.list()[0].lastSeenAt;
    await store.verify(token);
    const after = store.list()[0].lastSeenAt;
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });

  it('lists devices newest first', async () => {
    let t = 1000;
    const store = new PairingStore(':memory:', () => t++);
    await store.issue('a');
    await store.issue('b');
    expect(store.list().map((d) => d.label)).toEqual(['b', 'a']);
  });
});
