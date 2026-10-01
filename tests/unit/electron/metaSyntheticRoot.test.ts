import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { metaLinkRoots, syntheticRootFor } from '../../../electron/services/metaSyntheticRoot';
import { prepareRenderTarget } from '../../../electron/services/renderProtocol';

let base: string;
let project: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-meta-base-')));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-meta-proj-')));
  fs.mkdirSync(path.join(project, 'styles'), { recursive: true });
  fs.writeFileSync(path.join(project, 'styles', 'app.css'), 'body{}');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

function makeMeta(id: string): string {
  const root = syntheticRootFor(id, base);
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(project, path.join(root, 'proj'));
  return root;
}

describe('metaLinkRoots', () => {
  it('returns the real targets of a synthetic root\'s project links', () => {
    const root = makeMeta('ws1');
    expect(metaLinkRoots(root, base)).toEqual([project]);
  });

  it('returns nothing for a directory that is not a synthetic root', () => {
    expect(metaLinkRoots(project, base)).toEqual([]);
  });

  it('ignores non-link entries inside the synthetic root', () => {
    const root = makeMeta('ws2');
    fs.mkdirSync(path.join(root, 'notalink'));
    expect(metaLinkRoots(root, base)).toEqual([project]);
  });
});

describe('render containment in a meta workspace', () => {
  it('blocks a linked project path without the link roots', () => {
    const root = makeMeta('ws3');
    const t = prepareRenderTarget({ cwd: root, html: '<p>x</p>', baseDir: 'proj/styles' });
    expect(t.ok).toBe(false);
  });

  it('allows relative and absolute linked-project paths with the link roots', () => {
    const root = makeMeta('ws4');
    const allowedRoots = metaLinkRoots(root, base);
    const rel = prepareRenderTarget({ cwd: root, html: '<p>x</p>', baseDir: 'proj/styles', allowedRoots });
    expect(rel.ok && rel.root).toBe(path.join(project, 'styles'));
    const abs = prepareRenderTarget({
      cwd: root,
      path: path.join(project, 'styles', 'app.css'),
      allowedRoots,
    });
    expect(abs.ok && abs.root).toBe(path.join(project, 'styles'));
  });

  it('still blocks a path outside every linked project', () => {
    const root = makeMeta('ws5');
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-meta-out-')));
    fs.writeFileSync(path.join(outside, 'x.html'), '<p>no</p>');
    const t = prepareRenderTarget({
      cwd: root,
      path: path.join(outside, 'x.html'),
      allowedRoots: metaLinkRoots(root, base),
    });
    expect(t.ok).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
