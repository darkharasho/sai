import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveContained } from './renderProtocol';
import { modelExt, type ModelExt } from '../../src/model3d/modelFiles';

export const MODEL_CACHE_CAP_BYTES = 200 * 1024 * 1024;

const KEY_RE = /^[0-9a-f]{32}$/;
// Cache entries: <32hex>.<ext>. Thumbnails live in tool-result images now, not
// here; prune still tolerates (and removes with the key) any stray <key>.png.
const FILE_RE = /^([0-9a-f]{32})\.([A-Za-z0-9]+)$/;

export function isVersionKey(k: unknown): k is string {
  return typeof k === 'string' && KEY_RE.test(k);
}

export type SnapshotResult =
  | { ok: true; versionKey: string; ext: ModelExt; absPath: string; bytes: number }
  | { ok: false; error: string };

export function snapshotModel(opts: {
  cwd: string;
  path: string;
  allowedRoots: string[];
  dir: string;
  capBytes?: number;
}): SnapshotResult {
  const res = resolveContained([opts.cwd, ...opts.allowedRoots], path.resolve(opts.cwd, opts.path));
  if (!res.path) {
    return res.reason === 'missing'
      ? { ok: false, error: `path not found: ${opts.path}` }
      : { ok: false, error: `path escapes workspace: ${opts.path}` };
  }
  const absPath = res.path;
  let ext = modelExt(absPath);
  if (!ext) return { ok: false, error: `unsupported model type: ${opts.path}` };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    return { ok: false, error: `path not found: ${opts.path}` };
  }
  const versionKey = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  try {
    fs.mkdirSync(opts.dir, { recursive: true });
    // One file per key: hit check by stem, regardless of extension.
    const existing = fs.readdirSync(opts.dir).find((n) => {
      const m = FILE_RE.exec(n);
      return m && m[1] === versionKey && modelExt(n);
    });
    if (existing) {
      const now = new Date();
      fs.utimesSync(path.join(opts.dir, existing), now, now);
      ext = modelExt(existing) as ModelExt;
    } else {
      const dest = path.join(opts.dir, `${versionKey}.${ext}`);
      const tmp = path.join(opts.dir, `.${versionKey}.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
    }
    enforceCap(opts.dir, opts.capBytes ?? MODEL_CACHE_CAP_BYTES, versionKey);
  } catch (err) {
    return { ok: false, error: `model cache write failed: ${(err as Error).message}` };
  }
  return { ok: true, versionKey, ext, absPath, bytes: buf.length };
}

export function readCachedModel(versionKey: string, dir: string): Buffer | null {
  if (!isVersionKey(versionKey)) return null;
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = FILE_RE.exec(name);
      if (m && m[1] === versionKey && modelExt(name)) return fs.readFileSync(path.join(dir, name));
    }
  } catch {
    // missing dir / unreadable file
  }
  return null;
}

interface KeyGroup {
  files: { file: string; size: number }[];
  size: number;
  mtime: number;
}

function groupByKey(dir: string): Map<string, KeyGroup> {
  const groups = new Map<string, KeyGroup>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return groups;
  }
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const g = groups.get(m[1]) ?? { files: [], size: 0, mtime: 0 };
    g.files.push({ file, size: st.size });
    g.size += st.size;
    // Eviction order follows the mesh's mtime; fall back to any file's.
    if (modelExt(name)) g.mtime = st.mtimeMs;
    else if (g.mtime === 0) g.mtime = st.mtimeMs;
    groups.set(m[1], g);
  }
  return groups;
}

function removeGroup(g: KeyGroup): number {
  let freed = 0;
  for (const f of g.files) {
    try {
      fs.unlinkSync(f.file);
      freed += f.size;
    } catch {
      // already gone
    }
  }
  return freed;
}

export function pruneModelCache(referencedKeys: string[], dir: string): { deleted: number; freedBytes: number } {
  const keep = new Set(referencedKeys.filter(isVersionKey));
  let deleted = 0;
  let freedBytes = 0;
  for (const [key, g] of groupByKey(dir)) {
    if (keep.has(key)) continue;
    deleted += g.files.length;
    freedBytes += removeGroup(g);
  }
  return { deleted, freedBytes };
}

/** Evicts whole keys (mesh + thumbnail), oldest mesh mtime first, until under cap. */
export function enforceCap(dir: string, capBytes: number, protectKey?: string): void {
  const groups = groupByKey(dir);
  let total = 0;
  for (const g of groups.values()) total += g.size;
  if (total <= capBytes) return;
  const order = [...groups.entries()].sort((a, b) => a[1].mtime - b[1].mtime);
  for (const [key, g] of order) {
    if (total <= capBytes) break;
    if (key === protectKey) continue;
    total -= g.size;
    removeGroup(g);
  }
}
