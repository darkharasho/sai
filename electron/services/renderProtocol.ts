import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export const INLINE_ENTRY = '__sai_inline__';

// Set as a response header (src-mode iframes can't use the srcDoc <meta> CSP).
// File access is bounded by the protocol handler; network is allowed per design.
export const RENDER_CSP =
  "default-src 'self' sai-render:; " +
  "script-src 'self' sai-render: https: 'unsafe-inline'; " +
  "style-src 'self' sai-render: https: 'unsafe-inline'; " +
  "img-src 'self' sai-render: https: data:; " +
  "font-src 'self' sai-render: https: data:; " +
  "connect-src 'self' sai-render: https:;";

const TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_ENTRIES = 200;

export interface RenderTokenEntry {
  root: string; // realpath'd workspace root
  inlineHtml?: string;
  createdAt: number;
}

export interface RenderProtocolStore {
  tokens: Map<string, RenderTokenEntry>;
}

export function createRenderProtocolStore(): RenderProtocolStore {
  return { tokens: new Map() };
}

function now(): number {
  // Date.now is fine in Electron main (not a workflow script).
  return Date.now();
}

export function mintRenderToken(
  store: RenderProtocolStore,
  opts: { root: string; inlineHtml?: string },
): string {
  sweep(store);
  if (store.tokens.size >= MAX_ENTRIES) {
    // Evict oldest.
    const oldest = [...store.tokens.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    )[0];
    if (oldest) store.tokens.delete(oldest[0]);
  }
  const realRoot = fs.realpathSync(opts.root);
  const token = crypto.randomBytes(16).toString('hex');
  store.tokens.set(token, {
    root: realRoot,
    inlineHtml: opts.inlineHtml,
    createdAt: now(),
  });
  return token;
}

export function evictRenderToken(store: RenderProtocolStore, token: string): void {
  store.tokens.delete(token);
}

function sweep(store: RenderProtocolStore): void {
  const cutoff = now() - TTL_MS;
  for (const [t, e] of store.tokens) {
    if (e.createdAt < cutoff) store.tokens.delete(t);
  }
}

export type ResolveResult =
  | { ok: true; filePath: string; inlineHtml?: undefined }
  | { ok: true; inlineHtml: string; filePath?: undefined }
  | { ok: false; status: number };

export function resolveRenderAsset(
  store: RenderProtocolStore,
  token: string,
  rawPath: string,
): ResolveResult {
  const entry = store.tokens.get(token);
  if (!entry) return { ok: false, status: 404 };

  let rel: string;
  try {
    rel = decodeURIComponent(rawPath).replace(/^\/+/, '');
  } catch {
    return { ok: false, status: 400 };
  }
  if (rel === INLINE_ENTRY && entry.inlineHtml != null) {
    return { ok: true, inlineHtml: entry.inlineHtml };
  }
  if (path.isAbsolute(rel)) return { ok: false, status: 403 };

  const candidate = path.resolve(entry.root, rel || 'index.html');
  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    return { ok: false, status: 404 };
  }
  if (
    realCandidate !== entry.root &&
    !realCandidate.startsWith(entry.root + path.sep)
  ) {
    return { ok: false, status: 403 };
  }
  return { ok: true, filePath: realCandidate };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function contentTypeFor(p: string): string {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}
