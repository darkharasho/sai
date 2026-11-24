import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeBlocks, type MergeConflict } from '../../canvas/canvasMerge';
import type { CanvasStore } from '../../canvas/canvasStore';

export const WRITE_DEBOUNCE_MS = 400;

interface Pending {
  path: string;
  /** Store content the first pending edit was applied to. */
  base: string;
  /** Base plus every pending edit. */
  doc: string;
  /** Conflicts found by merges already folded into `doc`. */
  conflicts: MergeConflict[];
}

/**
 * Debounced user writes. Edits chain on the pending doc (keeping the first base);
 * on flush the doc is three-way merged with whatever the store holds now, so
 * concurrent agent changes survive.
 */
export function usePendingWrites(path: string, store: CanvasStore) {
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setVersion((v) => v + 1);
    const current = store.get(p.path)?.content;
    const r = current === undefined ? null : mergeBlocks(p.base, p.doc, current);
    const content = r ? r.merged : p.doc;
    const seen = new Set<number>();
    const conflicts = [...p.conflicts, ...(r?.conflicts ?? [])].filter((c) => !seen.has(c.index) && !!seen.add(c.index));
    if (content === current && conflicts.length === 0) return;
    store.userWrite(p.path, content, conflicts).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [store]);

  /** Latest doc: the pending one if any, else store content. */
  const latest = useCallback(
    (): string | undefined =>
      (pendingRef.current?.path === path ? pendingRef.current.doc : undefined) ?? store.get(path)?.content,
    [store, path],
  );

  const apply = useCallback(
    (op: (md: string) => string | { doc: string; conflicts: MergeConflict[] }) => {
      const cur = latest();
      if (cur === undefined) return;
      const r = op(cur);
      const next = typeof r === 'string' ? r : r.doc;
      const found = typeof r === 'string' ? [] : r.conflicts;
      if (next === cur && found.length === 0) return;
      const prev = pendingRef.current?.path === path ? pendingRef.current : null;
      pendingRef.current = { path, base: prev?.base ?? cur, doc: next, conflicts: [...(prev?.conflicts ?? []), ...found] };
      setVersion((v) => v + 1);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
    [latest, path, flush],
  );

  // Flush on unmount and when the path changes.
  useEffect(() => () => flush(), [path, flush]);

  return { pendingDoc: pendingRef.current?.path === path ? pendingRef.current.doc : null, apply, latest, error };
}
