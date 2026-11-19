import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seal, open, newSealKey, clampPlain } from '../../../src/lib/push/seal';
import type { PushPlain } from '../../../src/lib/push/types';

const plain: PushPlain = { v: 1, kind: 'done', chatId: 'c1', projectPath: '/p', title: 'T', body: 'B', ts: 1 };

describe('push seal', () => {
  it('seal/open round-trips', async () => {
    const k = newSealKey();
    expect(atob(k).length).toBe(32);
    expect(await open(k, await seal(k, plain))).toEqual(plain);
  });

  it('open with wrong key returns null', async () => {
    const s = await seal(newSealKey(), plain);
    expect(await open(newSealKey(), s)).toBeNull();
    expect(await open(newSealKey(), 'not base64!!')).toBeNull();
  });

  it('fixed key+nonce matches seal-vectors.json', async () => {
    const vectors = JSON.parse(readFileSync(join(__dirname, '../../fixtures/push/seal-vectors.json'), 'utf8'));
    expect(vectors.length).toBe(3);
    for (const v of vectors) {
      const nonce = Uint8Array.from(atob(v.nonceB64), (c) => c.charCodeAt(0));
      expect(await seal(v.keyB64, v.plain, nonce)).toBe(v.sealedB64);
      expect(await open(v.keyB64, v.sealedB64)).toEqual(v.plain);
    }
  });

  it('clampPlain truncates title 80 / body 180 by code points', () => {
    const c = clampPlain({ ...plain, title: '😀'.repeat(100), body: '日'.repeat(300) });
    expect([...c.title].length).toBe(80);
    expect([...c.body].length).toBe(180);
    expect(c.title).toBe('😀'.repeat(80));
    expect(clampPlain(plain)).toEqual(plain);
  });

  it('sealed blob for max-size plain is under 3000 base64 chars', async () => {
    const big = clampPlain({ ...plain, chatId: 'x'.repeat(500), projectPath: '/' + 'p'.repeat(2000), title: '😀'.repeat(200), body: '😀'.repeat(400) });
    expect([...big.chatId].length).toBe(128);
    expect([...big.projectPath].length).toBe(512);
    expect((await seal(newSealKey(), big)).length).toBeLessThan(3000);
  });

  it('seal rejects a non-12-byte nonce', async () => {
    await expect(seal(newSealKey(), plain, new Uint8Array(8))).rejects.toThrow();
  });

  describe('open never throws', () => {
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    const rawSeal = async (k: string, text: string) => {
      const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(k), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
      const iv = new Uint8Array(12).fill(7);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
      return b64(new Uint8Array([...iv, ...ct]));
    };
    it('short blobs', async () => {
      const k = newSealKey();
      expect(await open(k, b64(new Uint8Array(27)))).toBeNull();
      expect(await open(k, b64(new Uint8Array(5)))).toBeNull();
    });
    it('tampered ciphertext', async () => {
      const k = newSealKey();
      const u = Uint8Array.from(atob(await seal(k, plain)), (c) => c.charCodeAt(0));
      u[14] ^= 1;
      expect(await open(k, b64(u))).toBeNull();
    });
    it('authentic non-JSON', async () => {
      const k = newSealKey();
      expect(await open(k, await rawSeal(k, 'not json'))).toBeNull();
    });
    it('authentic malformed shapes', async () => {
      const k = newSealKey();
      for (const bad of [{}, [], null, { ...plain, v: 2 }, { ...plain, title: 5 }, { ...plain, kind: 'x' }, { ...plain, ts: 'a' }]) {
        expect(await open(k, await rawSeal(k, JSON.stringify(bad)))).toBeNull();
      }
    });
  });
});
