import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createRenderProtocolStore,
  mintRenderToken,
  resolveRenderAsset,
  RENDER_CSP,
  contentTypeFor,
  prepareRenderTarget,
} from '../../../electron/services/renderProtocol';

let root: string;
let store: ReturnType<typeof createRenderProtocolStore>;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-rp-')));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{}');
  store = createRenderProtocolStore();
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('renderProtocol containment', () => {
  it('serves an in-bounds asset', () => {
    const token = mintRenderToken(store, { root });
    const r = resolveRenderAsset(store, token, 'assets/app.css');
    expect(r.ok).toBe(true);
    expect(r.ok && r.filePath).toBe(path.join(root, 'assets', 'app.css'));
  });

  it('rejects ../ traversal', () => {
    const token = mintRenderToken(store, { root });
    expect(resolveRenderAsset(store, token, '../secret').ok).toBe(false);
  });

  it('rejects absolute paths outside root', () => {
    const token = mintRenderToken(store, { root });
    expect(resolveRenderAsset(store, token, '/etc/passwd').ok).toBe(false);
  });

  it('rejects symlink escape', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-out-'));
    fs.writeFileSync(path.join(outside, 'leak.txt'), 'secret');
    fs.symlinkSync(path.join(outside, 'leak.txt'), path.join(root, 'link.txt'));
    const token = mintRenderToken(store, { root });
    expect(resolveRenderAsset(store, token, 'link.txt').ok).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('rejects an unknown token', () => {
    expect(resolveRenderAsset(store, 'nope', 'index.html').ok).toBe(false);
  });

  it('serves stored inline html for the entry path', () => {
    const token = mintRenderToken(store, { root, inlineHtml: '<p>inline</p>' });
    const r = resolveRenderAsset(store, token, '__sai_inline__');
    expect(r.ok && r.inlineHtml).toBe('<p>inline</p>');
  });

  it('rejects malformed percent-encoding without throwing', () => {
    const token = mintRenderToken(store, { root });
    const r = resolveRenderAsset(store, token, '%E0%A4%A');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(400);
  });

  it('maps sai-render-base/ requests to the token root', () => {
    const token = mintRenderToken(store, { root, inlineHtml: '<p>x</p>' });
    const r = resolveRenderAsset(store, token, 'sai-render-base/assets/app.css');
    expect(r.ok && r.filePath).toBe(path.join(root, 'assets', 'app.css'));
  });
});

describe('prepareRenderTarget', () => {
  it('path to a file → root is its dir, entry is the file name', () => {
    const t = prepareRenderTarget({ cwd: root, path: 'index.html' });
    expect(t.ok && t.root).toBe(root);
    expect(t.ok && t.entry).toBe('index.html');
  });

  it('path to a folder → entry is index.html', () => {
    const t = prepareRenderTarget({ cwd: root, path: '.' });
    expect(t.ok && t.entry).toBe('index.html');
  });

  it('inline html + baseDir → root is baseDir, inline served at INLINE_ENTRY', () => {
    const t = prepareRenderTarget({ cwd: root, html: '<p>x</p>', baseDir: 'assets' });
    expect(t.ok && t.root).toBe(path.join(root, 'assets'));
    expect(t.ok && t.inlineHtml).toContain('<p>x</p>');
    expect(t.ok && t.entry).toBe('__sai_inline__');
  });

  it('path wins over html', () => {
    const t = prepareRenderTarget({ cwd: root, path: 'index.html', html: '<p>ignored</p>' });
    expect(t.ok && t.entry).toBe('index.html');
    expect(t.ok && t.inlineHtml).toBeUndefined();
  });

  it('rejects a path outside cwd', () => {
    expect(prepareRenderTarget({ cwd: root, path: '../escape' }).ok).toBe(false);
  });

  it('accepts an absolute path inside cwd', () => {
    const abs = path.join(root, 'index.html');
    const t = prepareRenderTarget({ cwd: root, path: abs });
    expect(t.ok && t.root).toBe(root);
    expect(t.ok && t.entry).toBe('index.html');
  });

  it('rejects an absolute path outside cwd', () => {
    expect(prepareRenderTarget({ cwd: root, path: '/etc/passwd' }).ok).toBe(false);
  });

  it('accepts an absolute path given through a symlinked cwd', () => {
    // Mirror /home -> /var/home: an alias dir whose realpath is `root`.
    const aliasParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-alias-')));
    const alias = path.join(aliasParent, 'link');
    fs.symlinkSync(root, alias);
    // Caller supplies the aliased absolute path + aliased cwd; both realpath to `root`.
    const t = prepareRenderTarget({ cwd: alias, path: path.join(alias, 'index.html') });
    expect(t.ok && t.root).toBe(root);
    expect(t.ok && t.entry).toBe('index.html');
    fs.rmSync(aliasParent, { recursive: true, force: true });
  });

  it('rejects an in-workspace symlink that points outside cwd', () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-out2-')));
    fs.mkdirSync(path.join(outside, 'secret'));
    fs.writeFileSync(path.join(outside, 'secret', 'index.html'), '<p>leak</p>');
    fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'evil'));
    // path into the symlinked dir must be rejected (escapes the workspace)
    const t = prepareRenderTarget({ cwd: root, path: 'evil/index.html' });
    expect(t.ok).toBe(false);
    // baseDir pointing at the symlinked dir must also be rejected
    const t2 = prepareRenderTarget({ cwd: root, html: '<p>x</p>', baseDir: 'evil' });
    expect(t2.ok).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('accepts an absolute path inside an extra allowedRoot', () => {
    const extra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-extra-')));
    const abs = path.join(extra, 'axp_pick.html');
    fs.writeFileSync(abs, '<p>pick</p>');
    const t = prepareRenderTarget({ cwd: root, path: abs, allowedRoots: [extra] });
    expect(t.ok && t.root).toBe(extra);
    expect(t.ok && t.entry).toBe('axp_pick.html');
    fs.rmSync(extra, { recursive: true, force: true });
  });

  it('still rejects a path outside both cwd and allowedRoots', () => {
    const extra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-extra2-')));
    expect(prepareRenderTarget({ cwd: root, path: '/etc/passwd', allowedRoots: [extra] }).ok).toBe(false);
    fs.rmSync(extra, { recursive: true, force: true });
  });

  it('injects a <base> into inline html so relative assets resolve', () => {
    const t = prepareRenderTarget({ cwd: root, html: '<link href="app.css">', baseDir: 'assets' });
    expect(t.ok && t.inlineHtml).toContain('<base href="sai-render-base/">');
  });
});

describe('renderProtocol helpers', () => {
  it('CSP allows sai-render + https, not file', () => {
    expect(RENDER_CSP).toContain('sai-render:');
    expect(RENDER_CSP).toContain('https:');
    expect(RENDER_CSP).not.toContain('file:');
  });

  it('maps content types', () => {
    expect(contentTypeFor('a.css')).toBe('text/css');
    expect(contentTypeFor('a.js')).toBe('text/javascript');
    expect(contentTypeFor('a.html')).toBe('text/html');
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream');
  });
});
