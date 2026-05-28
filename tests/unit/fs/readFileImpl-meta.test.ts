import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileImpl } from '@electron/services/fs';

describe('readFileImpl meta', () => {
  let tmp: string;
  let target: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-rfi-meta-'));
    target = path.join(tmp, 'a.txt');
    fs.writeFileSync(target, 'hello\n', 'utf-8');
  });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns content + mtime + sha', async () => {
    const r = await readFileImpl(target);
    expect(typeof r).toBe('object');
    const obj = r as unknown as { content: string; mtime: number; sha: string };
    expect(obj.content).toBe('hello\n');
    expect(obj.mtime).toBeGreaterThan(0);
    expect(obj.sha).toMatch(/^[0-9a-f]{16}$/);
  });
});
