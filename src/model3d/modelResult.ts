// Parses the render_model tool's recorded output (tc.output). The output may be
// the bare JSON result, an MCP-wrapped string, or truncated, so fall back to a
// regex for the version key.
const KEY_RE = /"versionKey"\s*:\s*"([0-9a-f]{32})"/;
const PATH_RE = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/;

export function extractModelResult(output: string | undefined): { versionKey: string; path: string } | null {
  if (!output) return null;
  try {
    const v = JSON.parse(output);
    const m = v?.model;
    if (m && typeof m.versionKey === 'string' && /^[0-9a-f]{32}$/.test(m.versionKey)) {
      return { versionKey: m.versionKey, path: typeof m.path === 'string' ? m.path : '' };
    }
  } catch { /* fall through to regex */ }
  const k = KEY_RE.exec(output);
  if (!k) return null;
  let path = '';
  const p = PATH_RE.exec(output);
  if (p) {
    try { path = JSON.parse(`"${p[1]}"`); } catch { path = p[1]; }
  }
  return { versionKey: k[1], path };
}

/** Error text from a failed render_model output ({ok:false,error}), else null. */
export function extractModelError(output: string | undefined): string | null {
  if (!output) return null;
  try {
    const v = JSON.parse(output);
    if (v && v.ok === false) return typeof v.error === 'string' && v.error ? v.error : 'Model render failed';
  } catch { /* fall through */ }
  if (/"ok"\s*:\s*false/.test(output)) {
    const m = /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(output);
    if (m) { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } }
    return 'Model render failed';
  }
  return null;
}
