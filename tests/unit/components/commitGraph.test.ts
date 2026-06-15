import { describe, it, expect } from 'vitest';
import { computeGraph, laneColor } from '../../../src/components/Git/commitGraph';
import { GitCommit } from '../../../src/types';

function commit(hash: string, parents: string[]): GitCommit {
  return { hash, message: hash, author: 'x', date: '2024-01-01', parents, files: [] };
}

describe('computeGraph', () => {
  it('lays out a linear history in a single column', () => {
    const commits = [commit('c', ['b']), commit('b', ['a']), commit('a', [])];
    const { rows, maxLanes } = computeGraph(commits);
    expect(maxLanes).toBe(1);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
  });

  it('opens a second lane across a merge and collapses it after', () => {
    // m merges feature(f) into main; both descend from base(a).
    const commits = [
      commit('m', ['main1', 'f']),
      commit('main1', ['a']),
      commit('f', ['a']),
      commit('a', []),
    ];
    const { rows, maxLanes } = computeGraph(commits);
    expect(maxLanes).toBeGreaterThanOrEqual(2);

    // The merge node has two parents -> two outgoing edges into distinct lanes.
    const merge = rows[0];
    expect(merge.commit.parents).toHaveLength(2);
    expect(new Set(merge.after.filter(Boolean)).size).toBeGreaterThanOrEqual(2);

    // By the base commit the lanes have collapsed back to one.
    const base = rows[3];
    expect(base.col).toBe(0);
    expect(base.after.filter(Boolean)).toHaveLength(0);
  });

  it('places every node at a column within its row lane bounds', () => {
    const commits = [
      commit('m', ['main1', 'f']),
      commit('main1', ['a']),
      commit('f', ['a']),
      commit('a', []),
    ];
    const { rows } = computeGraph(commits);
    for (const r of rows) {
      expect(r.before[r.col]).toBe(r.commit.hash);
      expect(r.col).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives a stable colour for the same hash', () => {
    expect(laneColor('abc123')).toBe(laneColor('abc123'));
    expect(laneColor(null)).toMatch(/^#/);
  });
});
