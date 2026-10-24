import type { AiUnit, Owner, ProcInfo, TopUser, UnitKind } from './types';

export interface ClassifyCtx {
  instance: number;
  appPids: Set<number>;
  terminalPids: Set<number>;
  clockTicksPerSec: number;
  bootTimeSec: number;
  nowSec: number;
  /** SAI main's own cgroup path (/proc/self/cgroup, read once at boot); '' when unknown */
  selfCgroup?: string;
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
/** Long-lived user apps an AI may cold-start: they inherit the tag but are never SAI's to touch. */
const FOREIGN_COMMS: ReadonlySet<string> = new Set(['firefox', 'chrome', 'chromium', 'code', 'tmux: server', 'gpg-agent', 'ssh-agent']);
const UNIT_SEG = /^app-.+\.scope$|\.service$/;
const USER_MANAGER_SEG = /^user@\d+\.service$/;

/**
 * The systemd unit a cgroup path belongs to: the path through its deepest `app-*.scope` or
 * `*.service` segment (the per-user manager `user@N.service` doesn't count); null when none.
 */
export function cgroupUnit(cgroup: string): string | null {
  const segs = cgroup.replace(/^0::/, '').split('/');
  for (let i = segs.length - 1; i >= 0; i--) {
    if (UNIT_SEG.test(segs[i]) && !USER_MANAGER_SEG.test(segs[i])) return segs.slice(0, i + 1).join('/');
  }
  return null;
}

/** Masks secret-looking argv values so a label is safe for the devlog, chat card and remote bus. */
export function maskSecrets(cmd: string): string {
  return cmd
    .replace(/(\bBearer\s+)\S+/gi, '$1***')
    .replace(/(\bAuthorization:\s*)(?:(Bearer|Basic|Token)\s+)?\S+/gi, (_m, pre: string, scheme?: string) => `${pre}${scheme ? `${scheme} ` : ''}***`)
    .replace(/(--(?:token|password|api-key)(?:=|\s+))\S+/gi, '$1***')
    .replace(/\b(\w*_(?:TOKEN|KEY|SECRET))=\S+/gi, '$1=***');
}

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
  const selfUnit = cgroupUnit(ctx.selfCgroup ?? '');
  // A desktop launcher (xdg-open, KIO) gives the app its own unit while keeping the caller's env.
  const foreign = (p: ProcInfo) => {
    if (FOREIGN_COMMS.has(p.comm)) return true;
    const unit = cgroupUnit(p.cgroup);
    return unit !== null && unit !== selfUnit;
  };

  // Single top-down walk carrying inherited flags (explicit stack, cycle-safe).
  const owner = new Map<number, Owner>();
  const agentRoots: number[] = [];
  const seen = new Set<number>();
  const stack: { pid: number; ai: boolean; term: boolean; reaper: boolean; blocked: boolean }[] =
    roots.map(pid => ({ pid, ai: false, term: false, reaper: false, blocked: false }));
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f.pid)) continue;
    seen.add(f.pid);
    const p = byPid.get(f.pid)!;
    // A foreign app inside the AI region and its subtree drop the tag: never frozen, killed
    // or counted as SAI's. Outside it (SAI's own ancestors: tmux, a VS Code terminal) the
    // check doesn't apply, or SAI's whole AI tree would be ignored.
    const blocked = f.blocked || ((f.ai || ownTagged(p)) && foreign(p));
    const own = !blocked && ownTagged(p);
    // no sai-ai ancestor at all, so a tagged grandchild under an untagged shim isn't a second root
    if (own && !f.ai) agentRoots.push(p.pid);
    const ai = !blocked && (f.ai || own);
    const term = f.term || ctx.terminalPids.has(p.pid);
    const isGame = f.reaper || p.comm === 'gamescope' || p.cmd.includes(STEAM_MARK);
    owner.set(p.pid, ai ? 'sai-ai' : term ? 'sai-terminal' : ctx.appPids.has(p.pid) ? 'sai-app' : isGame ? 'game' : 'other');
    for (const c of children.get(p.pid) ?? []) {
      stack.push({ pid: c, ai, term, reaper: f.reaper || p.comm === 'reaper', blocked });
    }
  }

  const isAi = (pid: number) => owner.get(pid) === 'sai-ai';
  // descendants-first order for the sai-ai part of the subtree rooted at `root`
  const subtree = (root: number): number[] => {
    const pre: number[] = [];
    const st = [root];
    while (st.length) {
      const pid = st.pop()!;
      pre.push(pid);
      for (const c of children.get(pid) ?? []) if (isAi(c)) st.push(c);
    }
    return pre.reverse();
  };
  const sum = (pids: number[]) => pids.reduce((a, pid) => a + sizeOf(byPid.get(pid)!), 0);
  const kindByAge = (p: ProcInfo): UnitKind =>
    ctx.nowSec - (ctx.bootTimeSec + p.startTicks / ctx.clockTicksPerSec) >= SERVICE_MIN_AGE_SEC ? 'service' : 'command';

  const units: AiUnit[] = [];
  for (const rootPid of agentRoots) {
    const root = byPid.get(rootPid)!;
    const tag = root.tag!;
    const all = subtree(rootPid);
    // Provider CLIs are spawned straight by SAI's own processes. A tagged root with any other
    // parent was orphaned (a backgrounded dev server reparented to systemd): it is one
    // command/service unit, never the chat's agent.
    if (!ctx.appPids.has(root.ppid)) {
      units.push({ rootPid, kind: kindByAge(root), tag, sizeKb: sum(all), pids: all, label: maskSecrets(root.cmd), startTicks: root.startTicks });
      continue;
    }
    units.push({ rootPid, kind: 'agent', tag, sizeKb: sizeOf(root), pids: all, label: maskSecrets(root.cmd), startTicks: root.startTicks });
    for (const c of children.get(rootPid) ?? []) {
      if (!isAi(c)) continue;
      const child = byPid.get(c)!;
      const pids = subtree(c);
      units.push({
        rootPid: c, kind: kindByAge(child), tag,
        sizeKb: sum(pids), pids, label: maskSecrets(child.cmd), startTicks: child.startTicks,
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
  // Path-less pids (wine, gamescope) and runtime groups (Proton, SteamLinuxRuntime) fold into the
  // largest real named game; with none, they aggregate into one entry named after the largest member.
  const isRuntime = (n: string) => /^(Proton|SteamLinuxRuntime)/.test(n);
  const real = new Set<string>();
  for (const p of procs) {
    if (owner.get(p.pid) !== 'game') continue;
    const n = steamGameName(p.cmd);
    if (n && !isRuntime(n)) real.add(n);
  }
  const loose = [...gameSizes.keys()].filter(n => !real.has(n));
  if (loose.length > 0) {
    const target = real.size > 0
      ? [...real].sort((a, b) => gameSizes.get(b)!.sizeKb - gameSizes.get(a)!.sizeKb)[0]
      : [...loose].sort((a, b) => gameSizes.get(b)!.sizeKb - gameSizes.get(a)!.sizeKb)[0];
    let extra = 0;
    for (const n of loose) { if (n !== target) { extra += gameSizes.get(n)!.sizeKb; gameSizes.delete(n); } }
    gameSizes.get(target)!.sizeKb += extra;
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
