import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promises as fsp, existsSync, mkdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface PairedDevice {
  id: string;
  label: string;
  pairedAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

interface Row extends PairedDevice {
  tokenSalt: string;
  tokenHash: string;
}

interface FileShape {
  devices: Row[];
}

const SCRYPT_KEYLEN = 64;

async function hashToken(token: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16);
  const derived = await scrypt(token, salt, SCRYPT_KEYLEN);
  return { salt: salt.toString('base64'), hash: derived.toString('base64') };
}

async function verifyToken(token: string, saltB64: string, hashB64: string): Promise<boolean> {
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(token, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Pairing token store backed by a JSON file. Single-digit row counts;
 * scrypt-hashed bearer tokens; no native dependencies.
 *
 * Pass ':memory:' as path for in-memory mode (tests).
 */
export class PairingStore {
  private rows: Row[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    if (path !== ':memory:') this.loadSync();
  }

  private loadSync(): void {
    try {
      const dir = nodePath.dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(this.path)) { this.rows = []; return; }
      const raw = readFileSync(this.path, 'utf8');
      const data = JSON.parse(raw) as FileShape;
      this.rows = Array.isArray(data.devices) ? data.devices : [];
    } catch {
      this.rows = [];
    }
  }

  private async persist(): Promise<void> {
    if (this.path === ':memory:') return;
    const snapshot = JSON.stringify({ devices: this.rows }, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.path}.tmp`;
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, this.path);
    }).catch(() => { /* swallow; next write retries */ });
    return this.writeChain;
  }

  async issue(label: string): Promise<{ deviceId: string; token: string }> {
    const deviceId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const { salt, hash } = await hashToken(token);
    this.rows.push({
      id: deviceId, label, pairedAt: this.now(), lastSeenAt: null, revokedAt: null,
      tokenSalt: salt, tokenHash: hash,
    });
    await this.persist();
    return { deviceId, token };
  }

  async verify(token: string): Promise<PairedDevice | null> {
    for (const row of this.rows) {
      if (row.revokedAt) continue;
      if (await verifyToken(token, row.tokenSalt, row.tokenHash)) {
        row.lastSeenAt = this.now();
        await this.persist();
        return { id: row.id, label: row.label, pairedAt: row.pairedAt, lastSeenAt: row.lastSeenAt, revokedAt: row.revokedAt };
      }
    }
    return null;
  }

  revoke(deviceId: string): void {
    const row = this.rows.find((r) => r.id === deviceId);
    if (row && !row.revokedAt) {
      row.revokedAt = this.now();
      void this.persist();
    }
  }

  list(): PairedDevice[] {
    return [...this.rows]
      .sort((a, b) => b.pairedAt - a.pairedAt)
      .map((r) => ({ id: r.id, label: r.label, pairedAt: r.pairedAt, lastSeenAt: r.lastSeenAt, revokedAt: r.revokedAt }));
  }
}
