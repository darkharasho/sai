// Patterns for finding GC-relevant references in raw chat-log text (JSONL lines
// and snapshot JSON). The log holds JSON-encoded events, so a value nested in a
// tool output string shows up with escaped quotes; the patterns tolerate that.
// Over-matching only keeps extra files alive, so they lean loose.

/** Extensions storeImageBase64 writes (EXT_BY_MIME values plus the 'bin' fallback). */
export const TOOL_IMAGE_EXTS = ['png', 'jpg', 'gif', 'webp', 'svg', 'bmp', 'bin'] as const;

/** Basename of a content-addressed tool-result image: `<32 hex>.<ext>`.
 *  The image GC matches by basename too (selectOrphanImages). */
export const TOOL_IMAGE_REF_RE = new RegExp(`[0-9a-f]{32}\\.(?:${TOOL_IMAGE_EXTS.join('|')})(?![A-Za-z0-9])`);

/** A render_model `versionKey` (same shape as modelResult's KEY_RE), with or without JSON escaping. */
export const MODEL_KEY_REF_RE = /versionKey\\*"\s*:\s*\\*"[0-9a-f]{32}/;

/** The 32-hex version key at the end of a MODEL_KEY_REF_RE match. */
export function modelKeyFromRef(match: string): string {
  return match.slice(-32);
}
