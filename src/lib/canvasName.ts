/** Canvas names for the `sai_canvas` tool: `<name>` ↔ `.sai/canvas/<name>.md`. Shared by main and renderer. */

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Validate and normalize a canvas name ("plan", "plan.md" → "plan"). */
export function canvasName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'name (string) is required' };
  const name = raw.trim().replace(/\.md$/i, '');
  if (!NAME_RE.test(name) || name.includes('..')) {
    return { ok: false, error: `invalid canvas name "${raw}": use letters, digits, - _ . (max 80), e.g. "shop-mod-test"` };
  }
  return { ok: true, name };
}

/** Page title as the canvas view shows it: first `# ` heading outside fences/frontmatter, else the name. */
export function canvasTitle(content: string, name: string): string {
  const lines = content.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const f = /^\s*(```|~~~)/.exec(l);
    if (f) { fence = fence === null ? f[1] : (fence === f[1] ? null : fence); continue; }
    if (fence) continue;
    const h = /^#\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) return h[1];
  }
  return name;
}
