// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classify, appLabelFromCgroup, type ClassifyCtx } from '../../../../electron/services/loadGuard/classify';
import type { ProcInfo, ScopeTag } from '../../../../electron/services/loadGuard/types';

const GiB = 1024 * 1024;
const HZ = 100;
const NOW = 10_000;
const ctx = (over: Partial<ClassifyCtx> = {}): ClassifyCtx => ({
  instance: 7, appPids: new Set(), terminalPids: new Set(), clockTicksPerSec: HZ, bootTimeSec: 0, nowSec: NOW, ...over,
});
const tag = (over: Partial<ScopeTag> = {}): ScopeTag => ({ instance: 7, provider: 'claude', projectPath: '/p', scope: 's', ...over });
/** age in seconds -> startTicks */
const started = (ageSec: number) => (NOW - ageSec) * HZ;
const proc = (pid: number, ppid: number, over: Partial<ProcInfo> = {}): ProcInfo => ({
  pid, ppid, comm: `c${pid}`, cmd: `cmd${pid}`, startTicks: started(5000), rssKb: 1000, swapKb: 0, cgroup: '', tag: null, ...over,
});

describe('classify', () => {
  it('builds command, service and agent units for an own-instance agent', () => {
    const procs = [
      proc(1, 0, { cmd: 'claude', rssKb: 300 * 1024, tag: tag() }),
      proc(2, 1, { cmd: 'vitest run', rssKb: 7 * GiB - 1024, swapKb: 1024, startTicks: started(20) }),
      proc(3, 2, { cmd: 'vitest worker', rssKb: 1024 }),
      proc(4, 1, { cmd: 'vite dev', rssKb: 1 * GiB, startTicks: started(900) }),
    ];
    const r = classify(procs, ctx());
    expect(r.units.map(u => u.kind).sort()).toEqual(['agent', 'command', 'service']);
    const agent = r.units.find(u => u.kind === 'agent')!;
    expect(agent.sizeKb).toBe(300 * 1024);
    expect(agent.pids[agent.pids.length - 1]).toBe(1);
    expect([...agent.pids].sort()).toEqual([1, 2, 3, 4]);
    const cmd = r.units.find(u => u.kind === 'command')!;
    expect(cmd.rootPid).toBe(2);
    expect(cmd.sizeKb).toBe(7 * GiB + 1024);
    expect(cmd.pids).toEqual([3, 2]);
    expect(cmd.label).toBe('vitest run');
    const svc = r.units.find(u => u.kind === 'service')!;
    expect(svc.rootPid).toBe(4);
    expect(svc.sizeKb).toBe(1 * GiB);
    expect(r.saiAiKb).toBe(300 * 1024 + 7 * GiB + 1024 + 1 * GiB);
    expect(r.top[0]).toMatchObject({ label: 'vitest run', owner: 'sai-ai' });
  });

  it('treats a wildcard tag (projectPath/scope "*") as own-instance', () => {
    const procs = [proc(1, 0, { tag: tag({ projectPath: '*', scope: '*', provider: 'codex' }) }), proc(2, 1)];
    expect(classify(procs, ctx()).units.map(u => u.rootPid).sort()).toEqual([1, 2]);
  });

  it('does not classify another instance tag as sai-ai', () => {
    const procs = [proc(1, 0, { tag: tag({ instance: 99 }), rssKb: 5 * GiB }), proc(2, 1)];
    const r = classify(procs, ctx());
    expect(r.units).toEqual([]);
    expect(r.saiAiKb).toBe(0);
    expect(r.top[0].owner).toBe('other');
  });

  it('classifies terminal descendants as sai-terminal, never units', () => {
    const procs = [proc(10, 1, { comm: 'zsh' }), proc(11, 10, { cmd: 'node big.js', rssKb: 2 * GiB })];
    const r = classify(procs, ctx({ terminalPids: new Set([10]) }));
    expect(r.units).toEqual([]);
    expect(r.top.find(t => t.label === 'c11')?.owner).toBe('sai-terminal');
  });

  it('counts app pids as sai-app', () => {
    const r = classify([proc(5, 1, { rssKb: 500 })], ctx({ appPids: new Set([5]) }));
    expect(r.saiAppKb).toBe(500);
    expect(r.saiAiKb).toBe(0);
  });

  it('detects a steam game by path', () => {
    const procs = [proc(20, 1, { cmd: '/home/u/.steam/steamapps/common/Deep Rock Galactic/FSD.exe', rssKb: 6 * GiB })];
    const r = classify(procs, ctx());
    expect(r.game).toEqual({ name: 'Deep Rock Galactic', sizeKb: 6 * GiB });
    expect(r.top[0]).toMatchObject({ label: 'Deep Rock Galactic', owner: 'game' });
  });

  it('detects gamescope and reaper descendants as game', () => {
    const procs = [proc(30, 1, { comm: 'reaper' }), proc(31, 30, { comm: 'wine', cmd: 'wine game.exe', rssKb: 100 })];
    const r = classify(procs, ctx());
    expect(r.game).toEqual({ name: 'wine', sizeKb: 100 });
    expect(classify([proc(40, 1, { comm: 'gamescope' })], ctx()).game?.name).toBe('gamescope');
  });

  it('keeps named games separate; path-less and Proton pids fold into the largest', () => {
    const steam = (n: string) => `/h/.steam/steamapps/common/${n}/x.exe`;
    const procs = [
      proc(60, 1, { cmd: steam('Big Game'), rssKb: 5000 }),
      proc(61, 1, { cmd: steam('Small Game'), rssKb: 1000 }),
      proc(62, 1, { comm: 'gamescope', rssKb: 300 }),
      proc(63, 1, { cmd: steam('Proton 9.0'), rssKb: 200 }),
    ];
    const r = classify(procs, ctx());
    expect(r.game).toEqual({ name: 'Big Game', sizeKb: 5500 });
    expect(r.top.filter(t => t.owner === 'game').map(t => [t.label, t.sizeKb])).toEqual([['Big Game', 5500], ['Small Game', 1000]]);
  });

  it('aggregates path-less games under the largest member name', () => {
    const procs = [proc(69, 1, { comm: 'reaper', rssKb: 1 }), proc(70, 69, { comm: 'wine', rssKb: 100 }), proc(71, 1, { comm: 'gamescope', rssKb: 500 })];
    expect(classify(procs, ctx()).game).toEqual({ name: 'gamescope', sizeKb: 600 });
  });

  it('does not make a tagged grandchild under an untagged shim a second root', () => {
    const procs = [
      proc(1, 0, { tag: tag(), rssKb: 100 }),
      proc(2, 1, { rssKb: 10 }),
      proc(3, 2, { tag: tag(), rssKb: 1000 }),
    ];
    const r = classify(procs, ctx());
    expect(r.units.filter(u => u.kind === 'agent')).toHaveLength(1);
    expect(r.units.map(u => u.rootPid).sort()).toEqual([1, 2]);
    expect(r.saiAiKb).toBe(1110);
  });

  it('makes a tagged direct child a command/service unit, not a root', () => {
    const procs = [proc(1, 0, { tag: tag() }), proc(2, 1, { tag: tag(), startTicks: started(10) })];
    const r = classify(procs, ctx());
    expect(r.units.map(u => [u.rootPid, u.kind]).sort()).toEqual([[1, 'agent'], [2, 'command']]);
  });

  it('yields exactly one agent unit for a childless agent', () => {
    const r = classify([proc(1, 0, { tag: tag() })], ctx());
    expect(r.units).toHaveLength(1);
    expect(r.units[0].kind).toBe('agent');
  });

  it('groups other processes by app cgroup label, falling back to comm', () => {
    const cg = '0::/user.slice/app.slice/app-flatpak-app.zen_browser.zen-41.scope';
    const procs = [proc(50, 1, { cgroup: cg, rssKb: 100 }), proc(51, 1, { cgroup: cg, rssKb: 200 }), proc(52, 1, { comm: 'foo', rssKb: 10 })];
    const r = classify(procs, ctx());
    expect(r.top[0]).toMatchObject({ label: 'app.zen_browser.zen', sizeKb: 300, owner: 'other' });
    expect(r.top[1].label).toBe('foo');
  });

  it('caps top at 10', () => {
    const procs = Array.from({ length: 15 }, (_, i) => proc(100 + i, 1, { comm: `p${i}`, rssKb: i + 1 }));
    const r = classify(procs, ctx());
    expect(r.top).toHaveLength(10);
    expect(r.top[0].sizeKb).toBe(15);
  });
});

describe('appLabelFromCgroup', () => {
  it('extracts app labels', () => {
    expect(appLabelFromCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-flatpak-app.zen_browser.zen-41.scope')).toBe('app.zen_browser.zen');
    expect(appLabelFromCgroup('0::/user.slice/app.slice/app-steam@abc.service')).toBe('steam');
    expect(appLabelFromCgroup('0::/user.slice/session-3.scope')).toBeNull();
    expect(appLabelFromCgroup('0::/app.slice/app-org.gnome.Foo\\x2dBar-1a2b.scope')).toBe('org.gnome.Foo-Bar');
  });
});
