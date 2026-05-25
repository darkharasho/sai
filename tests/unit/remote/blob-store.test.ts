import { describe, it, expect } from 'vitest';
import { BlobStore } from '@electron/services/remote/blob-store';

describe('BlobStore', () => {
  it('register + consume happy path', () => {
    const s = new BlobStore();
    const id = s.register('/repo', 'a.txt', 60_000);
    expect(typeof id).toBe('string');
    expect(s.consume(id)).toEqual({ cwd: '/repo', path: 'a.txt' });
  });

  it('consume twice returns null', () => {
    const s = new BlobStore();
    const id = s.register('/repo', 'a.txt');
    s.consume(id);
    expect(s.consume(id)).toBeNull();
  });

  it('expired entries are not consumable', () => {
    let now = 1_000_000;
    const s = new BlobStore({ now: () => now });
    const id = s.register('/repo', 'a.txt', 100);
    now += 200;
    expect(s.consume(id)).toBeNull();
  });

  it('returns null for unknown id', () => {
    const s = new BlobStore();
    expect(s.consume('nope')).toBeNull();
  });
});
