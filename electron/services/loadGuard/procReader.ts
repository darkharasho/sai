import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import type { ProcInfo, SystemSample } from './types';
import { SCOPE_ENV, parseScopeTag } from './scopeTag';

const MAX_IN_FLIGHT = 32;
const CMD_MAX = 200;
const GPU_TIMEOUT_MS = 2000;

async function readText(file: string): Promise<string> {
  return fs.readFile(file, 'utf8');
}

/** Missing/unreadable file → ''. */
async function readTextOrEmpty(file: string): Promise<string> {
  try {
    return await readText(file);
  } catch {
    return '';
  }
}

function kbField(text: string, key: string): number {
  const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text);
  return m ? Number(m[1]) : 0;
}

function psiAvg10(text: string, kind: 'some' | 'full'): number {
  const m = new RegExp(`^${kind} avg10=([\\d.]+)`, 'm').exec(text);
  return m ? Number(m[1]) : 0;
}

export async function readSystemSample(
  procRoot = '/proc',
  now = Date.now(),
): Promise<Omit<SystemSample, 'gpu'>> {
  const [meminfo, psiMem, psiCpu] = await Promise.all([
    readText(`${procRoot}/meminfo`),
    readTextOrEmpty(`${procRoot}/pressure/memory`),
    readTextOrEmpty(`${procRoot}/pressure/cpu`),
  ]);
  return {
    ts: now,
    memTotalKb: kbField(meminfo, 'MemTotal'),
    memAvailableKb: kbField(meminfo, 'MemAvailable'),
    swapTotalKb: kbField(meminfo, 'SwapTotal'),
    swapFreeKb: kbField(meminfo, 'SwapFree'),
    psiMemSome10: psiAvg10(psiMem, 'some'),
    psiMemFull10: psiAvg10(psiMem, 'full'),
    psiCpuSome10: psiAvg10(psiCpu, 'some'),
  };
}

/** Boot time (epoch seconds) from the `btime` line of /proc/stat; null when unreadable. Read once at boot. */
export function readBootTimeSec(procRoot = '/proc'): number | null {
  try {
    const m = /^btime\s+(\d+)/m.exec(readFileSync(`${procRoot}/stat`, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function readProc(procRoot: string, pid: number): Promise<ProcInfo | null> {
  try {
    const dir = `${procRoot}/${pid}`;
    const stat = await readText(`${dir}/stat`);
    // comm may contain spaces and parens: it ends at the LAST ')'.
    const open = stat.indexOf('(');
    const close = stat.lastIndexOf(')');
    if (open < 0 || close < open) return null;
    const comm = stat.slice(open + 1, close);
    // Fields after comm start at field 3 (state); ppid = field 4, starttime = field 22.
    const rest = stat.slice(close + 2).trim().split(/\s+/);
    const ppid = Number(rest[1]);
    const startTicks = Number(rest[19]);
    if (!Number.isFinite(ppid) || !Number.isFinite(startTicks)) return null;

    // Sequential on purpose: worker count == max reads in flight.
    const status = await readTextOrEmpty(`${dir}/status`);
    const cmdline = await readTextOrEmpty(`${dir}/cmdline`);
    const cgroupText = await readTextOrEmpty(`${dir}/cgroup`);
    const environ = await readTextOrEmpty(`${dir}/environ`);

    const cgroupLine = cgroupText.split('\n').find(l => l.startsWith('0::'));
    let tag: ProcInfo['tag'] = null;
    const prefix = `${SCOPE_ENV}=`;
    for (const entry of environ.split('\0')) {
      if (entry.startsWith(prefix)) {
        tag = parseScopeTag(entry.slice(prefix.length));
        break;
      }
    }

    return {
      pid,
      ppid,
      comm,
      cmd: cmdline.replace(/\0+$/, '').replace(/\0/g, ' ').slice(0, CMD_MAX),
      startTicks,
      rssKb: kbField(status, 'VmRSS'),
      swapKb: kbField(status, 'VmSwap'),
      cgroup: cgroupLine ? cgroupLine.slice(3) : '',
      tag,
    };
  } catch {
    // process exited mid-read, EACCES, etc.
    return null;
  }
}

export async function readProcesses(procRoot = '/proc'): Promise<ProcInfo[]> {
  const pids = (await fs.readdir(procRoot))
    .filter(n => /^\d+$/.test(n))
    .map(Number);
  const out: ProcInfo[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pids.length) {
      const info = await readProc(procRoot, pids[next++]);
      if (info) out.push(info);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, pids.length) }, worker));
  return out;
}

function defaultExec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function readGpu(
  exec: (cmd: string, args: string[], timeoutMs: number) => Promise<string> = defaultExec,
  timeoutMs = GPU_TIMEOUT_MS,
): Promise<SystemSample['gpu']> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Race a hard timer: a process in uninterruptible sleep may ignore execFile's timeout.
    const out = await Promise.race([
      exec(
        'nvidia-smi',
        ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
        timeoutMs,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('nvidia-smi timeout')), timeoutMs);
      }),
    ]);
    const line = out.split('\n').find(l => l.trim());
    if (!line) return null;
    const [util, used, total] = line.split(',').map(s => Number(s.trim()));
    if (![util, used, total].every(Number.isFinite)) return null;
    return { utilPct: util, vramUsedMb: used, vramTotalMb: total };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
