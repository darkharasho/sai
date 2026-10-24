import type { AiUnit, Owner, ProcInfo, TopUser } from './types';

export interface ClassifyCtx {
  instance: number;
  appPids: Set<number>;
  terminalPids: Set<number>;
  clockTicksPerSec: number;
  bootTimeSec: number;
  nowSec: number;
}

export interface Classified {
  units: AiUnit[];
  saiAiKb: number;
  saiAppKb: number;
  /** 10 largest memory users, descending */
  top: TopUser[];
  game: { name: string; sizeKb: number } | null;
}

const SERVICE_MIN_AGE_SEC = 300;
const TOP_N = 10;
const STEAM_MARK = '/steamapps/common/';

/** `…/app-flatpak-app.zen_browser.zen-41.scope` → `app.zen_browser.zen`; null when no app scope/service. */
export function appLabelFromCgroup(cgroup: string): string | null {
  const segs = cgroup.split('/').filter(s => /^app-.+\.(scope|service)$/.test(s));
  const seg = segs[segs.length - 1];
  if (!seg) return null;
  let s = seg.replace(/\.(scope|service)$/, '').replace(/^app-/, '').replace(/^flatpak-/, '');
  s = s.replace(/@.*$/, '').replace(/-[0-9a-f]+$/i, '');
  s = s.replace(/\\x2d/g, '-');
  return s || null;
}

function steamGameName(cmd: string): string | null {
  const i = cmd.indexOf(STEAM_MARK);
  if (i < 0) return null;
  const name = cmd.slice(i + STEAM_MARK.length).split('/')[0];
  return name || null;
}

const sizeOf = (p: ProcInfo) => p.rssKb + p.swapKb;

export function classify(procs: ProcInfo[], ctx: ClassifyCtx): Classified {
  const byPid = new Map<number, ProcInfo>();
  for (const p of procs) byPid.set(p.pid, p);
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  for (const p of procs) {
    if (p.ppid !== p.pid && byPid.has(p.ppid)) {
      const l = children.get(p.ppid);
      if (l) l.push(p.pid); else children.set(p.ppid, [p.pid]);
    } else {
      roots.push(p.pid);
    }
  }
  const ownTagged = (p: ProcInfo) => p.tag !== null && p.tag.instance === ctx.instance;

  // Single top-down walk carrying inherited flags (explicit stack, cycle-safe).
  const owner = new Map<number, Owner>();
  const gameOf = new Map<number, boolean>();
  const agentRoots: number[] = [];
  const seen = new Set<number>();
  const stack: { pid: number; ai: boolean; term: boolean; reaper: boolean }[] =
    roots.map(pid => ({ pid, ai: false, term: false, reaper: false, parentOwn: false }));
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f.pid)) continue;
    seen.add(f.pid);
    const p = byPid.get(f.pid)!;
    const own = ownTagged(p);
    // no sai-ai ancestor at all, so a tagged grandchild under an untagged shim isn't a second root
    if (own && !f.ai) agentRoots.push(p.pid);
    const ai = f.ai || own;
    const term = f.term || ctx.terminalPids.has(p.pid);
    const isGame = f.reaper || p.comm === 'gamescope' || p.cmd.includes(STEAM_MARK);
    gameOf.set(p.pid, isGame);
    owner.set(p.pid, ai ? 'sai-ai' : term ? 'sai-terminal' : ctx.appPids.has(p.pid) ? 'sai-app' : isGame ? 'game' : 'other');
    for (const c of children.get(p.pid) ?? []) {
      stack.push({ pid: c, ai, term, reaper: f.reaper || p.comm === 'reaper' });
    }
  }

  // descendants-first order for the subtree rooted at `root`
  const subtree = (root: number): number[] => {
    const pre: number[] = [];
    const st = [root];
    while (st.length) {
      const pid = st.pop()!;
      pre.push(pid);
      for (const c of children.get(pid) ?? []) st.push(c);
    }
    return pre.reverse();
  };
  const sum = (pids: number[]) => pids.reduce((a, pid) => a + sizeOf(byPid.get(pid)!), 0);

  const units: AiUnit[] = [];
  for (const rootPid of agentRoots) {
    const root = byPid.get(rootPid)!;
    const tag = root.tag!;
    const all = subtree(rootPid);
    units.push({ rootPid, kind: 'agent', tag, sizeKb: sizeOf(root), pids: all, label: root.cmd, startTicks: root.startTicks });
    for (const c of children.get(rootPid) ?? []) {
      const child = byPid.get(c)!;
      const pids = subtree(c);
      const age = ctx.nowSec - (ctx.bootTimeSec + child.startTicks / ctx.clockTicksPerSec);
      units.push({
        rootPid: c, kind: age >= SERVICE_MIN_AGE_SEC ? 'service' : 'command', tag,
        sizeKb: sum(pids), pids, label: child.cmd, startTicks: child.startTicks,
      });
    }
  }

  // Top users: AI units partition sai-ai pids; everything else grouped by owner+label.
  const groups = new Map<string, TopUser>();
  const add = (key: string, u: TopUser) => {
    const g = groups.get(key);
    if (g) g.sizeKb += u.sizeKb; else groups.set(key, { ...u });
  };
  const gameSizes = new Map<string, { sizeKb: number }>();
  let saiAiKb = 0;
  let saiAppKb = 0;
  for (const p of procs) {
    const o = owner.get(p.pid);
    if (!o) continue;
    const size = sizeOf(p);
    if (o === 'sai-ai') saiAiKb += size;
    else if (o === 'sai-app') saiAppKb += size;
    if (o === 'game') {
      const name = steamGameName(p.cmd) ?? p.comm;
      const g = gameSizes.get(name);
      if (g) g.sizeKb += size; else gameSizes.set(name, { sizeKb: size });
    } else if (o !== 'sai-ai') {
      const label = appLabelFromCgroup(p.cgroup) ?? p.comm;
      add(`${o}\0${label}`, { label, sizeKb: size, owner: o });
    }
  }
  // Path-less pids (wine, gamescope) fold into the largest steam-path-named game when one exists.
  const namedGames = new Set<string>();
  for (const p of procs) if (owner.get(p.pid) === 'game') { const n = steamGameName(p.cmd); if (n) namedGames.add(n); }
  if (namedGames.size > 0) {
    const best = [...namedGames].sort((a, b) => gameSizes.get(b)!.sizeKb - gameSizes.get(a)!.sizeKb)[0];
    let total = 0;
    for (const [name, g] of gameSizes) { total += g.sizeKb; if (name !== best) gameSizes.delete(name); }
    gameSizes.get(best)!.sizeKb = total;
  }
  let game: { name: string; sizeKb: number } | null = null;
  for (const [name, g] of gameSizes) {
    add(`game\0${name}`, { label: name, sizeKb: g.sizeKb, owner: 'game' });
    if (!game || g.sizeKb > game.sizeKb) game = { name, sizeKb: g.sizeKb };
  }
  for (const u of units) add(`unit\0${u.rootPid}`, { label: u.label, sizeKb: u.sizeKb, owner: 'sai-ai', tag: u.tag });

  const top = [...groups.values()].sort((a, b) => b.sizeKb - a.sizeKb).slice(0, TOP_N);
  return { units, saiAiKb, saiAppKb, top, game };
}
