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
