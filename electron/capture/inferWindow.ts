export interface WindowCandidate { id: string; title: string; }
export interface InferContext { target?: string; projectNames: string[]; selfSourceId?: string; }
export type InferResult =
  | { kind: 'pick'; window: WindowCandidate }
  | { kind: 'candidates'; titles: string[] }
  | { kind: 'none' };

function matchAll(windows: WindowCandidate[], needle: string): WindowCandidate[] {
  const n = needle.toLowerCase();
  return windows.filter((w) => w.title.toLowerCase().includes(n));
}

export function inferWindow(windows: WindowCandidate[], ctx: InferContext): InferResult {
  const pool = windows.filter((w) => w.id !== ctx.selfSourceId);
  if (pool.length === 0) return { kind: 'none' };

  if (ctx.target && ctx.target.trim()) {
    const hits = matchAll(pool, ctx.target.trim());
    if (hits.length === 1) return { kind: 'pick', window: hits[0] };
    if (hits.length > 1) return { kind: 'candidates', titles: hits.map((h) => h.title) };
  }

  for (const name of ctx.projectNames) {
    if (!name || !name.trim()) continue;
    const hits = matchAll(pool, name.trim());
    if (hits.length === 1) return { kind: 'pick', window: hits[0] };
    if (hits.length > 1) return { kind: 'candidates', titles: hits.map((h) => h.title) };
  }

  if (pool.length === 1) return { kind: 'pick', window: pool[0] };
  return { kind: 'candidates', titles: pool.map((p) => p.title) };
}
