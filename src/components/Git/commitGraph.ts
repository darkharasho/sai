import { GitCommit } from '../../types';

// Per-row graph layout computed from each commit's parent hashes.
// `before` is the set of open lanes entering the row, `after` the set leaving it.
// `col` is the column where this commit's node sits. Lane arrays hold the hash
// each column is currently "waiting for" (or null for a free column).
export interface GraphRow {
  commit: GitCommit;
  col: number;
  before: (string | null)[];
  after: (string | null)[];
}

const PALETTE = [
  '#3fb950', '#58a6ff', '#bc8cff', '#f778ba',
  '#ffa657', '#39c5cf', '#e3b341', '#ff7b72',
];

// Stable colour per branch line, keyed by the hash a lane is following.
export function laneColor(hash: string | null): string {
  if (!hash) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < hash.length; i++) h = (h * 31 + hash.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function computeGraph(commits: GitCommit[]): { rows: GraphRow[]; maxLanes: number } {
  const rows: GraphRow[] = [];
  let lanes: (string | null)[] = [];
  let maxLanes = 0;

  for (const commit of commits) {
    // Find (or open) this commit's lane.
    let col = lanes.indexOf(commit.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(commit.hash);
      } else {
        lanes[col] = commit.hash;
      }
    }

    const before = lanes.slice();

    // Other lanes also waiting for this commit merge into it — free them.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== col && lanes[i] === commit.hash) lanes[i] = null;
    }

    const parents = commit.parents ?? [];
    if (parents.length === 0) {
      lanes[col] = null;
    } else {
      lanes[col] = parents[0];
      for (let p = 1; p < parents.length; p++) {
        if (lanes.includes(parents[p])) continue;
        let free = lanes.indexOf(null);
        if (free === -1) lanes.push(parents[p]);
        else lanes[free] = parents[p];
      }
    }

    // Trim trailing free lanes so width stays tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const after = lanes.slice();
    maxLanes = Math.max(maxLanes, before.length, after.length);
    rows.push({ commit, col, before, after });
  }

  return { rows, maxLanes };
}
