import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import {
  gitWorktreeAdd, gitWorktreeRemove, gitCanFastForward,
  gitListWorktrees, gitListBranches, gitWorktreePrune,
} from '../../electron/services/git';

async function tmpRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sai-swarm-'));
  const g = simpleGit({ baseDir: dir });
  await g.init();
  await g.addConfig('user.email', 't@t');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await fs.writeFile(path.join(dir, 'a.txt'), 'a');
  await g.add('.').commit('init', undefined, ['--no-gpg-sign']);
  // Ensure a branch named "main" exists pointing at the initial commit,
  // regardless of the host's init.defaultBranch.
  await g.raw(['branch', '-M', 'main']).catch(() => {});
  return dir;
}

describe('worktree integration', () => {
  it('adds and removes a worktree', async () => {
    const repo = await tmpRepo();
    const wt = path.join(repo, '..', 'wt-x');
    await gitWorktreeAdd(repo, wt, 'swarm/x', 'main');
    expect(await fs.stat(path.join(wt, 'a.txt')).then(() => true)).toBe(true);
    expect(await gitCanFastForward(repo, 'swarm/x', 'main')).toBe(true);
    await gitWorktreeRemove(repo, wt);
  });

  it('gitWorktreeAdd is idempotent for an already-registered worktree', async () => {
    const repo = await tmpRepo();
    const wt = path.join(repo, '..', 'wt-idem');
    await gitWorktreeAdd(repo, wt, 'swarm/idem', 'main');
    // Retry after a half-materialized start must not throw on -b collision.
    await expect(gitWorktreeAdd(repo, wt, 'swarm/idem', 'main')).resolves.toBeUndefined();
    await gitWorktreeRemove(repo, wt);
  });

  it('gitWorktreeAdd re-attaches a surviving branch whose worktree is gone', async () => {
    const repo = await tmpRepo();
    const wt = path.join(repo, '..', 'wt-reattach');
    await gitWorktreeAdd(repo, wt, 'swarm/reattach', 'main');
    // Simulate a crash that lost the worktree but kept the branch.
    await gitWorktreeRemove(repo, wt);
    expect(await gitListBranches(repo, 'swarm/')).toContain('swarm/reattach');
    await gitWorktreeAdd(repo, wt, 'swarm/reattach', 'main');
    expect(await fs.stat(path.join(wt, 'a.txt')).then(() => true)).toBe(true);
    await gitWorktreeRemove(repo, wt);
  });

  it('gitListWorktrees reports paths and branches; prune drops deleted dirs', async () => {
    const repo = await tmpRepo();
    const wt = path.join(repo, '..', 'wt-list');
    await gitWorktreeAdd(repo, wt, 'swarm/list', 'main');

    const entries = await gitListWorktrees(repo);
    const realWt = await fs.realpath(wt).catch(() => wt);
    const found = entries.find(e => e.path === realWt || e.path === wt);
    expect(found?.branch).toBe('swarm/list');

    // Delete the dir out from under git, then prune — the registration goes away.
    await fs.rm(wt, { recursive: true, force: true });
    await gitWorktreePrune(repo);
    const after = await gitListWorktrees(repo);
    expect(after.some(e => e.path === wt)).toBe(false);
    // The branch survives a prune; only the GC plan decides to delete it.
    expect(await gitListBranches(repo, 'swarm/')).toContain('swarm/list');
  });
});
