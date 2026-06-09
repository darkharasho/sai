export interface ParsedRenderHost {
  components: string[];
  props: Record<string, unknown>;
  vars: Record<string, string>;
  width?: number;
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Parse the offscreen render-host query into mount params. Tolerant of junk. */
export function parseRenderHostParams(search: string): ParsedRenderHost {
  const sp = new URLSearchParams(search);
  const single = sp.get('component');
  const components = single
    ? [single]
    : safeJson<string[]>(sp.get('components'), []).filter((c) => typeof c === 'string');
  const props = safeJson<Record<string, unknown>>(sp.get('props'), {});
  const vars = safeJson<Record<string, string>>(sp.get('vars'), {});
  const w = Number(sp.get('width'));
  return { components, props, vars, width: Number.isFinite(w) && w > 0 ? w : undefined };
}
