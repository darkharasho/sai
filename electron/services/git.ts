import simpleGit from 'simple-git';
import { ipcMain } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

/**
 * Build an enriched PATH so git hooks can find tools like git-lfs
 * even when Electron doesn't inherit the user's interactive shell PATH.
 * (GUI apps on macOS don't get /opt/homebrew/bin by default.)
 */
function enrichedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const home = os.homedir();
  const extraPaths: string[] = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try { for (const v of fs.readdirSync(nvmDir)) extraPaths.push(path.join(nvmDir, v, 'bin')); } catch {}
  }
  extraPaths.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  );
  env.PATH = [...extraPaths, env.PATH || ''].join(':');
  return env;
}

function git(cwd: string) {
  return simpleGit({ baseDir: cwd, binary: 'git' }).env(enrichedEnv());
}

function detectAiProvider(author: string, message: string): 'claude' | 'codex' | 'gemini' | undefined {
  const authorLower = author.toLowerCase();
  const messageLower = message.toLowerCase();

  if (authorLower.includes('claude') || messageLower.includes('co-authored-by: claude')) {
    return 'claude';
  }
  if (authorLower.includes('codex') || messageLower.includes('co-authored-by: codex') || messageLower.includes('co-authored-by: openai')) {
    return 'codex';
  }
  if (authorLower.includes('gemini') || messageLower.includes('co-authored-by: gemini')) {
    return 'gemini';
  }

  return undefined;
}

export function registerGitHandlers() {
  ipcMain.handle('git:status', async (_event, cwd: string) => {
    const status = await git(cwd).status();
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
    await git(cwd).add(filepath);
  });

  ipcMain.handle('git:unstage', async (_event, cwd: string, filepath: string) => {
    await git(cwd).reset(['HEAD', '--', filepath]);
  });

  ipcMain.handle('git:commit', async (_event, cwd: string, message: string) => {
    await git(cwd).commit(message);
  });

  ipcMain.handle('git:push', async (_event, cwd: string) => {
    await git(cwd).push();
  });

  ipcMain.handle('git:pull', async (_event, cwd: string) => {
    await git(cwd).pull();
  });

  ipcMain.handle('git:fetch', async (_event, cwd: string) => {
    await git(cwd).fetch();
  });

  ipcMain.handle('git:log', async (_event, cwd: string, count: number) => {
    const log = await git(cwd).log({ maxCount: count });
    return log.all.map(entry => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
      files: [],
      aiProvider: detectAiProvider(entry.author_name, entry.message),
    }));
  });

  ipcMain.handle('git:branches', async (_event, cwd: string) => {
    const summary = await git(cwd).branch([]);
    return {
      current: summary.current,
      branches: Object.keys(summary.branches),
    };
  });

  ipcMain.handle('git:checkout', async (_event, cwd: string, branchName: string) => {
    await git(cwd).checkout(branchName);
  });

  ipcMain.handle('git:createBranch', async (_event, cwd: string, branchName: string) => {
    await git(cwd).checkoutLocalBranch(branchName);
  });

  ipcMain.handle('git:diff', async (_event, cwd: string, filepath: string, staged: boolean) => {
    const args = staged ? ['--cached', '--', filepath] : ['--', filepath];
    return await git(cwd).diff(args);
  });

  ipcMain.handle('git:show', async (_event, cwd: string, filepath: string, ref: string) => {
    try {
      return await git(cwd).show([`${ref}${ref.endsWith(':') ? '' : ':'}${filepath}`]);
    } catch {
      return '';
    }
  });

  ipcMain.handle('git:diffLines', async (_event, cwd: string, filepath: string) => {
    const empty = { added: [] as { startLine: number; endLine: number }[], modified: [] as { startLine: number; endLine: number }[], deleted: [] as number[] };
    try {
      const raw = await git(cwd).diff(['HEAD', '--', filepath]);
      if (!raw || !raw.trim()) return empty;

      const result = { added: [] as { startLine: number; endLine: number }[], modified: [] as { startLine: number; endLine: number }[], deleted: [] as number[] };
      const hunkRe = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g;
      let match;

      while ((match = hunkRe.exec(raw)) !== null) {
        const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;

        if (oldCount === 0 && newCount > 0) {
          result.added.push({ startLine: newStart, endLine: newStart + newCount - 1 });
        } else if (newCount === 0 && oldCount > 0) {
          result.deleted.push(newStart);
        } else if (oldCount > 0 && newCount > 0) {
          result.modified.push({ startLine: newStart, endLine: newStart + newCount - 1 });
        }
      }

      return result;
    } catch {
      return empty;
    }
  });

  ipcMain.handle('git:discard', async (_event, cwd: string, filepath: string) => {
    const g = git(cwd);
    const status = await g.status();
    const isUntracked = status.not_added.includes(filepath);
    if (isUntracked) {
      const { unlink } = await import('fs/promises');
      const { join } = await import('path');
      await unlink(join(cwd, filepath));
    } else {
      await g.checkout(['--', filepath]);
    }
  });

  ipcMain.handle('git:stashList', async (_event, cwd: string) => {
    const g = git(cwd);
    const list = await g.stashList();
    return Promise.all(
      list.all.map(async (entry, index) => {
        let fileCount = 0;
        try {
          const out = await g.raw(['diff-tree', '--no-commit-id', '-r', '--name-only', `stash@{${index}}`]);
          fileCount = out.trim().split('\n').filter(Boolean).length;
        } catch {}
        return {
          index,
          message: entry.message.replace(/^(WIP on|On) [^:]+:\s*/, ''),
          date: entry.date,
          fileCount,
        };
      })
    );
  });

  ipcMain.handle('git:stash', async (_event, cwd: string, message?: string) => {
    const args = message ? ['push', '-m', message] : [];
    await git(cwd).stash(args);
  });

  ipcMain.handle('git:stashPop', async (_event, cwd: string, index: number) => {
    await git(cwd).stash(['pop', `stash@{${index}}`]);
  });

  ipcMain.handle('git:stashApply', async (_event, cwd: string, index: number) => {
    await git(cwd).stash(['apply', `stash@{${index}}`]);
  });

  ipcMain.handle('git:stashDrop', async (_event, cwd: string, index: number) => {
    await git(cwd).stash(['drop', `stash@{${index}}`]);
  });
}
