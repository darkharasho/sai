// Per-device push registrations: what a paired phone sent in push.register, so
// the desktop can seal and send it notifications through the relay. Keyed by
// the bridge's deviceId (pairing-store), persisted to
// userData/push-registrations.json (mode 0600, written atomically).
//
// The desktop never trusts the phone: every field is validated here, both from
// the wire and from disk.
import fs from 'node:fs';
import path from 'node:path';

export type PushEnv = 'sandbox' | 'production';

export interface PushRegistration {
  /** The relay's id for the phone (16 random bytes, base64url). */
  pushId: string;
  /** This desktop's send secret for that pushId (32 random bytes, base64url). */
  sendSecret: string;
  /** The relay's id for the send secret (16 random bytes, base64url). */
  secretId: string;
  /** AES-256-GCM key the phone's extension opens pushes with (32 bytes, standard base64). */
  sealKey: string;
  /** The phone's name for this desktop's key. */
  keyId: string;
  env: PushEnv;
}

// Mirrors relay/src/index.ts ID_RE / TOKEN_RE.
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// 32 bytes in padded standard base64 is 43 characters and one '='.
const SEAL_KEY_RE = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ENVS: readonly PushEnv[] = ['sandbox', 'production'];

const isDeviceId = (v: unknown): v is string =>
  typeof v === 'string' && DEVICE_ID_RE.test(v) && !(v in Object.prototype);

/** Validates a push.register frame (or a stored row). Returns the clean registration or the first bad field. */
export function parsePushRegistration(raw: unknown): PushRegistration | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'frame' };
  const o = raw as Record<string, unknown>;
  const check = (field: string, re: RegExp): string | null =>
    (typeof o[field] === 'string' && re.test(o[field] as string) ? (o[field] as string) : null);
  const pushId = check('pushId', ID_RE);
  if (!pushId) return { error: 'pushId' };
  const sendSecret = check('sendSecret', TOKEN_RE);
  if (!sendSecret) return { error: 'sendSecret' };
  const secretId = check('secretId', ID_RE);
  if (!secretId) return { error: 'secretId' };
  const sealKey = check('sealKey', SEAL_KEY_RE);
  if (!sealKey || Buffer.from(sealKey, 'base64').length !== 32) return { error: 'sealKey' };
  const keyId = check('keyId', KEY_ID_RE);
  if (!keyId) return { error: 'keyId' };
  const env = ENVS.find((e) => e === o.env);
  if (!env) return { error: 'env' };
  return { pushId, sendSecret, secretId, sealKey, keyId, env };
}

const same = (a: PushRegistration, b: PushRegistration): boolean =>
  a.pushId === b.pushId && a.sendSecret === b.sendSecret && a.secretId === b.secretId
  && a.sealKey === b.sealKey && a.keyId === b.keyId && a.env === b.env;

/**
 * deviceId → registration. Pass ':memory:' for an unpersisted registry (tests).
 * Writes are synchronous: the file is a few hundred bytes and changes only on
 * register / unregister / revoke / a relay "gone" answer, never per message.
 */
export class PushRegistry {
  private readonly regs = new Map<string, PushRegistration>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly file: string, private readonly onError: (err: unknown) => void = () => {}) {
    if (file !== ':memory:') this.load();
  }

  get(deviceId: string): PushRegistration | null {
    const r = this.regs.get(deviceId);
    return r ? { ...r } : null;
  }

  /** Every registration (a copy). */
  all(): Array<{ deviceId: string; reg: PushRegistration }> {
    return [...this.regs].map(([deviceId, reg]) => ({ deviceId, reg: { ...reg } }));
  }

  get size(): number { return this.regs.size; }

  /** Stores the device's registration; returns false (no write) when it is unchanged (a replay). */
  set(deviceId: string, reg: PushRegistration): boolean {
    if (!isDeviceId(deviceId)) throw new Error('invalid deviceId');
    const clean = parsePushRegistration(reg);
    if ('error' in clean) throw new Error(`invalid registration: ${clean.error}`);
    const prev = this.regs.get(deviceId);
    if (prev && same(prev, clean)) return false;
    this.regs.set(deviceId, clean);
    this.persist();
    return true;
  }

  /**
   * Drops the device's registration. With `onlyIf`, only when the current one
   * matches (a relay "gone" answer for an old secret must not delete a newer
   * registration the phone sent meanwhile).
   */
  delete(deviceId: string, onlyIf?: (reg: PushRegistration) => boolean): boolean {
    const cur = this.regs.get(deviceId);
    if (!cur || (onlyIf && !onlyIf({ ...cur }))) return false;
    this.regs.delete(deviceId);
    this.persist();
    return true;
  }

  /** Drops every registration whose device fails `keep` (unknown or revoked). */
  prune(keep: (deviceId: string) => boolean): void {
    let changed = false;
    for (const id of [...this.regs.keys()]) {
      if (!keep(id)) { this.regs.delete(id); changed = true; }
    }
    if (changed) this.persist();
  }

  /** Called after every change (main reacts to the first registration). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private load(): void {
    let data: unknown;
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') this.onError(err);
      return;
    }
    const devices = data && typeof data === 'object' ? (data as { devices?: unknown }).devices : null;
    if (!devices || typeof devices !== 'object' || Array.isArray(devices)) return;
    for (const [deviceId, raw] of Object.entries(devices as Record<string, unknown>)) {
      if (!isDeviceId(deviceId)) continue;
      const reg = parsePushRegistration(raw);
      if (!('error' in reg)) this.regs.set(deviceId, reg);
    }
  }

  private persist(): void {
    for (const cb of this.listeners) { try { cb(); } catch (err) { this.onError(err); } }
    if (this.file === ':memory:') return;
    const devices: Record<string, PushRegistration> = {};
    for (const [id, reg] of this.regs) devices[id] = reg;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // 'w' with mode creates 0600; fchmod also tightens a leftover temp file.
      const fd = fs.openSync(tmp, 'w', 0o600);
      try {
        fs.fchmodSync(fd, 0o600);
        fs.writeFileSync(fd, JSON.stringify({ v: 1, devices }));
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, this.file);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      this.onError(err);
    }
  }
}

/** The pairing store surface bindRevocation needs. */
export interface RevocationSource {
  list(): Array<{ id: string; revokedAt: number | null }>;
  onRevoke(cb: (deviceId: string) => void): () => void;
}

/**
 * Keeps the registry in step with pairing: drops registrations for devices
 * that are unknown or already revoked now, and for every later revoke
 * (Settings → Revoke, or a re-pair that supersedes the old device row).
 */
export function bindRevocation(pairing: RevocationSource, registry: PushRegistry): () => void {
  const live = new Set(pairing.list().filter((d) => !d.revokedAt).map((d) => d.id));
  registry.prune((id) => live.has(id));
  return pairing.onRevoke((deviceId) => { registry.delete(deviceId); });
}
