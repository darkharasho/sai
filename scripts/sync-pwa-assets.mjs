import { access, cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function assertSnapshotPaths(source, target) {
  if (source === target
      || basename(source) !== 'renderer-remote'
      || basename(dirname(source)) !== 'dist'
      || basename(target) !== 'pwa'
      || basename(dirname(target)) !== 'assets'
      || basename(dirname(dirname(target))) !== 'sai-mobile') {
    throw new Error(`Refusing to sync unexpected PWA paths: ${source} → ${target}`);
  }
}

/**
 * Move a completed snapshot into place without relying on a platform allowing
 * a directory rename over an existing directory. The current target is first
 * moved to a sibling backup, then restored if the replacement move fails.
 */
export async function safeSwap(temporary, target, operations = {}) {
  const renameDirectory = operations.rename ?? rename;
  const removeDirectory = operations.rm ?? rm;
  const makeTemporaryDirectory = operations.mkdtemp ?? mkdtemp;
  const backupDirectory = await makeTemporaryDirectory(join(dirname(target), '.pwa-backup-'));
  const backup = join(backupDirectory, basename(target));
  let backedUp = false;
  try {
    try {
      await renameDirectory(target, backup);
      backedUp = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await renameDirectory(temporary, target);
    } catch (error) {
      if (backedUp) await renameDirectory(backup, target);
      throw error;
    }
  } finally {
    await removeDirectory(backupDirectory, { recursive: true, force: true });
  }
}

/**
 * Replace the tracked mobile snapshot with the exact PWA build output. The
 * temporary sibling makes the destructive portion both narrow and atomic from
 * the perspective of readers: only the validated `.../assets/pwa` directory
 * is removed, and only after its replacement has been completely copied.
 */
export async function syncDirectory(sourceDirectory, targetDirectory) {
  const source = resolve(sourceDirectory);
  const target = resolve(targetDirectory);
  assertSnapshotPaths(source, target);
  await access(join(source, 'index.html'));
  await access(join(source, 'assets'));

  const targetParent = dirname(target);
  await mkdir(targetParent, { recursive: true });
  const temporary = await mkdtemp(join(targetParent, '.pwa-sync-'));
  try {
    await cp(source, temporary, { recursive: true });
    await safeSwap(temporary, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function pwaSnapshotPaths(root = repositoryRoot) {
  const resolvedRoot = resolve(root);
  return {
    source: join(resolvedRoot, 'dist', 'renderer-remote'),
    target: join(resolvedRoot, 'sai-mobile', 'assets', 'pwa'),
  };
}

export async function syncPwaAssets(root = repositoryRoot) {
  const { source, target } = pwaSnapshotPaths(root);
  await syncDirectory(source, target);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncPwaAssets();
}
