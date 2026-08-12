import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncDirectory } from '../../../scripts/sync-pwa-assets.mjs';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('mobile PWA asset sync', () => {
  it('replaces stale hashed assets with an exact PWA build snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sai-pwa-sync-'));
    tempRoots.push(root);
    const source = join(root, 'dist', 'renderer-remote');
    const target = join(root, 'sai-mobile', 'assets', 'pwa');
    await mkdir(join(source, 'assets'), { recursive: true });
    await mkdir(join(target, 'assets'), { recursive: true });
    await writeFile(join(source, 'index.html'), '<script src="/assets/new.js"></script>');
    await writeFile(join(source, 'assets', 'new.js'), 'new');
    await writeFile(join(target, 'assets', 'stale.js'), 'stale');

    await syncDirectory(source, target);

    await expect(readFile(join(target, 'index.html'), 'utf8')).resolves.toContain('new.js');
    await expect(readFile(join(target, 'assets', 'new.js'), 'utf8')).resolves.toBe('new');
    await expect(readFile(join(target, 'assets', 'stale.js'), 'utf8')).rejects.toThrow();
  });
});
