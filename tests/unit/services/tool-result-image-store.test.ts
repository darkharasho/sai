// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectOrphanImages, pruneOrphanImages } from '../../../electron/services/toolResultImageStore';

describe('selectOrphanImages', () => {
  it('keeps referenced files and returns only the unreferenced ones', () => {
    const files = ['aaa.png', 'bbb.jpg', 'ccc.png'];
    const referenced = ['/home/u/.config/sai/tool-result-images/bbb.jpg'];
    expect(selectOrphanImages(files, referenced)).toEqual(['aaa.png', 'ccc.png']);
  });

  it('matches by basename, so a symlinked path spelling still counts as referenced', () => {
    // The stored ref came through /home/... while the dir enumerates /var/home/...
    const files = ['keep.png'];
    const referenced = ['/var/home/u/.config/sai/tool-result-images/keep.png'];
    expect(selectOrphanImages(files, referenced)).toEqual([]);
  });

  it('treats everything as an orphan when nothing is referenced', () => {
    expect(selectOrphanImages(['a.png', 'b.png'], [])).toEqual(['a.png', 'b.png']);
  });
});

describe('pruneOrphanImages', () => {
  const dirs: string[] = [];
  const mkdir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-tri-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('deletes only unreferenced files and reports freed bytes', () => {
    const dir = mkdir();
    fs.writeFileSync(path.join(dir, 'keep.png'), Buffer.alloc(100));
    fs.writeFileSync(path.join(dir, 'drop1.png'), Buffer.alloc(40));
    fs.writeFileSync(path.join(dir, 'drop2.jpg'), Buffer.alloc(60));

    const res = pruneOrphanImages(['/wherever/tool-result-images/keep.png'], dir);

    expect(res.deleted).toBe(2);
    expect(res.freedBytes).toBe(100);
    expect(fs.existsSync(path.join(dir, 'keep.png'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'drop1.png'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'drop2.jpg'))).toBe(false);
  });

  it('is a no-op when the directory does not exist', () => {
    const res = pruneOrphanImages(['x'], path.join(os.tmpdir(), 'sai-does-not-exist-xyz'));
    expect(res).toEqual({ deleted: 0, freedBytes: 0 });
  });

  it('deletes nothing when every file is referenced', () => {
    const dir = mkdir();
    fs.writeFileSync(path.join(dir, 'a.png'), Buffer.alloc(10));
    const res = pruneOrphanImages([path.join(dir, 'a.png')], dir);
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(path.join(dir, 'a.png'))).toBe(true);
  });
});
