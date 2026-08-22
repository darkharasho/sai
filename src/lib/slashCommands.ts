/**
 * Renderer-side slash-command types + normalizer.
 *
 * The main process caches these per project (electron/services/slashCommands.ts);
 * this module mirrors the shape and defends the two invariants at the IPC
 * boundary: names are BARE (no leading slash — every consumer adds its own),
 * and providers that still report a plain `string[]` (Codex/Gemini/Kimi, and
 * the SDK's own `system/init` frame) normalize into the same object.
 */

export interface SlashCommandInfo {
  /** Bare name — no leading slash. May be namespaced (`plugin:command`). */
  name: string;
  description: string;
  argumentHint?: string;
  aliases?: string[];
}

export function normalizeSlashCommands(input: unknown): SlashCommandInfo[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SlashCommandInfo[] = [];
  for (const item of input) {
    const raw = typeof item === 'string'
      ? item
      : (item && typeof item === 'object' && typeof (item as any).name === 'string' ? (item as any).name : '');
    const name = raw.trim().replace(/^\/+/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const src = (typeof item === 'object' && item ? item : {}) as Record<string, unknown>;
    const hint = src.argumentHint ?? src.argument_hint;
    out.push({
      name,
      description: typeof src.description === 'string' ? src.description.trim() : '',
      ...(typeof hint === 'string' && hint.trim() ? { argumentHint: hint.trim() } : {}),
    });
  }
  return out;
}
