import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
    const vectors = JSON.parse(readFileSync('tests/fixtures/push/seal-vectors.json', 'utf8'));
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
    const big = clampPlain({ ...plain, chatId: 'x'.repeat(100), projectPath: '/' + 'p'.repeat(500), title: '😀'.repeat(200), body: '😀'.repeat(400) });
    expect((await seal(newSealKey(), big)).length).toBeLessThan(3000);
  });
});
