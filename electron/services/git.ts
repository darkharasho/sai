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
  if (process.platform === 'win32') {
    // Windows: PATH is already populated via the installer/registry, and uses
    // ';' as the separator. Prepending Unix-style paths joined with ':' would
    // corrupt it, causing spawn('git') to fail with ENOENT.
    return env;
  }
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
  env.PATH = [...extraPaths, env.PATH || ''].join(path.delimiter);
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

interface ConflictHunkRaw {
  index: number;
  ours: string[];
  theirs: string[];
  oursLabel: string;
  theirsLabel: string;
  startLine: number; // line index in file (0-based) of <<<<<<<
  endLine: number;   // line index of >>>>>>>
}

function parseConflictHunks(content: string): ConflictHunkRaw[] {
  const lines = content.split(/\r?\n/);
  const hunks: ConflictHunkRaw[] = [];
  let i = 0;
  let hunkIndex = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const oursLabel = lines[i].slice('<<<<<<< '.length).trim();
      const startLine = i;
      const ours: string[] = [];
      const theirs: string[] = [];
      i++;
      while (i < lines.length && !/^={7}(\s|$)/.test(lines[i])) {
        ours.push(lines[i]);
        i++;
      }
      if (i >= lines.length) return hunks; // unterminated conflict block, bail
      i++; // skip =======
      let theirsLabel = '';
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirs.push(lines[i]);
        i++;
      }
      if (i >= lines.length) return hunks; // unterminated conflict block, bail
      if (i < lines.length) theirsLabel = lines[i].slice('>>>>>>> '.length).trim();
      const endLine = i;
      hunks.push({ index: hunkIndex++, ours, theirs, oursLabel, theirsLabel, startLine, endLine });
    }
    i++;
  }
  return hunks;
}

function resolveHunks(content: string, resolution: 'ours' | 'theirs' | 'both'): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hunks = parseConflictHunks(content);
  if (hunks.length === 0) return content;
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let i = 0;
  for (const hunk of hunks) {
    while (i < hunk.startLine) result.push(lines[i++]);
    if (resolution === 'ours') result.push(...hunk.ours);
    else if (resolution === 'theirs') result.push(...hunk.theirs);
    else { result.push(...hunk.ours); result.push(...hunk.theirs); }
    i = hunk.endLine + 1;
  }
  while (i < lines.length) result.push(lines[i++]);
  return result.join(eol);
}

export async function gitWorktreeAdd(repoCwd: string, worktreePath: string, branch: string, baseBranch: string) {
  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });
  // create branch off baseBranch and check it out in the new worktree
  await git(repoCwd).raw(['worktree', 'add', '-b', branch, worktreePath, baseBranch]);
}

export async function gitWorktreeRemove(repoCwd: string, worktreePath: string) {
  await git(repoCwd).raw(['worktree', 'remove', '--force', worktreePath]);
}

export async function gitDeleteBranch(repoCwd: string, branch: string) {
  await git(repoCwd).raw(['branch', '-D', branch]).catch(() => {});
}

export async function gitCanFastForward(repoCwd: string, sourceBranch: string, targetBranch: string): Promise<boolean> {
  // target is ancestor of source => FF possible
  return await git(repoCwd).raw(['merge-base', '--is-ancestor', targetBranch, sourceBranch]).then(() => true).catch(() => false);
}

/**
 * Result type for fast-forward merges. Returns ok:false (rather than throwing)
 * for the diverging-branches case so the IPC handler doesn't log it as an
 * error — that's an expected outcome the renderer recovers from by rebasing
 * and retrying. Other git errors still throw.
 */
export type FastForwardResult = { ok: true } | { ok: false; reason: 'diverged'; detail: string };

export async function gitFastForwardMerge(repoCwd: string, sourceBranch: string): Promise<FastForwardResult> {
  try {
    await git(repoCwd).raw(['merge', '--ff-only', sourceBranch]);
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (/diverging branches|Not possible to fast-forward|fast-forward/i.test(msg)) {
      return { ok: false, reason: 'diverged', detail: msg };
    }
    throw err;
  }
}

export async function gitBranchDiff(
  cwd: string,
  baseBranch: string,
  branch: string
): Promise<string> {
  // `git diff baseBranch..branch` returns the full unified diff between
  // baseBranch and branch. Returns empty string on failure.
  return await git(cwd).raw(['diff', `${baseBranch}..${branch}`]).catch(() => '');
}

export async function gitDiffShortstat(
  cwd: string,
  baseBranch: string,
  branch: string
): Promise<{ additions: number; deletions: number; files: number }> {
  // `git diff --shortstat baseBranch..branch` returns e.g. " 3 files changed, 18 insertions(+), 7 deletions(-)"
  const out = await git(cwd).raw(['diff', '--shortstat', `${baseBranch}..${branch}`]).catch(() => '');
  const files = /(\d+)\s+files?\s+changed/.exec(out)?.[1];
  const adds = /(\d+)\s+insertions?\(\+\)/.exec(out)?.[1];
  const dels = /(\d+)\s+deletions?\(-\)/.exec(out)?.[1];
  return {
    files: files ? parseInt(files, 10) : 0,
    additions: adds ? parseInt(adds, 10) : 0,
    deletions: dels ? parseInt(dels, 10) : 0,
  };
}

export interface GitStatusEntry { path: string; status: string; staged: boolean }

export async function gitStatusImpl(cwd: string): Promise<{
  branch: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
}> {
  const s = await git(cwd).status();
  const entries: GitStatusEntry[] = [];
  for (const p of s.staged)    entries.push({ path: p, status: 'modified', staged: true });
  for (const p of s.modified)  entries.push({ path: p, status: 'modified', staged: false });
  for (const p of s.created)   entries.push({ path: p, status: 'added',    staged: true  });
  for (const p of s.deleted)   entries.push({ path: p, status: 'deleted',  staged: false });
  for (const p of s.not_added) entries.push({ path: p, status: 'added',    staged: false });
  return { branch: s.current ?? null, ahead: s.ahead, behind: s.behind, entries };
}

export async function gitDiffImpl(cwd: string, filepath: string, staged: boolean): Promise<string> {
  const args = staged ? ['--cached', '--', filepath] : ['--', filepath];
  return await git(cwd).diff(args);
}

export async function gitStageImpl(cwd: string, filepath: string): Promise<void> {
  await git(cwd).add(filepath);
}
export async function gitUnstageImpl(cwd: string, filepath: string): Promise<void> {
  await git(cwd).reset(['HEAD', '--', filepath]);
}
export async function gitCommitImpl(cwd: string, message: string): Promise<{ hash?: string }> {
  const r = await git(cwd).commit(message);
  return { hash: r.commit ?? undefined };
}
export async function gitPushImpl(cwd: string): Promise<void> {
  await git(cwd).push();
}
export async function gitPullImpl(cwd: string): Promise<void> {
  await git(cwd).pull();
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

  ipcMain.handle('git:log', async (_event, cwd: string, count: number, options?: { ref?: string }) => {
    // Custom format (US-delimited fields, RS-delimited records) so we get parent
    // hashes for graph rendering. Subject (%s) is shown; body (%b) feeds AI detection.
    const args = ['log', `--max-count=${count}`, '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%b%x1e'];
    if (options?.ref) args.push(options.ref);
    let raw: string;
    try {
      raw = await git(cwd).raw(args);
    } catch (err: any) {
      if (err?.message?.includes('does not have any commits')) return [];
      throw err;
    }
    return raw
      .split('\x1e')
      .map(record => record.trim())
      .filter(Boolean)
      .map(record => {
        const [hash, parentStr, author, date, message, body = ''] = record.split('\x1f');
        return {
          hash,
          message,
          author,
          date,
          parents: parentStr ? parentStr.split(' ').filter(Boolean) : [],
          files: [],
          aiProvider: detectAiProvider(author, `${message}\n${body}`),
        };
      });
  });

  ipcMain.handle('git:commitDetails', async (_event, cwd: string, hash: string) => {
    const raw = await git(cwd).raw(['show', '--numstat', '--format=%H%n%an%n%ae%n%aI%n%P%n%B%x00', hash]);
    const [headerPart, restPart = ''] = raw.split('\x00');
    const headerLines = headerPart.split('\n');
    const fullHash = headerLines[0] ?? hash;
    const author = headerLines[1] ?? '';
    const email = headerLines[2] ?? '';
    const date = headerLines[3] ?? '';
    const parents = (headerLines[4] ?? '').split(' ').filter(Boolean);
    const body = headerLines.slice(5).join('\n').trimEnd();

    const files: { path: string; additions: number; deletions: number }[] = [];
    for (const line of restPart.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length < 3) continue;
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      files.push({ path: parts[2], additions, deletions });
    }
    return { hash: fullHash, author, email, date, parents, message: body, files };
  });

  ipcMain.handle('git:branches', async (_event, cwd: string) => {
    const summary = await git(cwd).branch(['-a']);
    const local: string[] = [];
    const remote: string[] = [];
    for (const [name, branch] of Object.entries(summary.branches)) {
      if (branch.linkedWorkTree) continue;
      if (name.startsWith('remotes/')) {
        const remoteName = name.replace(/^remotes\//, '').replace(/^origin\/HEAD.*/, '');
        if (remoteName && !remoteName.includes('HEAD')) remote.push(remoteName);
      } else {
        local.push(name);
      }
    }
    return {
      current: summary.current,
      branches: local,
      remoteBranches: [...new Set(remote)],
    };
  });

  ipcMain.handle('git:checkout', async (_event, cwd: string, branchName: string) => {
    const g = git(cwd);
    // The branch dropdown lists remote branches as "<remote>/<branch>" (e.g. "origin/main").
    // Checking those out directly leaves the repo in detached HEAD. Detect that case and
    // switch to (or create) a local tracking branch instead.
    const slashIdx = branchName.indexOf('/');
    if (slashIdx > 0) {
      const maybeRemote = branchName.slice(0, slashIdx);
      const remotes = await g.getRemotes(false);
      if (remotes.some(r => r.name === maybeRemote)) {
        const localName = branchName.slice(slashIdx + 1);
        const localBranches = await g.branchLocal();
        if (localBranches.all.includes(localName)) {
          await g.checkout(localName);
        } else {
          await g.checkout(['-b', localName, '--track', branchName]);
        }
        return;
      }
    }
    await g.checkout(branchName);
  });

  ipcMain.handle('git:createBranch', async (_event, cwd: string, branchName: string) => {
    await git(cwd).checkoutLocalBranch(branchName);
  });

  ipcMain.handle('git:diff', (_e, cwd: string, filepath: string, staged: boolean) => gitDiffImpl(cwd, filepath, staged));

  ipcMain.handle('git:commitFileDiff', async (_event, cwd: string, hash: string, filepath: string) => {
    try {
      return await git(cwd).raw(['show', '--format=', '--no-color', hash, '--', filepath]);
    } catch {
      return '';
    }
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

  ipcMain.handle('git:rebaseStatus', async (_event, cwd: string) => {
    const mergePath = path.join(cwd, '.git', 'rebase-merge');
    const applyPath = path.join(cwd, '.git', 'rebase-apply');
    const inProgress = fs.existsSync(mergePath) || fs.existsSync(applyPath);
    if (!inProgress) return { inProgress: false, onto: '' };

    let onto = '';
    try {
      // Try rebase-merge/onto first
      const mergeOntoFile = path.join(mergePath, 'onto');
      const applyOntoFile = path.join(applyPath, 'onto');
      const ontoFile = fs.existsSync(mergeOntoFile) ? mergeOntoFile
                     : fs.existsSync(applyOntoFile) ? applyOntoFile
                     : null;
      if (ontoFile) {
        const sha = fs.readFileSync(ontoFile, 'utf8').trim();
        const branches = await git(cwd).branch(['-a', '--format=%(refname:short)', `--points-at=${sha}`]);
        const allBranches = Object.keys(branches.branches);
        const local = allBranches.find(b => !b.startsWith('remotes/') && !b.startsWith('origin/'));
        onto = local ?? allBranches[0] ?? sha.slice(0, 7);
      }
    } catch {}

    return { inProgress: true, onto };
  });

  ipcMain.handle('git:rebase', async (_event, cwd: string, branch: string) => {
    await git(cwd).rebase([branch]);
  });

  ipcMain.handle('git:rebaseAbort', async (_event, cwd: string) => {
    await git(cwd).rebase(['--abort']);
  });

  ipcMain.handle('git:rebaseContinue', async (_event, cwd: string) => {
    await git(cwd).rebase(['--continue']);
  });

  ipcMain.handle('git:rebaseSkip', async (_event, cwd: string) => {
    await git(cwd).rebase(['--skip']);
  });

  ipcMain.handle('git:conflictFiles', async (_event, cwd: string) => {
    const status = await git(cwd).status();
    return status.conflicted;
  });

  ipcMain.handle('git:conflictHunks', async (_event, cwd: string, filepath: string) => {
    try {
      const resolvedCwd = path.resolve(cwd);
      const fullPath = path.resolve(cwd, filepath);
      if (!fullPath.startsWith(resolvedCwd + path.sep)) {
        throw new Error('Path escape attempt blocked');
      }
      const content = await fs.promises.readFile(fullPath, 'utf8');
      return parseConflictHunks(content).map(({ index, ours, theirs, oursLabel, theirsLabel }) => ({
        index, ours, theirs, oursLabel, theirsLabel,
      }));
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('git:resolveConflict', async (
    _event,
    cwd: string,
    filepath: string,
    resolution: 'ours' | 'theirs' | 'both'
  ) => {
    try {
      const resolvedCwd = path.resolve(cwd);
      const fullPath = path.resolve(cwd, filepath);
      if (!fullPath.startsWith(resolvedCwd + path.sep)) {
        throw new Error('Path escape attempt blocked');
      }
      const content = await fs.promises.readFile(fullPath, 'utf8');
      const resolved = resolveHunks(content, resolution);
      await fs.promises.writeFile(fullPath, resolved, 'utf8');
      await git(cwd).add(filepath);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('git:resolveAllConflicts', async (
    _event,
    cwd: string,
    resolution: 'ours' | 'theirs'
  ) => {
    const status = await git(cwd).status();
    const failed: { filepath: string; error: string }[] = [];
    const resolvedCwd = path.resolve(cwd);
    for (const filepath of status.conflicted) {
      try {
        const fullPath = path.resolve(cwd, filepath);
        if (!fullPath.startsWith(resolvedCwd + path.sep)) {
          failed.push({ filepath, error: 'Path escape attempt blocked' });
          continue;
        }
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const resolved = resolveHunks(content, resolution);
        await fs.promises.writeFile(fullPath, resolved, 'utf8');
        await git(cwd).add(filepath);
      } catch (err) {
        failed.push({ filepath, error: (err as Error).message });
      }
    }
    if (failed.length > 0) return { failed };
  });
}
