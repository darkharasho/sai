import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { PairingStore } from '@electron/services/remote/pairing-store';

function freshStore(): { store: PairingStore; db: Database.Database } {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE paired_devices (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL,
      paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
    );
  `);
  return { store: new PairingStore(db), db };
}

describe('PairingStore', () => {
  it('issues and verifies a token', async () => {
    const { store } = freshStore();
    const { deviceId, token } = await store.issue('iPhone');
    const found = await store.verify(token);
    expect(found?.id).toBe(deviceId);
    expect(found?.label).toBe('iPhone');
  });

  it('returns null for wrong token', async () => {
    const { store } = freshStore();
    await store.issue('iPhone');
    expect(await store.verify('wrong-token')).toBeNull();
  });

  it('returns null after revoke', async () => {
    const { store } = freshStore();
    const { deviceId, token } = await store.issue('iPhone');
    store.revoke(deviceId);
    expect(await store.verify(token)).toBeNull();
  });

  it('updates last_seen_at on verify', async () => {
    const { store } = freshStore();
    const { token } = await store.issue('iPhone');
    const before = store.list()[0].lastSeenAt;
    await store.verify(token);
    const after = store.list()[0].lastSeenAt;
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });

  it('lists devices newest first', async () => {
    const { store } = freshStore();
    await store.issue('a');
    await new Promise((r) => setTimeout(r, 5));
    await store.issue('b');
    const list = store.list();
    expect(list.map((d) => d.label)).toEqual(['b', 'a']);
  });
});
