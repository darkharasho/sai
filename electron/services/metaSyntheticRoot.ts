import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { MetaWorkspace, MetaWorkspaceRuntimeProject } from '../../src/types';

/** Compute the synthetic root path for a meta workspace id. */
export function syntheticRootFor(id: string, baseDir: string = path.join(os.homedir(), '.sai', 'meta')): string {
  return path.join(baseDir, id);
}

/** Resolve a candidate basename against a set of already-taken names by appending -2, -3, ... */
export function resolveLinkName(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  let n = 2;
  while (taken.has(`${candidate}-${n}`)) n++;
  return `${candidate}-${n}`;
}

/** Read existing entries (links only) in the synthetic root; returns basenames. */
function readExistingLinks(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(name => {
    const full = path.join(root, name);
    try { return fs.lstatSync(full).isSymbolicLink(); }
    catch { return false; }
  });
}

/** Materialize a fresh link tree at `root` matching `meta.projects`.
 *  Returns the per-project runtime status (ok|unavailable). */
export function materialize(meta: MetaWorkspace, root: string): MetaWorkspaceRuntimeProject[] {
  fs.mkdirSync(root, { recursive: true });
  const result: MetaWorkspaceRuntimeProject[] = [];
  for (const p of meta.projects) {
    const link = path.join(root, p.linkName);
    if (!fs.existsSync(p.path)) {
      // Don't create a dangling link; mark unavailable.
      if (fs.existsSync(link)) safeUnlinkLink(link);
      result.push({ ...p, status: 'unavailable' });
      continue;
    }
    if (fs.existsSync(link)) {
      // Refuse to overwrite a non-link.
      const stat = fs.lstatSync(link);
      if (!stat.isSymbolicLink()) {
        throw new Error(`Refusing to overwrite non-link at ${link}`);
      }
      // Already linked — leave it.
    } else {
      fs.symlinkSync(p.path, link, 'junction');
    }
    result.push({ ...p, status: 'ok' });
  }
  return result;
}

/** Reconcile the link tree to match the current manifest: prune extras, add missing. */
export function reconcile(meta: MetaWorkspace, root: string): MetaWorkspaceRuntimeProject[] {
  fs.mkdirSync(root, { recursive: true });
  const wantNames = new Set(meta.projects.map(p => p.linkName));
  for (const name of readExistingLinks(root)) {
    if (!wantNames.has(name)) safeUnlinkLink(path.join(root, name));
  }
  return materialize(meta, root);
}

/** Delete the synthetic root. Refuses if any non-link file is present. */
export function deleteSyntheticRoot(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const stat = fs.lstatSync(full);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to delete non-link entry at ${full}`);
    }
    fs.unlinkSync(full);
  }
  fs.rmdirSync(root);
}

function safeUnlinkLink(link: string) {
  const stat = fs.lstatSync(link);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-link at ${link}`);
  }
  fs.unlinkSync(link);
}

/** Real paths of the project links that make up a meta workspace at `cwd`.
 *  A meta synthetic root IS a directory of symlinks pointing at real repos, so
 *  path-containment checks that realpath both ends (render's, notably) see every
 *  file in the workspace as "outside" it. Handing them these roots restores
 *  access to exactly the projects the user linked in — nothing wider.
 *  Returns [] when `cwd` is not a synthetic root under `baseDir`. */
export function metaLinkRoots(
  cwd: string,
  baseDir: string = path.join(os.homedir(), '.sai', 'meta'),
): string[] {
  let realCwd: string;
  let realBase: string;
  try {
    realCwd = fs.realpathSync(cwd);
    realBase = fs.realpathSync(baseDir);
  } catch {
    return [];
  }
  // Only a direct child of the meta base dir is a synthetic root.
  if (path.dirname(realCwd) !== realBase) return [];
  const roots = new Set<string>();
  for (const name of readExistingLinks(realCwd)) {
    try {
      roots.add(fs.realpathSync(path.join(realCwd, name)));
    } catch {
      // Dangling link — grants nothing.
    }
  }
  return [...roots];
}
