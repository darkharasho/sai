import { randomBytes } from 'node:crypto';

interface Entry { cwd: string; path: string; expiresAt: number }

export interface BlobStoreOpts { now?: () => number }

export class BlobStore {
  private readonly map = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(opts: BlobStoreOpts = {}) {
    this.now = opts.now ?? Date.now;
  }

  register(cwd: string, path: string, ttlMs = 60_000): string {
    const id = randomBytes(16).toString('base64url');
    this.map.set(id, { cwd, path, expiresAt: this.now() + ttlMs });
    return id;
  }

  consume(id: string): { cwd: string; path: string } | null {
    const entry = this.map.get(id);
    if (!entry) return null;
    this.map.delete(id);
    if (entry.expiresAt < this.now()) return null;
    return { cwd: entry.cwd, path: entry.path };
  }
}
