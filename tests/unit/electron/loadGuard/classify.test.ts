// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classify, appLabelFromCgroup, cgroupUnit, maskSecrets, type ClassifyCtx } from '../../../../electron/services/loadGuard/classify';
import type { ProcInfo, ScopeTag } from '../../../../electron/services/loadGuard/types';

const GiB = 1024 * 1024;
const HZ = 100;
const NOW = 10_000;
// pid 0 stands in for SAI main: fixture agent roots (ppid 0) are spawned by the app.
const ctx = (over: Partial<ClassifyCtx> = {}): ClassifyCtx => ({
  instance: 7, appPids: new Set([0]), terminalPids: new Set(), clockTicksPerSec: HZ, bootTimeSec: 0, nowSec: NOW, ...over,
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

describe('classify: orphaned tagged roots (I1)', () => {
  it.each([
    ['reparented to init', 1],
    ['reparented to a non-app subreaper', 4242],
  ])('a tagged root %s is a command/service unit, never the agent', (_name, ppid) => {
    const procs = [
      proc(4242, 1, { comm: 'systemd' }),
      proc(10, 0, { tag: tag(), cmd: 'claude' }),
      proc(50, ppid, { tag: tag(), cmd: 'npm run dev', rssKb: 100, startTicks: started(900) }),
      proc(51, 50, { cmd: 'vite', rssKb: 2000 }),
      proc(60, ppid, { tag: tag(), cmd: 'sleep 9', rssKb: 10, startTicks: started(5) }),
    ];
    const r = classify(procs, ctx());
    expect(r.units.filter(u => u.kind === 'agent').map(u => u.rootPid)).toEqual([10]);
    const svc = r.units.find(u => u.rootPid === 50)!;
    expect(svc).toMatchObject({ kind: 'service', sizeKb: 2100, pids: [51, 50] });
    expect(r.units.find(u => u.rootPid === 60)?.kind).toBe('command');
    // the orphan's child is part of the orphan's unit, not a unit of its own
    expect(r.units.some(u => u.rootPid === 51)).toBe(false);
  });

  it('keeps a root spawned by any SAI app pid (main, utility) as the agent', () => {
    const procs = [proc(1, 900, { tag: tag() }), proc(2, 1, { startTicks: started(10) })];
    const r = classify(procs, ctx({ appPids: new Set([900, 901]) }));
    expect(r.units.map(u => [u.rootPid, u.kind]).sort()).toEqual([[1, 'agent'], [2, 'command']]);
  });
});

describe('classify: foreign apps the AI cold-started (I2)', () => {
  const SELF = '/user.slice/user-1000.slice/user@1000.service/app.slice/app-sai-1.scope';
  const FOX = '/user.slice/user-1000.slice/user@1000.service/app.slice/app-firefox-9.scope';

  it('drops the tag for a pid (and its subtree) in a different app scope', () => {
    const procs = [
      proc(1, 0, { tag: tag(), cgroup: SELF, rssKb: 100 }),
      proc(2, 1, { tag: tag(), cgroup: SELF, rssKb: 10 }),
      proc(30, 77, { tag: tag(), cgroup: FOX, comm: 'firefox-bin', rssKb: 5 * GiB }),
      proc(31, 30, { tag: tag(), cgroup: FOX, comm: 'Isolated Web Co', rssKb: GiB }),
    ];
    const r = classify(procs, ctx({ selfCgroup: SELF }));
    expect(r.units.flatMap(u => u.pids).filter((p, i, a) => a.indexOf(p) === i).sort()).toEqual([1, 2]);
    expect(r.saiAiKb).toBe(110);
    expect(r.top.find(t => t.label === 'firefox')).toMatchObject({ owner: 'other', sizeKb: 6 * GiB });
  });

  it('drops the tag for a *.service unit too, but not for a nested cgroup of SAI\'s own scope', () => {
    const procs = [
      proc(1, 0, { tag: tag(), cgroup: SELF }),
      proc(2, 1, { tag: tag(), cgroup: `${SELF}/sub` }),
      proc(3, 1, { tag: tag(), cgroup: '/user.slice/user-1000.slice/user@1000.service/app.slice/gpg-agent.service' }),
    ];
    const r = classify(procs, ctx({ selfCgroup: SELF }));
    expect(r.units.flatMap(u => u.pids).filter((p, i, a) => a.indexOf(p) === i).sort()).toEqual([1, 2]);
  });

  it('keeps every tag when SAI runs outside any app scope and so do its children', () => {
    const SESSION = '/user.slice/user-1000.slice/session-2.scope';
    const procs = [proc(1, 0, { tag: tag(), cgroup: SESSION }), proc(2, 1, { tag: tag(), cgroup: SESSION })];
    expect(classify(procs, ctx({ selfCgroup: SESSION })).units.flatMap(u => u.pids).filter((p, i, a) => a.indexOf(p) === i).sort()).toEqual([1, 2]);
  });

  it.each(['firefox', 'chrome', 'chromium', 'code', 'tmux: server', 'gpg-agent', 'ssh-agent'])(
    'denylists comm %s and its subtree even in SAI\'s own cgroup',
    (comm) => {
      const procs = [
        proc(1, 0, { tag: tag(), rssKb: 100 }),
        proc(2, 1, { tag: tag(), comm, rssKb: 3 * GiB }),
        proc(3, 2, { tag: tag(), rssKb: GiB }),
      ];
      const r = classify(procs, ctx());
      expect(r.units.map(u => u.rootPid)).toEqual([1]);
      expect(r.units[0].pids).toEqual([1]);
      expect(r.saiAiKb).toBe(100);
      expect(r.top.filter(t => t.owner === 'sai-ai').every(t => t.sizeKb === 100)).toBe(true);
    },
  );

  it('extracts the owning systemd unit from a cgroup path', () => {
    expect(cgroupUnit(`${FOX}`)).toBe(FOX);
    expect(cgroupUnit(`${SELF}/sub/leaf`)).toBe(SELF);
    expect(cgroupUnit('/user.slice/user-1000.slice/user@1000.service/init.scope')).toBeNull();
    expect(cgroupUnit('/user.slice/user-1000.slice/session-2.scope')).toBeNull();
    expect(cgroupUnit('')).toBeNull();
  });
});

describe('maskSecrets (M3)', () => {
  it.each([
    ['curl -H Authorization: Bearer abc.def https://x', 'curl -H Authorization: Bearer *** https://x'],
    ['curl -H Authorization: tok123 https://x', 'curl -H Authorization: *** https://x'],
    ['curl -H authorization:Basic Zm9v x', 'curl -H authorization:Basic *** x'],
    ['http GET x Bearer sekrit', 'http GET x Bearer ***'],
    ['gh --token ghp_123 api', 'gh --token *** api'],
    ['tool --token=ghp_123 run', 'tool --token=*** run'],
    ['mysql --password hunter2 db', 'mysql --password *** db'],
    ['x --api-key=sk-1 --api-key sk-2', 'x --api-key=*** --api-key ***'],
    ['env GITHUB_TOKEN=ghp_1 AWS_SECRET=a OPENAI_API_KEY=sk node s.js', 'env GITHUB_TOKEN=*** AWS_SECRET=*** OPENAI_API_KEY=*** node s.js'],
    ['npm run dev -- --port 5173', 'npm run dev -- --port 5173'],
  ])('%s', (input, out) => {
    expect(maskSecrets(input)).toBe(out);
  });

  it('masks unit labels before they leave classify', () => {
    const procs = [
      proc(1, 0, { tag: tag(), cmd: 'claude --api-key sk-1' }),
      proc(2, 1, { cmd: 'curl -H Authorization: Bearer xyz https://api', startTicks: started(5) }),
    ];
    const r = classify(procs, ctx());
    expect(r.units.map(u => u.label).sort()).toEqual(['claude --api-key ***', 'curl -H Authorization: Bearer *** https://api']);
    expect(r.top.some(t => /sk-1|xyz/.test(t.label))).toBe(false);
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
