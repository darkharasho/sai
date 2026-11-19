import { describe, expect, it } from 'vitest';
import { _resetJwtCache, getApnsJwt } from '../src/apns';
import { makeP8 } from './helpers';

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const cfg = (pem: string) => ({ APNS_KEY_P8: pem, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM456789' });

describe('APNs JWT', () => {
  it('JWT is ES256 and verifies with the public key', async () => {
    _resetJwtCache();
    const { pem, publicKey } = await makeP8();
    const now = 1_800_000_000_000;
    const jwt = await getApnsJwt(cfg(pem), now);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h!)))).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p!)))).toEqual({
      iss: 'TEAM456789',
      iat: Math.floor(now / 1000),
    });
    const sig = b64urlDecode(s!);
    expect(sig.length).toBe(64); // raw r||s, the JWS ES256 form
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it('caches the token for 50 minutes', async () => {
    _resetJwtCache();
    const { pem } = await makeP8();
    const t0 = 1_800_000_000_000;
    const a = await getApnsJwt(cfg(pem), t0);
    expect(await getApnsJwt(cfg(pem), t0 + 49 * 60_000)).toBe(a);
    const c = await getApnsJwt(cfg(pem), t0 + 51 * 60_000);
    expect(c).not.toBe(a);
  });

  it('a different key id is not served from the cache', async () => {
    _resetJwtCache();
    const { pem } = await makeP8();
    const a = await getApnsJwt(cfg(pem), 0);
    const b = await getApnsJwt({ ...cfg(pem), APNS_KEY_ID: 'OTHERKEY12' }, 0);
    expect(b).not.toBe(a);
  });
});
