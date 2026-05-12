import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { gitWorktreeAdd, gitWorktreeRemove, gitCanFastForward } from '../../electron/services/git';

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
});
