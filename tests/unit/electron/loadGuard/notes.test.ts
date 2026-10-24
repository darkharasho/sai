// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warningNote, normalNote, killNote, NoteBox } from '../../../../electron/services/loadGuard/notes';
import type { AiUnit, SystemSample } from '../../../../electron/services/loadGuard/types';
import type { Classified } from '../../../../electron/services/loadGuard/classify';

const GB = 1024 * 1024;
const sample = (over: Partial<SystemSample> = {}): SystemSample => ({
  ts: 0, memTotalKb: 32 * GB, memAvailableKb: 1.6 * GB, swapTotalKb: 8 * GB, swapFreeKb: 5.5 * GB,
  psiMemSome10: 12.4, psiMemFull10: 3, psiCpuSome10: 40.6, gpu: null, ...over,
});
const cls = (over: Partial<Classified> = {}): Classified => ({
  units: [], saiAiKb: 3.25 * GB, saiAppKb: GB, top: [], game: null, ...over,
});

describe('warningNote', () => {
  it('formats base, swap rising, and SAI footer', () => {
    const t = warningNote(sample(), cls(), true);
    expect(t).toBe(
      "[SAI system load: WARNING] RAM 95% used (1.6 GB free of 32.0 GB), swap 2.5 GB used and rising, memory pressure 12%, CPU pressure 41%." +
      " SAI's own processes: 3.3 GB. Prefer lighter work for now (fewer parallel workers, avoid full builds or whole test suites, or wait), and tell the user if you're holding back.");
  });
  it('lists game first then non-SAI top users, max 3, no SAI owners', () => {
    const t = warningNote(sample({ gpu: { utilPct: 80, vramUsedMb: 6144, vramTotalMb: 12288 } }), cls({
      game: { name: 'Deep Rock Galactic', sizeKb: 11.4 * GB },
      top: [
        { label: 'DRG', sizeKb: 11.4 * GB, owner: 'game' },
        { label: 'vitest', sizeKb: 9 * GB, owner: 'sai-ai' },
        { label: 'app.zen_browser.zen', sizeKb: 6.1 * GB, owner: 'other' },
        { label: 'steam', sizeKb: 2 * GB, owner: 'other' },
        { label: 'x', sizeKb: GB, owner: 'other' },
      ],
    }), false);
    expect(t).toContain(' GPU 80%, VRAM 6.0/12.0 GB.');
    expect(t).toContain('Also running: game "Deep Rock Galactic" 11.4 GB, app.zen_browser.zen 6.1 GB, steam 2.0 GB.');
    expect(t).not.toContain('vitest');
    expect(t).not.toContain('DRG');
    expect(t).not.toContain('and rising');
  });
  it('omits Also running when empty', () => {
    expect(warningNote(sample(), cls({ top: [{ label: 'a', sizeKb: GB, owner: 'sai-app' }] }), false)).not.toContain('Also running');
  });
});

describe('static notes', () => {
  it('normal', () => {
    expect(normalNote()).toBe('[SAI system load: back to normal] Normal workloads are fine again.');
  });
  it('kill', () => {
    const u = { label: 'vitest', sizeKb: 7.2 * GB } as AiUnit;
    expect(killNote(u, 97)).toBe(
      "[SAI system load: CRITICAL] SAI killed `vitest` (7.2 GB) to keep the user's PC from freezing (RAM 97% used). Don't re-run it as-is; use a lighter approach or ask the user first.");
  });
});

describe('NoteBox', () => {
  it('postAll replaces, delivers once per scope, re-arms on new post', () => {
    const b = new NoteBox();
    b.postAll('one', 0); b.postAll('two', 1);
    expect(b.take('claude', '/p', 's1', 2)).toBe('two');
    expect(b.take('claude', '/p', 's1', 3)).toBeNull();
    expect(b.take('claude', '/p', 's2', 3)).toBe('two');
    b.postAll('three', 4);
    expect(b.take('claude', '/p', 's1', 5)).toBe('three');
  });
  it('postTo scope * matches all scopes of provider+project only', () => {
    const b = new NoteBox();
    b.postTo({ provider: 'claude', projectPath: '/p', scope: '*' }, 'k', 0);
    expect(b.take('claude', '/p', 'a', 1)).toBe('k');
    expect(b.take('claude', '/p', 'b', 1)).toBe('k');
    expect(b.take('codex', '/p', 'a', 1)).toBeNull();
    expect(b.take('claude', '/q', 'a', 1)).toBeNull();
  });
  it('specific scope only matches that scope', () => {
    const b = new NoteBox();
    b.postTo({ provider: 'claude', projectPath: '/p', scope: 'a' }, 'k', 0);
    expect(b.take('claude', '/p', 'b', 1)).toBeNull();
    expect(b.take('claude', '/p', 'a', 1)).toBe('k');
  });
  it("projectPath '*' matches every project of the provider", () => {
    const b = new NoteBox();
    b.postTo({ provider: 'codex', projectPath: '*', scope: '*' }, 'k', 0);
    expect(b.take('codex', '/x', 'a', 1)).toBe('k');
    expect(b.take('codex', '/y', 'a', 1)).toBe('k');
    expect(b.take('claude', '/x', 'a', 1)).toBeNull();
  });
  it('kill notes come before the load note', () => {
    const b = new NoteBox();
    b.postAll('load', 0);
    b.postTo({ provider: 'claude', projectPath: '/p', scope: '*' }, 'kill', 1);
    expect(b.take('claude', '/p', 'a', 2)).toBe('kill\nload');
  });
  it('drops notes older than 10 minutes', () => {
    const b = new NoteBox();
    b.postAll('x', 0);
    expect(b.take('claude', '/p', 'a', 600_001)).toBeNull();
  });
  it('matches projectPath through symlinks', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
    const real = path.join(d, 'real'); const link = path.join(d, 'link');
    fs.mkdirSync(real); fs.symlinkSync(real, link);
    const b = new NoteBox();
    b.postTo({ provider: 'claude', projectPath: link, scope: '*' }, 'k', 0);
    expect(b.take('claude', real, 'a', 1)).toBe('k');
    fs.rmSync(d, { recursive: true });
  });
});
