// Sealed push payload v1: base64(nonce[12] || ciphertext || tag[16]), AES-256-GCM, no AAD.
// Matches CryptoKit AES.GCM.SealedBox(combined:). Uses globalThis.crypto only (Node, WKWebView, jsdom).
import type { PushPlain } from './types';
import { PUSH_TITLE_MAX, PUSH_BODY_MAX } from './types';

const b64enc = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const b64dec = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const importKey = (keyB64: string, usage: 'encrypt' | 'decrypt') =>
  globalThis.crypto.subtle.importKey('raw', b64dec(keyB64), 'AES-GCM', false, [usage]);

export function newSealKey(): string {
  return b64enc(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export async function seal(keyB64: string, plain: PushPlain, nonce?: Uint8Array): Promise<string> {
  const iv = (nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(12))) as Uint8Array<ArrayBuffer>;
  const key = await importKey(keyB64, 'encrypt');
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(plain))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64enc(out);
}

export async function open(keyB64: string, sealedB64: string): Promise<PushPlain | null> {
  try {
    const all = b64dec(sealedB64);
    if (all.length < 28) return null;
    const key = await importKey(keyB64, 'decrypt');
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
    return JSON.parse(new TextDecoder().decode(pt)) as PushPlain;
  } catch {
    return null;
  }
}

const cut = (s: string, n: number): string => {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n).join('');
};

export function clampPlain(p: PushPlain): PushPlain {
  return { ...p, title: cut(p.title, PUSH_TITLE_MAX), body: cut(p.body, PUSH_BODY_MAX) };
}
