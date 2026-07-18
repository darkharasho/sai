import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../../electron/services/scaffold';
import { createEmptyBrief } from '../../electron/services/brainstorm/brief';

describe('scaffoldProject — brainstorm seed', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-scaffold-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes .sai/brainstorm-seed.md when transcript is provided (legacy plain-context path)', async () => {
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
    // Legacy path (no brief): seed = context only
    expect(seed.trim()).toBe('A summary.');
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

  it('writes a full-brief seed and brief-derived CLAUDE.md when brief is provided', async () => {
    const brief = {
      ...createEmptyBrief(),
      projectName: 'seed-proj',
      summary: 'A test project.',
      goals: ['Do a thing'],
      openQuestions: ['Which thing?'],
      ready: true,
    };
    const target = path.join(tmp, 'seed-proj');
    const r = await scaffoldProject({
      path: target,
      context: 'A test project.',
      helpers: { claudeMd: true, gitInit: false, gitignore: true, readme: true, claudeSettings: false, githubRepo: false },
      brief,
      brainstormTranscript: '**User:** hi',
    }, () => null);
    expect(r.ok).toBe(true);
    const seed = fs.readFileSync(path.join(target, '.sai', 'brainstorm-seed.md'), 'utf8');
    expect(seed).toMatch(/propose an implementation plan/i);
    expect(seed).toContain('# Project brief: seed-proj');
    expect(seed).toContain('Which thing?');
    expect(seed).toContain('**User:** hi');
    const claudeMd = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('## Project Context');
    expect(claudeMd).toContain('## Goals');
    expect(claudeMd).not.toContain('## Open questions');
  });

  it('keeps the legacy plain-context path when no brief is provided', async () => {
    const target = path.join(tmp, 'plain-proj');
    await scaffoldProject({
      path: target,
      context: 'Plain context.',
      helpers: { claudeMd: true, gitInit: false, gitignore: false, readme: false, claudeSettings: false, githubRepo: false },
    }, () => null);
    const claudeMd = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toBe('## Project Context\n\nPlain context.\n');
    expect(fs.existsSync(path.join(target, '.sai'))).toBe(false);
  });
});
