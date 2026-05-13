// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  syntheticRootFor, materialize, reconcile, deleteSyntheticRoot,
  resolveLinkName,
} from '../../electron/services/metaSyntheticRoot';
import type { MetaWorkspace } from '../../src/types';

let tmp: string;
let targetA: string;
let targetB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-syn-'));
  targetA = path.join(tmp, 'project-a');
  targetB = path.join(tmp, 'project-b');
  fs.mkdirSync(targetA, { recursive: true });
  fs.mkdirSync(targetB, { recursive: true });
  fs.writeFileSync(path.join(targetA, 'marker-a.txt'), 'a');
  fs.writeFileSync(path.join(targetB, 'marker-b.txt'), 'b');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function meta(id: string, projects: { path: string; linkName: string }[]): MetaWorkspace {
  return { id, name: 't', projects, createdAt: 0, lastActivity: 0 };
}

describe('metaSyntheticRoot', () => {
  it('materializes one link per project', () => {
    const m = meta('m1', [
      { path: targetA, linkName: 'project-a' },
      { path: targetB, linkName: 'project-b' },
    ]);
    const root = syntheticRootFor(m.id, tmp);
    materialize(m, root);
    expect(fs.existsSync(path.join(root, 'project-a', 'marker-a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'project-b', 'marker-b.txt'))).toBe(true);
  });

  it('marks unavailable when target is missing', () => {
    const m = meta('m2', [
      { path: targetA, linkName: 'project-a' },
      { path: path.join(tmp, 'does-not-exist'), linkName: 'gone' },
    ]);
    const root = syntheticRootFor(m.id, tmp);
    const runtime = materialize(m, root);
    expect(runtime.find(p => p.linkName === 'project-a')!.status).toBe('ok');
    expect(runtime.find(p => p.linkName === 'gone')!.status).toBe('unavailable');
    expect(fs.existsSync(path.join(root, 'gone'))).toBe(false);
  });

  it('reconcile removes dangling links and creates missing ones', () => {
    const m = meta('m3', [{ path: targetA, linkName: 'project-a' }]);
    const root = syntheticRootFor(m.id, tmp);
    materialize(m, root);
    // Simulate a dangling link by adding one outside the manifest:
    fs.symlinkSync(targetB, path.join(root, 'stale'), 'junction');
    const updated: MetaWorkspace = { ...m, projects: [
      { path: targetA, linkName: 'project-a' },
      { path: targetB, linkName: 'project-b' },
    ]};
    reconcile(updated, root);
    expect(fs.existsSync(path.join(root, 'stale'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'project-b', 'marker-b.txt'))).toBe(true);
  });

  it('deleteSyntheticRoot removes links only, never targets', () => {
    const m = meta('m4', [{ path: targetA, linkName: 'project-a' }]);
    const root = syntheticRootFor(m.id, tmp);
    materialize(m, root);
    deleteSyntheticRoot(root);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.existsSync(path.join(targetA, 'marker-a.txt'))).toBe(true);
  });

  it('resolveLinkName appends suffix on collision', () => {
    const taken = new Set(['foo', 'foo-2']);
    expect(resolveLinkName('foo', taken)).toBe('foo-3');
    expect(resolveLinkName('bar', taken)).toBe('bar');
  });

  it('refuses to delete a non-link file under the synthetic root', () => {
    const m = meta('m5', []);
    const root = syntheticRootFor(m.id, tmp);
    fs.mkdirSync(root, { recursive: true });
    const realFile = path.join(root, 'oops.txt');
    fs.writeFileSync(realFile, 'do not delete');
    expect(() => deleteSyntheticRoot(root)).toThrow(/non-link/);
    expect(fs.existsSync(realFile)).toBe(true);
  });
});
