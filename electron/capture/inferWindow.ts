export interface WindowCandidate { id: string; title: string; klass?: string; }
export interface InferContext {
  target?: string;
  projectNames: string[];
  selfSourceId?: string;
  // Window classes belonging to SAI itself. Class beats title here: SAI's
  // titlebar shows the active workspace name, so a title-only check misses
  // sibling SAI windows (and would wrongly exclude a user app named "SAI").
  selfClasses?: string[];
}
export type InferResult =
  | { kind: 'pick'; window: WindowCandidate }
  | { kind: 'candidates'; titles: string[] }
  | { kind: 'target-miss'; titles: string[] }
  | { kind: 'none' };

function matchAll(windows: WindowCandidate[], needle: string): WindowCandidate[] {
  const n = needle.toLowerCase();
  return windows.filter((w) => w.title.toLowerCase().includes(n));
}

export function inferWindow(windows: WindowCandidate[], ctx: InferContext): InferResult {
  const selfClasses = (ctx.selfClasses ?? []).map((c) => c.toLowerCase());
  // Untitled windows (compositor panels, popups) are never a capture target and
  // must not pad the candidate list or win the single-window shortcut below.
  const pool = windows.filter(
    (w) =>
      w.id !== ctx.selfSourceId &&
      !selfClasses.includes((w.klass ?? '').toLowerCase()) &&
      w.title.trim().length > 0,
  );
  // An explicit target deserves a target-specific error even when nothing at
  // all is capturable, otherwise the caller loses track of what it asked for.
  if (pool.length === 0) {
    return ctx.target && ctx.target.trim() ? { kind: 'target-miss', titles: [] } : { kind: 'none' };
  }

  if (ctx.target && ctx.target.trim()) {
    const hits = matchAll(pool, ctx.target.trim());
    if (hits.length === 1) return { kind: 'pick', window: hits[0] };
    if (hits.length > 1) return { kind: 'candidates', titles: hits.map((h) => h.title) };
    // An explicit target that matches nothing is an error, not a cue to guess —
    // falling through here used to pick unrelated (even untitled) windows.
    return { kind: 'target-miss', titles: pool.map((p) => p.title).filter((t) => t.trim()) };
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
