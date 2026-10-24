// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSystemSample, readProcesses, readGpu, readBootTimeSec, readSelfCgroup } from '../../../../electron/services/loadGuard/procReader';
import { formatScopeTag } from '../../../../electron/services/loadGuard/scopeTag';

let root: string;

async function put(rel: string, content: string) {
  const f = path.join(root, rel);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, content);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'procreader-'));
  await put('meminfo', [
    'MemTotal:       31457280 kB',
    'MemFree:          200000 kB',
    'MemAvailable:    1572864 kB',
    'SwapTotal:      23068672 kB',
    'SwapFree:       20971520 kB',
    '',
  ].join('\n'));
  await put('pressure/memory', [
    'some avg10=12.50 avg60=5.00 avg300=1.00 total=123',
    'full avg10=11.20 avg60=4.00 avg300=0.50 total=100',
    '',
  ].join('\n'));
  await put('pressure/cpu', 'some avg10=3.10 avg60=2.00 avg300=1.00 total=999\n');

  // 100: tagged, comm with a space
  await put('100/stat', '100 (Web Content) S 1 100 100 0 -1 4194560 1 0 0 0 5 5 0 0 20 0 1 0 987654 1000 200 18446744073709551615\n');
  await put('100/status', 'Name:\tWeb Content\nVmRSS:\t  204800 kB\nVmSwap:\t    1024 kB\n');
  await put('100/cmdline', 'node\0server.js\0--port\0' + '3000\0');
  await put('100/cgroup', '0::/user.slice/app.slice/foo.scope\n');
  await put('100/environ', `HOME=/home/x\0${'SAI_LOAD_SCOPE'}=${formatScopeTag({ instance: 4242, provider: 'claude', scope: 'chat', projectPath: '/p' })}\0PATH=/bin\0`);

  // 101: environ file missing
  await put('101/stat', '101 (bash) S 1 101 101 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 555 1000 100\n');
  await put('101/status', 'Name:\tbash\nVmRSS:\t 100 kB\nVmSwap:\t 0 kB\n');
  await put('101/cmdline', 'bash\0');
  await put('101/cgroup', '0::/\n');

  // 102: kernel thread, no VmRSS, empty cmdline
  await put('102/stat', '102 (kworker/0:1) I 2 0 0 0 -1 69238880 0 0 0 0 0 0 0 0 20 0 1 0 77 0 0\n');
  await put('102/status', 'Name:\tkworker/0:1\n');
  await put('102/cmdline', '');
  await put('102/cgroup', '0::/\n');
  await put('102/environ', '');

  // 103: no stat
  await put('103/status', 'Name:\tx\n');
  // 104: comm containing parens and spaces
  await put('104/stat', '104 (a) b (c)) S 1 104 104 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 321 1000 100\n');
  await put('104/status', 'VmRSS:\t 5 kB\n');
  // 105: tagged but in D state (environ/cmdline reads could block on its mmap_lock)
  await put('105/stat', '105 (node) D 1 105 105 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 999 1000 100\n');
  await put('105/status', 'VmRSS:\t 7 kB\n');
  await put('105/cmdline', 'node\0secret.js\0');
  await put('105/cgroup', '0::/x.scope\n');
  await put('105/environ', `SAI_LOAD_SCOPE=${formatScopeTag({ instance: 4242, provider: 'claude', scope: 'chat', projectPath: '/p' })}\0`);
  // non-numeric dir is ignored
  await put('self/stat', 'garbage');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('procReader', () => {
  it('parses system sample', async () => {
    const sys = await readSystemSample(root, 123);
    expect(sys).toMatchObject({ ts: 123, memTotalKb: 31457280, memAvailableKb: 1572864, swapTotalKb: 23068672, swapFreeKb: 20971520, psiMemSome10: 12.5, psiMemFull10: 11.2, psiCpuSome10: 3.1 });
  });

  it('gives 0 for missing PSI files', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'procreader-empty-'));
    try {
      await fs.writeFile(path.join(empty, 'meminfo'), 'MemTotal: 10 kB\nMemAvailable: 5 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n');
      const sys = await readSystemSample(empty);
      expect(sys).toMatchObject({ psiMemSome10: 0, psiMemFull10: 0, psiCpuSome10: 0 });
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it('parses processes', async () => {
    const procs = await readProcesses(root);
    const p100 = procs.find(p => p.pid === 100)!;
    expect(p100.comm).toBe('Web Content');
    expect(p100).toMatchObject({ ppid: 1, startTicks: 987654, rssKb: 204800, swapKb: 1024, cmd: 'node server.js --port 3000', cgroup: '/user.slice/app.slice/foo.scope' });
    expect(p100.tag).toMatchObject({ provider: 'claude', scope: 'chat' });
    expect(procs.find(p => p.pid === 101)!.tag).toBeNull();
    expect(procs.find(p => p.pid === 102)!.rssKb).toBe(0);
    expect(procs.some(p => p.pid === 103)).toBe(false);
    expect(procs.find(p => p.pid === 104)).toMatchObject({ comm: 'a) b (c)', ppid: 1, startTicks: 321 });
    expect(procs.some(p => Number.isNaN(p.pid))).toBe(false);
  });

  it('M1: skips environ and cmdline for a D-state pid (untagged this scan)', async () => {
    const p105 = (await readProcesses(root)).find(p => p.pid === 105)!;
    expect(p105).toMatchObject({ ppid: 1, startTicks: 999, rssKb: 7, cmd: '', tag: null, cgroup: '/x.scope' });
  });

  it('parses gpu', async () => {
    expect(await readGpu(async () => '98, 10240, 12288\n')).toEqual({ utilPct: 98, vramUsedMb: 10240, vramTotalMb: 12288 });
    expect(await readGpu(async () => '10, 1, 2\n20, 3, 4\n')).toEqual({ utilPct: 10, vramUsedMb: 1, vramTotalMb: 2 });
    expect(await readGpu(async () => { throw new Error('ENOENT'); })).toBeNull();
    expect(await readGpu(async () => '\n')).toBeNull();
  });

  it('resolves null when exec never settles', async () => {
    expect(await readGpu(() => new Promise<string>(() => {}), 20)).toBeNull();
  });
});

describe('readBootTimeSec', () => {
  it('reads btime from <procRoot>/stat, null when missing', async () => {
    await put('stat', 'cpu  1 2 3 4\nintr 5\nbtime 1761200000\nprocesses 42\n');
    expect(readBootTimeSec(root)).toBe(1761200000);
    expect(readBootTimeSec(path.join(root, 'nope'))).toBeNull();
  });
});

describe('readSelfCgroup', () => {
  it('reads the 0:: line of <procRoot>/self/cgroup, empty when missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'procreader-self-'));
    try {
      await fs.mkdir(path.join(dir, 'self'));
      await fs.writeFile(path.join(dir, 'self', 'cgroup'), '1:name=systemd:/x\n0::/user.slice/app.slice/app-sai-1.scope\n');
      expect(readSelfCgroup(dir)).toBe('/user.slice/app.slice/app-sai-1.scope');
      expect(readSelfCgroup(path.join(dir, 'nope'))).toBe('');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
