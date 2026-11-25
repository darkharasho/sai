import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCanvasFileTool, canvasTitle } from '../../../electron/services/canvasTool';

describe('runCanvasFileTool', () => {
  let proj: string;
  let real: string;
  const dir = () => path.join(real, '.sai', 'canvas');

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'canvastool-'));
    real = fs.realpathSync(proj);
  });
  afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

  it('write creates .sai/canvas/<name>.md (and the folders), reporting created', () => {
    const r = runCanvasFileTool({ action: 'write', name: 'shop-mod-test', content: '# Shop mod\n\n- [ ] Buy a thing\n' }, proj);
    expect(r).toEqual({ ok: true, name: 'shop-mod-test', path: path.join(dir(), 'shop-mod-test.md'), created: true });
    expect(fs.readFileSync(path.join(dir(), 'shop-mod-test.md'), 'utf8')).toBe('# Shop mod\n\n- [ ] Buy a thing\n');
  });

  it('write replaces an existing canvas, reporting created false, and leaves no temp file', () => {
    runCanvasFileTool({ action: 'write', name: 'plan', content: 'a\n' }, proj);
    const r = runCanvasFileTool({ action: 'write', name: 'plan.md', content: 'b\n' }, proj);
    expect(r).toMatchObject({ ok: true, name: 'plan', created: false });
    expect(fs.readFileSync(path.join(dir(), 'plan.md'), 'utf8')).toBe('b\n');
    expect(fs.readdirSync(dir())).toEqual(['plan.md']);
  });

  it('read returns the current content, including the user\'s edits', () => {
    runCanvasFileTool({ action: 'write', name: 'plan', content: '- [ ] one\n' }, proj);
    fs.writeFileSync(path.join(dir(), 'plan.md'), '- [x] one\n> note from user\n');
    expect(runCanvasFileTool({ action: 'read', name: 'plan' }, proj)).toEqual({
      ok: true, name: 'plan', path: path.join(dir(), 'plan.md'), content: '- [x] one\n> note from user\n',
    });
  });

  it('read of a missing canvas is an error naming the existing ones', () => {
    runCanvasFileTool({ action: 'write', name: 'alpha', content: 'x' }, proj);
    expect(runCanvasFileTool({ action: 'read', name: 'beta' }, proj)).toEqual({
      ok: false, error: 'no canvas named "beta" (existing: alpha)',
    });
  });

  it('list returns names, titles and paths, sorted; empty when the folder is missing', () => {
    expect(runCanvasFileTool({ action: 'list' }, proj)).toEqual({ ok: true, canvases: [] });
    runCanvasFileTool({ action: 'write', name: 'zeta', content: '---\nx: 1\n---\n# Zeta plan\n' }, proj);
    runCanvasFileTool({ action: 'write', name: 'alpha', content: 'no heading' }, proj);
    expect(runCanvasFileTool({ action: 'list' }, proj)).toEqual({
      ok: true,
      canvases: [
        { name: 'alpha', title: 'alpha', path: path.join(dir(), 'alpha.md') },
        { name: 'zeta', title: 'Zeta plan', path: path.join(dir(), 'zeta.md') },
      ],
    });
  });

  it.each(['../escape', 'a/b', '', '.hidden', 'x'.repeat(81), 'sp ace'])('rejects the name %j', (name) => {
    const r = runCanvasFileTool({ action: 'write', name, content: 'x' }, proj);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(real, 'escape.md'))).toBe(false);
  });

  it('write needs string content', () => {
    expect(runCanvasFileTool({ action: 'write', name: 'a' }, proj)).toEqual({ ok: false, error: 'content (string) is required for write' });
  });

  it('refuses to write through a symlinked canvas file', () => {
    fs.mkdirSync(dir(), { recursive: true });
    const outside = path.join(real, 'outside.txt');
    fs.writeFileSync(outside, 'keep');
    fs.symlinkSync(outside, path.join(dir(), 'link.md'));
    const r = runCanvasFileTool({ action: 'write', name: 'link', content: 'pwned' }, proj);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
  });

  it('refuses when .sai/canvas resolves outside the project', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'canvastool-out-'));
    try {
      fs.mkdirSync(path.join(real, '.sai'));
      fs.symlinkSync(elsewhere, path.join(real, '.sai', 'canvas'));
      const r = runCanvasFileTool({ action: 'write', name: 'a', content: 'x' }, proj);
      expect(r.ok).toBe(false);
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
  });

  it('needs an absolute workspace and a known action', () => {
    expect(runCanvasFileTool({ action: 'list' }, '')).toMatchObject({ ok: false });
    expect(runCanvasFileTool({ action: 'nope' }, proj)).toEqual({ ok: false, error: 'action must be one of list, read, write, open' });
  });
});

describe('canvasTitle', () => {
  it('uses the first # heading after optional frontmatter, else the name', () => {
    expect(canvasTitle('# Hello\n', 'n')).toBe('Hello');
    expect(canvasTitle('intro\n## Sub\n# Main\n', 'n')).toBe('Main');
    expect(canvasTitle('---\ntitle: x\n---\nbody', 'n')).toBe('n');
  });
});
