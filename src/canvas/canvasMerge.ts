import { splitBlocks, joinBlocks, type CanvasBlock } from './canvasBlocks';

export interface MergeConflict {
  index: number;
  ours: string;
  theirs: string;
}

type Side = 'ours' | 'theirs';

/** How one side treated a base block. */
export type State =
  | { kind: 'kept'; block: CanvasBlock }
  | { kind: 'deleted' }
  | { kind: 'replaced'; block: CanvasBlock };

export interface SideDiff {
  states: State[];
  /** inserted[i + 1] = blocks inserted after base block i (slot 0 = before the first). */
  inserted: CanvasBlock[][];
}

/** Longest common subsequence on block hashes; returns matched [baseIdx, otherIdx] pairs. */
function lcsPairs(a: CanvasBlock[], b: CanvasBlock[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].hash === b[j].hash ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].hash === b[j].hash) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const PAIR_THRESHOLD = 0.3;

function tokens(source: string): Set<string> {
  return new Set(source.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? []);
}

function similarity(a: CanvasBlock, b: CanvasBlock): number {
  const ta = tokens(a.source);
  const tb = tokens(b.source);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Order-preserving pairing of unmatched base blocks with unmatched side blocks that maximises
 * total similarity. A lone 1:1 gap always pairs (a plain in-place replacement). Returns
 * [baseIdx, sideIdx] positions within the given arrays.
 */
function pairBySimilarity(a: CanvasBlock[], b: CanvasBlock[]): Array<[number, number]> {
  if (a.length === 0 || b.length === 0) return [];
  if (a.length === 1 && b.length === 1) return [[0, 0]];
  const sim = a.map((x) => b.map((y) => similarity(x, y)));
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let best = Math.max(dp[i + 1][j], dp[i][j + 1]);
      if (sim[i][j] >= PAIR_THRESHOLD) best = Math.max(best, dp[i + 1][j + 1] + 1 + sim[i][j]);
      dp[i][j] = best;
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sim[i][j] >= PAIR_THRESHOLD && dp[i][j] === dp[i + 1][j + 1] + 1 + sim[i][j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i][j] === dp[i + 1][j]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Describe `other` relative to `base`. In each gap between matched blocks, unmatched base
 * blocks pair up in order with unmatched other blocks (a replacement); leftovers are
 * deletions (base side) or insertions (other side).
 */
export function diffAgainstBase(base: CanvasBlock[], other: CanvasBlock[]): SideDiff {
  const states: State[] = new Array(base.length);
  const inserted: CanvasBlock[][] = Array.from({ length: base.length + 1 }, () => []);
  const pairs = lcsPairs(base, other);
  for (const [bi, oi] of pairs) states[bi] = { kind: 'kept', block: other[oi] };

  let pb = -1;
  let po = -1;
  const gap = (nb: number, no: number) => {
    const baseIdx: number[] = [];
    for (let k = pb + 1; k < nb; k++) baseIdx.push(k);
    const otherIdx: number[] = [];
    for (let k = po + 1; k < no; k++) otherIdx.push(k);
    const matched = pairBySimilarity(
      baseIdx.map((k) => base[k]),
      otherIdx.map((k) => other[k]),
    );
    const pairedBase = new Set<number>();
    const insertAfter = new Map<number, number>(); // other idx -> slot
    let slotBase = pb; // last paired base index so far
    let mi = 0;
    for (let k = 0; k < otherIdx.length; k++) {
      if (mi < matched.length && matched[mi][1] === k) {
        const bk = baseIdx[matched[mi][0]];
        states[bk] = { kind: 'replaced', block: other[otherIdx[k]] };
        pairedBase.add(bk);
        slotBase = bk;
        mi++;
      } else insertAfter.set(k, slotBase + 1);
    }
    for (const bk of baseIdx) if (!pairedBase.has(bk)) states[bk] = { kind: 'deleted' };
    for (const [k, slot] of insertAfter) inserted[slot].push(other[otherIdx[k]]);
  };
  for (const [bi, oi] of pairs) {
    gap(bi, oi);
    pb = bi;
    po = oi;
  }
  gap(base.length, other.length);
  return { states, inserted };
}

interface Out {
  block: CanvasBlock;
  side: Side;
}

function sameText(a: CanvasBlock, b: CanvasBlock): boolean {
  return a.hash === b.hash;
}

export function mergeBlocks(
  base: string,
  ours: string,
  theirs: string,
): { merged: string; conflicts: MergeConflict[]; changed: boolean } {
  const baseBlocks = splitBlocks(base);
  const ourBlocks = splitBlocks(ours);
  const theirBlocks = splitBlocks(theirs);
  const o = diffAgainstBase(baseBlocks, ourBlocks);
  const t = diffAgainstBase(baseBlocks, theirBlocks);

  const out: Out[] = [];
  const conflicts: MergeConflict[] = [];

  const insertSlot = (slot: number) => {
    const tIns = t.inserted[slot];
    const oIns = o.inserted[slot];
    for (const b of tIns) out.push({ block: b, side: 'theirs' });
    // Skip our inserts that the agent already inserted verbatim (same sequence of text).
    const dup = tIns.length === oIns.length && tIns.every((b, i) => sameText(b, oIns[i]));
    if (!dup) for (const b of oIns) out.push({ block: b, side: 'ours' });
  };

  insertSlot(0);
  for (let i = 0; i < baseBlocks.length; i++) {
    const os = o.states[i];
    const ts = t.states[i];
    if (os.kind === 'kept' && ts.kind === 'kept') out.push({ block: ts.block, side: 'theirs' });
    else if (os.kind === 'kept') {
      if (ts.kind === 'replaced') out.push({ block: ts.block, side: 'theirs' });
    } else if (ts.kind === 'kept') {
      if (os.kind === 'replaced') out.push({ block: os.block, side: 'ours' });
    } else if (os.kind === 'replaced' && ts.kind === 'replaced') {
      if (sameText(os.block, ts.block)) out.push({ block: ts.block, side: 'theirs' });
      else {
        conflicts.push({ index: out.length, ours: os.block.source.trim(), theirs: ts.block.source.trim() });
        out.push({ block: os.block, side: 'ours' });
      }
    } else if (os.kind === 'replaced') out.push({ block: os.block, side: 'ours' });
    else if (ts.kind === 'replaced') out.push({ block: ts.block, side: 'theirs' });
    // both deleted: nothing
    insertSlot(i + 1);
  }

  // Blocks that were not adjacent in their own document must stay separated by a blank line.
  const sources = out.map((cur, i) => {
    const next = out[i + 1];
    if (!next) return { source: cur.block.source };
    if (next.side === cur.side && next.block.index === cur.block.index + 1) return { source: cur.block.source };
    const trailing = /\n*$/.exec(cur.block.source)![0].length;
    return { source: trailing >= 2 ? cur.block.source : cur.block.source + '\n'.repeat(2 - trailing) };
  });

  const merged = joinBlocks(sources);
  return { merged, conflicts, changed: merged !== theirs };
}
