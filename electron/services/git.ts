import simpleGit from 'simple-git';
import { ipcMain } from 'electron';

export function registerGitHandlers() {
  ipcMain.handle('git:status', async (_event, cwd: string) => {
    const git = simpleGit(cwd);
    const status = await git.status();
    return {
      branch: status.current,
      staged: status.staged.map(f => ({ path: f, status: 'staged' })),
      modified: status.modified.map(f => ({ path: f, status: 'modified' })),
      created: status.created.map(f => ({ path: f, status: 'added' })),
      deleted: status.deleted.map(f => ({ path: f, status: 'deleted' })),
      not_added: status.not_added.map(f => ({ path: f, status: 'added' })),
      ahead: status.ahead,
      behind: status.behind,
    };
  });

  ipcMain.handle('git:stage', async (_event, cwd: string, filepath: string) => {
    await simpleGit(cwd).add(filepath);
  });

  ipcMain.handle('git:unstage', async (_event, cwd: string, filepath: string) => {
    await simpleGit(cwd).reset(['HEAD', '--', filepath]);
  });

  ipcMain.handle('git:commit', async (_event, cwd: string, message: string) => {
    await simpleGit(cwd).commit(message);
  });

  ipcMain.handle('git:push', async (_event, cwd: string) => {
    await simpleGit(cwd).push();
  });

  ipcMain.handle('git:pull', async (_event, cwd: string) => {
    await simpleGit(cwd).pull();
  });

  ipcMain.handle('git:log', async (_event, cwd: string, count: number) => {
    const log = await simpleGit(cwd).log({ maxCount: count });
    return log.all.map(entry => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
      files: [],
      isClaude: entry.author_name.includes('Claude') || entry.message.includes('Co-Authored-By: Claude'),
    }));
  });

  ipcMain.handle('git:branches', async (_event, cwd: string) => {
    const git = simpleGit(cwd);
    const summary = await git.branch([]);
    return {
      current: summary.current,
      branches: Object.keys(summary.branches),
    };
  });

  ipcMain.handle('git:checkout', async (_event, cwd: string, branchName: string) => {
    await simpleGit(cwd).checkout(branchName);
  });

  ipcMain.handle('git:createBranch', async (_event, cwd: string, branchName: string) => {
    await simpleGit(cwd).checkoutLocalBranch(branchName);
  });

  ipcMain.handle('git:diff', async (_event, cwd: string, filepath: string, staged: boolean) => {
    const git = simpleGit(cwd);
    const args = staged ? ['--cached', '--', filepath] : ['--', filepath];
    return await git.diff(args);
  });
}
