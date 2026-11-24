import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeBlocks } from '../../canvas/canvasMerge';
import type { CanvasStore } from '../../canvas/canvasStore';

export const WRITE_DEBOUNCE_MS = 400;

interface Pending {
  path: string;
  /** Store content the first pending edit was applied to. */
  base: string;
  /** Base plus every pending edit. */
  doc: string;
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
    const content = current === undefined ? p.doc : mergeBlocks(p.base, p.doc, current).merged;
    if (content === current) return;
    store.userWrite(p.path, content).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [store]);

  /** Latest doc: the pending one if any, else store content. */
  const latest = useCallback(
    (): string | undefined => pendingRef.current?.doc ?? store.get(path)?.content,
    [store, path],
  );

  const apply = useCallback(
    (op: (md: string) => string) => {
      const cur = latest();
      if (cur === undefined) return;
      const next = op(cur);
      if (next === cur) return;
      pendingRef.current = { path, base: pendingRef.current?.base ?? cur, doc: next };
      setVersion((v) => v + 1);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
    [latest, path, flush],
  );

  // Flush on unmount and when the path changes.
  useEffect(() => () => flush(), [path, flush]);

  return { pendingDoc: pendingRef.current?.doc ?? null, apply, latest, error };
}
