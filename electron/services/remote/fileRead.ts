// Remote v2 file.read: the bytes behind a chat's file references, as a data
// URL. Two kinds only, each confined to its own userData directory:
//   toolImage — a stored tool-result image (the `filePath` a chat carries);
//               it must realpath inside the tool-result image dir, so neither
//               `..` nor a symlink can reach anything else.
//   model     — a 3D model snapshot by versionKey (the model:readCached path).
import fs from 'node:fs';
import path from 'node:path';
import { cachedModelPath, isVersionKey } from '../modelCache';

/** Largest file file.read returns; bigger ones answer `error: 'too_large'`. */
export const FILE_READ_MAX_BYTES = 25 * 1024 * 1024;

export type FileReadKind = 'toolImage' | 'model';
export type FileReadResult = { dataUrl: string } | { error: string };

export interface FileReadDirs {
  /** userData/tool-result-images */
  toolImages: string;
  /** userData/model-cache */
  modelCache: string;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
};

/** Whether `child` (a realpath) is strictly inside `dir` (a realpath). */
function inside(dir: string, child: string): boolean {
  const base = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return child.startsWith(base);
}

function readCapped(file: string, mime: string, maxBytes: number): FileReadResult {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return { error: 'not_found' }; }
  if (!st.isFile()) return { error: 'not_found' };
  if (st.size > maxBytes) return { error: 'too_large' };
  let buf: Buffer;
  try { buf = fs.readFileSync(file); } catch { return { error: 'read_failed' }; }
  if (buf.byteLength > maxBytes) return { error: 'too_large' };
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
}

export function readRemoteFile(kind: unknown, ref: unknown, dirs: FileReadDirs, maxBytes = FILE_READ_MAX_BYTES): FileReadResult {
  if (typeof ref !== 'string' || !ref || ref.includes('\0')) return { error: 'bad_request' };
  if (kind === 'toolImage') {
    if (!path.isAbsolute(ref)) return { error: 'forbidden' };
    let realDir: string;
    let real: string;
    try { realDir = fs.realpathSync(dirs.toolImages); } catch { return { error: 'not_found' }; }
    try { real = fs.realpathSync(ref); } catch { return { error: 'not_found' }; }
    if (!inside(realDir, real)) return { error: 'forbidden' };
    const ext = path.extname(real).slice(1).toLowerCase();
    return readCapped(real, IMAGE_MIME[ext] ?? 'application/octet-stream', maxBytes);
  }
  if (kind === 'model') {
    if (!isVersionKey(ref)) return { error: 'bad_request' };
    const file = cachedModelPath(ref, dirs.modelCache);
    if (!file) return { error: 'not_found' };
    return readCapped(file, 'application/octet-stream', maxBytes);
  }
  return { error: 'bad_request' };
}
