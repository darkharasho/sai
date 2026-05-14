import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../../electron/services/scaffold';

describe('scaffoldProject — brainstorm seed', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-scaffold-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes .sai/brainstorm-seed.md when transcript is provided', async () => {
    const target = path.join(tmp, 'p');
    const result = await scaffoldProject({
      path: target,
      context: 'A summary.',
      helpers: { claudeMd: false, gitInit: false, gitignore: true, readme: false, claudeSettings: false, githubRepo: false },
      brainstormTranscript: '**User:** hello\n\n**Assistant:** hi',
    }, () => null);
    expect(result.ok).toBe(true);
    const seedPath = path.join(target, '.sai', 'brainstorm-seed.md');
    expect(fs.existsSync(seedPath)).toBe(true);
    const seed = fs.readFileSync(seedPath, 'utf8');
    expect(seed).toContain('A summary.');
    expect(seed).toContain('<brainstorm-transcript>');
    expect(seed).toContain('**User:** hello');
  });

  it('does NOT write seed file when transcript is absent', async () => {
    const target = path.join(tmp, 'p');
    await scaffoldProject({
      path: target,
      context: 'x',
      helpers: { claudeMd: false, gitInit: false, gitignore: false, readme: false, claudeSettings: false, githubRepo: false },
    }, () => null);
    expect(fs.existsSync(path.join(target, '.sai'))).toBe(false);
  });

  it('adds .sai/ to generated .gitignore when seed is written', async () => {
    const target = path.join(tmp, 'p');
    await scaffoldProject({
      path: target,
      context: 'x',
      helpers: { claudeMd: false, gitInit: false, gitignore: true, readme: false, claudeSettings: false, githubRepo: false },
      brainstormTranscript: 't',
    }, () => null);
    const gi = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    expect(gi.split('\n')).toContain('.sai/');
  });

  it('does not duplicate .sai/ in .gitignore', async () => {
    const target = path.join(tmp, 'p');
    await scaffoldProject({
      path: target,
      context: 'x',
      helpers: { claudeMd: false, gitInit: false, gitignore: true, readme: false, claudeSettings: false, githubRepo: false },
      brainstormTranscript: 't',
    }, () => null);
    const gi = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    const count = gi.split('\n').filter(l => l === '.sai/').length;
    expect(count).toBe(1);
  });
});
