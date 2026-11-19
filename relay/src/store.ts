export type ApnsEnv = 'sandbox' | 'production';

export interface Registration {
  pushId: string;
  ownerHash: string;
  apnsToken: string;
  env: ApnsEnv;
  createdAt: number;
  updatedAt: number;
}

export interface SecretRow {
  secretId: string;
  pushId: string;
  secretHash: string;
  label: string;
  createdAt: number;
}

/** Persistence for the relay. Only hashes of bearer secrets are ever stored. */
export interface Store {
  getRegistration(pushId: string): Promise<Registration | null>;
  createRegistration(r: Registration): Promise<void>;
  updateRegistration(pushId: string, apnsToken: string, env: ApnsEnv, now: number): Promise<void>;
  /** Deletes the registration and all of its send secrets. */
  deleteRegistration(pushId: string): Promise<void>;
  listSecrets(pushId: string): Promise<Pick<SecretRow, 'secretId' | 'secretHash'>[]>;
  addSecret(s: SecretRow): Promise<void>;
  deleteSecret(pushId: string, secretId: string): Promise<boolean>;
}

interface RegRow {
  push_id: string;
  owner_hash: string;
  apns_token: string;
  env: ApnsEnv;
  created_at: number;
  updated_at: number;
}

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async getRegistration(pushId: string): Promise<Registration | null> {
    const r = await this.db
      .prepare('SELECT push_id, owner_hash, apns_token, env, created_at, updated_at FROM registrations WHERE push_id = ?')
      .bind(pushId)
      .first<RegRow>();
    if (!r) return null;
    return {
      pushId: r.push_id,
      ownerHash: r.owner_hash,
      apnsToken: r.apns_token,
      env: r.env,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async createRegistration(r: Registration): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO registrations (push_id, owner_hash, apns_token, env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(r.pushId, r.ownerHash, r.apnsToken, r.env, r.createdAt, r.updatedAt)
      .run();
  }

  async updateRegistration(pushId: string, apnsToken: string, env: ApnsEnv, now: number): Promise<void> {
    await this.db
      .prepare('UPDATE registrations SET apns_token = ?, env = ?, updated_at = ? WHERE push_id = ?')
      .bind(apnsToken, env, now, pushId)
      .run();
  }

  async deleteRegistration(pushId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM send_secrets WHERE push_id = ?').bind(pushId),
      this.db.prepare('DELETE FROM registrations WHERE push_id = ?').bind(pushId),
    ]);
  }

  async listSecrets(pushId: string): Promise<Pick<SecretRow, 'secretId' | 'secretHash'>[]> {
    const { results } = await this.db
      .prepare('SELECT secret_id, secret_hash FROM send_secrets WHERE push_id = ?')
      .bind(pushId)
      .all<{ secret_id: string; secret_hash: string }>();
    return results.map((r) => ({ secretId: r.secret_id, secretHash: r.secret_hash }));
  }

  async addSecret(s: SecretRow): Promise<void> {
    await this.db
      .prepare('INSERT INTO send_secrets (secret_id, push_id, secret_hash, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(s.secretId, s.pushId, s.secretHash, s.label, s.createdAt)
      .run();
  }

  async deleteSecret(pushId: string, secretId: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM send_secrets WHERE push_id = ? AND secret_id = ?')
      .bind(pushId, secretId)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
}
