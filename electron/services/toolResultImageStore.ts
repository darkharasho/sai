// Tool-result images (MCP screenshots, render captures, Codex/ACP image
// output) arrive as inline base64 blocks. Forwarded as-is, every one became a
// `dataUrl` on the tool call, so the chat's single IndexedDB record carried
// tens of MB of base64 and was re-cloned on every save until the clone failed
// ("Data cannot be cloned, out of memory"). Write them to a content-addressed
// file under userData instead and forward a `sai-file` ref, which the renderer
// already lazy-loads via fs:readFileBase64.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

export function toolResultImageDir(): string {
  return path.join(app.getPath('userData'), 'tool-result-images');
}

/** Write base64 image bytes to `<dir>/<sha256>.<ext>` (deduped) and return the path. Throws on write failure. */
export function storeImageBase64(data: string, mimeType: string, dir: string = toolResultImageDir()): string {
  const buf = Buffer.from(data, 'base64');
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const file = path.join(dir, `${hash}.${EXT_BY_MIME[mimeType] ?? 'bin'}`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
  }
  return file;
}

/**
 * Given the filenames present in the image dir and the set of referenced file
 * paths (from persisted chat records), return the filenames that nothing points
 * at. Matching is by basename: the files are content-addressed (sha256.<ext>),
 * so the basename is a stable unique id, and comparing basenames sidesteps the
 * $HOME symlink trap (/home vs /var/home) that full-path equality would hit —
 * a mismatch there would wrongly flag a live image as an orphan and delete it.
 */
export function selectOrphanImages(filenames: string[], referencedPaths: Iterable<string>): string[] {
  const referenced = new Set<string>();
  for (const p of referencedPaths) referenced.add(path.basename(p));
  return filenames.filter((name) => !referenced.has(name));
}

/**
 * Delete every file in `dir` not referenced by `referencedPaths`. Reference-based
 * only — a file survives as long as any kept chat record points at it, so pinned
 * and in-retention chats never lose their images. Returns counts for logging.
 */
export function pruneOrphanImages(
  referencedPaths: string[],
  dir: string = toolResultImageDir(),
): { deleted: number; freedBytes: number } {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { deleted: 0, freedBytes: 0 };
  }
  const orphans = selectOrphanImages(entries, referencedPaths);
  let deleted = 0;
  let freedBytes = 0;
  for (const name of orphans) {
    const file = path.join(dir, name);
    try {
      const size = fs.statSync(file).size;
      fs.unlinkSync(file);
      deleted++;
      freedBytes += size;
    } catch {
      /* file vanished or unreadable — skip */
    }
  }
  return { deleted, freedBytes };
}

function externalizeBlock(block: any, dir: string): any {
  const src = block?.source;
  if (block?.type !== 'image' || src?.type !== 'base64' || typeof src.data !== 'string') return block;
  try {
    const filePath = storeImageBase64(src.data, src.media_type, dir);
    return { ...block, source: { type: 'sai-file', path: filePath, media_type: src.media_type } };
  } catch (err) {
    console.warn('[toolResultImageStore] keeping inline image, write failed:', err);
    return block;
  }
}

/**
 * Return `msg` with base64 image blocks inside tool_result content replaced by
 * `sai-file` refs. Returns the same reference when there is nothing to rewrite;
 * never mutates the input.
 */
export function externalizeToolResultImages<T>(msg: T, dir?: string): T {
  const m = msg as any;
  const content = m?.type === 'user' ? m.message?.content : undefined;
  if (!Array.isArray(content)) return msg;
  const hasImage = content.some((b: any) =>
    b?.type === 'tool_result' && Array.isArray(b.content)
    && b.content.some((c: any) => c?.type === 'image' && c.source?.type === 'base64'));
  if (!hasImage) return msg;
  const d = dir ?? toolResultImageDir();
  return {
    ...m,
    message: {
      ...m.message,
      content: content.map((b: any) => (b?.type === 'tool_result' && Array.isArray(b.content)
        ? { ...b, content: b.content.map((c: any) => externalizeBlock(c, d)) }
        : b)),
    },
  };
}
