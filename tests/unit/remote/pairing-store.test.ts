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

  it('issuing with a matching clientId revokes the prior row', async () => {
    let t = 1000;
    const store = new PairingStore(':memory:', () => t++);
    const first = await store.issue('iPhone', 'client-A');
    await store.issue('iPhone (re-pair)', 'client-A');
    const rows = store.list();
    // newest first
    expect(rows[0].label).toBe('iPhone (re-pair)');
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[1].label).toBe('iPhone');
    expect(rows[1].revokedAt).not.toBeNull();
    // prior token no longer verifies
    expect(await store.verify(first.token)).toBeNull();
  });

  it('issuing with a clientId does not touch rows with a different clientId', async () => {
    const store = new PairingStore(':memory:');
    const other = await store.issue('Pixel', 'client-B');
    await store.issue('iPhone', 'client-A');
    const rows = store.list();
    const pixel = rows.find((r) => r.label === 'Pixel');
    expect(pixel?.revokedAt).toBeNull();
    expect(await store.verify(other.token)).not.toBeNull();
  });

  it('issuing with a clientId does not touch rows with null clientId', async () => {
    const store = new PairingStore(':memory:');
    const legacy = await store.issue('Legacy');
    await store.issue('iPhone', 'client-A');
    expect(await store.verify(legacy.token)).not.toBeNull();
  });

  it('issuing without a clientId never revokes anything', async () => {
    const store = new PairingStore(':memory:');
    const a = await store.issue('A');
    await store.issue('B');
    expect(await store.verify(a.token)).not.toBeNull();
  });

  it('list() exposes clientId on each entry', async () => {
    const store = new PairingStore(':memory:');
    await store.issue('iPhone', 'client-A');
    await store.issue('Legacy');
    const rows = store.list();
    expect(rows.find((r) => r.label === 'iPhone')?.clientId).toBe('client-A');
    expect(rows.find((r) => r.label === 'Legacy')?.clientId).toBeNull();
  });
});
