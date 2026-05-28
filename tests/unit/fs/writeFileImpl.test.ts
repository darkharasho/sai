import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileImpl, writeFileImpl } from '@electron/services/fs';

describe('writeFileImpl', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-wfi-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('writes a new file and returns mtime+sha matching readFileImpl', async () => {
    const r = await writeFileImpl(tmp, 'a.txt', 'hello\n', { expectMtime: null, expectSha: null });
    expect(r.sha).toMatch(/^[0-9a-f]{16}$/);
    const rr = await readFileImpl(path.join(tmp, 'a.txt'));
    expect(rr.content).toBe('hello\n');
    expect(rr.sha).toBe(r.sha);
    expect(Math.abs(rr.mtime - r.mtime)).toBeLessThanOrEqual(2);
  });

  it('overwrites existing file when expects match (round-trip read → write)', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const r = await readFileImpl(path.join(tmp, 'a.txt'));
    const w = await writeFileImpl(tmp, 'a.txt', 'two\n', { expectMtime: r.mtime, expectSha: r.sha });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('two\n');
    expect(w.sha).not.toBe(r.sha);
  });

  it('rejects with code=stale when current sha differs from expectSha', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const r = await readFileImpl(path.join(tmp, 'a.txt'));
    // Mutate the file behind our back.
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'three\n');
    await expect(
      writeFileImpl(tmp, 'a.txt', 'two\n', { expectMtime: r.mtime, expectSha: r.sha }),
    ).rejects.toMatchObject({ code: 'stale', currentSha: expect.stringMatching(/^[0-9a-f]{16}$/) });
    // Original file untouched.
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('three\n');
  });

  it('rejects with code=stale when mtime jumped past +1ms slack', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const r = await readFileImpl(path.join(tmp, 'a.txt'));
    // Force mtime far into the future via utimes; content (and therefore sha) stays.
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(tmp, 'a.txt'), future, future);
    await expect(
      writeFileImpl(tmp, 'a.txt', 'two\n', { expectMtime: r.mtime, expectSha: r.sha }),
    ).rejects.toMatchObject({ code: 'stale' });
  });

  it('force-writes when both expects are null (bypasses stale check)', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const w = await writeFileImpl(tmp, 'a.txt', 'forced\n', { expectMtime: null, expectSha: null });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('forced\n');
    expect(w.sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects content > 256KB with code=too_large', async () => {
    const huge = 'x'.repeat(256 * 1024 + 1);
    await expect(
      writeFileImpl(tmp, 'a.txt', huge, { expectMtime: null, expectSha: null }),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(fs.existsSync(path.join(tmp, 'a.txt'))).toBe(false);
  });

  it('rejects path traversal via safeJoin', async () => {
    await expect(
      writeFileImpl(tmp, '../escape.txt', 'no', { expectMtime: null, expectSha: null }),
    ).rejects.toThrow(/escapes|absolute/i);
  });

  it('treats missing target with enforced expects as stale (desktop deleted it)', async () => {
    await expect(
      writeFileImpl(tmp, 'gone.txt', 'data', { expectMtime: 1, expectSha: 'aaaaaaaaaaaaaaaa' }),
    ).rejects.toMatchObject({ code: 'stale' });
  });

  it('uses tmp + rename (no partial file visible on failed rename)', async () => {
    // We can't simulate rename failure portably, so just sanity-check no .tmp files
    // are left behind on the happy path.
    await writeFileImpl(tmp, 'a.txt', 'ok\n', { expectMtime: null, expectSha: null });
    const leftovers = fs.readdirSync(tmp).filter((n) => n.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });
});
