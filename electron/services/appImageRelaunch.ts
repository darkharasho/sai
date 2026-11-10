import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';

/**
 * Relaunching an AppImage after a self-update.
 *
 * Why not app.relaunch(): on Linux, Electron's relauncher waits for this
 * process to die and then execs the new binary with OUR environment. That env
 * was injected by the AppImage runtime and points into this instance's FUSE
 * mount (/tmp/.mount_XXXX) — LD_LIBRARY_PATH, PATH, APPDIR, etc. The relaunch
 * fires exactly while that mount is being torn down. The (dynamic) AppImage
 * runtime of the new binary dlopen()s libfuse.so.2, glibc searches the dying
 * mount first, gets ENOTCONN/EIO (which aborts the whole search, unlike ENOENT),
 * and the runtime shows "Cannot mount AppImage, please check your FUSE setup"
 * as a desktop notification. The user then has to start SAI by hand.
 *
 * Instead we start a tiny shell launcher with an env scrubbed of everything
 * pointing into the mount. It waits for this process to exit (so two instances
 * never fight over the profile) and then execs the new AppImage. Where
 * available it runs under `systemd-run --user --scope`, so it is not part of
 * the old instance's systemd unit (KDE runs apps as app-*.service units).
 */

/** Variables the AppImage runtime sets that describe the *old* mount/binary. */
const APPIMAGE_RUNTIME_VARS = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'];

function isInsideDir(entry: string, dir: string): boolean {
  return entry === dir || entry.startsWith(dir.endsWith('/') ? dir : `${dir}/`);
}

/**
 * Return a copy of `env` with the AppImage runtime's variables removed and
 * every colon-separated path entry under APPDIR stripped (LD_LIBRARY_PATH,
 * PATH, XDG_DATA_DIRS, QT_PLUGIN_PATH, …). Variables left empty are dropped.
 */
export function sanitizeAppImageEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  const appDir = env.APPDIR?.replace(/\/+$/, '');
  for (const key of APPIMAGE_RUNTIME_VARS) delete out[key];
  if (!appDir) return out;

  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'string' || !value.includes(appDir)) continue;
    const kept = value.split(':').filter((entry) => entry !== '' && !isInsideDir(entry, appDir));
    if (kept.length === 0) delete out[key];
    else out[key] = kept.join(':');
  }
  return out;
}

/**
 * POSIX sh script: wait for pid $1 to exit (up to `maxWaitIterations` * 0.2s),
 * then exec the rest of argv. Args: <pid> <target> [args…], with $0 as a label.
 *
 * If the old instance is STILL alive after the window, we abort (exit 1) instead
 * of exec-ing — launching the new binary while the old one holds the profile is
 * what produced two instances fighting over IndexedDB (a frozen renderer). The
 * single-instance lock would make the new copy quit anyway, so there is nothing
 * to gain by starting it; the user relaunches the (already stuck) app by hand.
 * The default window is generous (60s) so an honestly-slow quit still relaunches.
 */
export function buildWaitThenExecScript(maxWaitIterations = 300): string {
  return (
    'pid="$1"; shift; i=0; ' +
    `while kill -0 "$pid" 2>/dev/null && [ "$i" -lt ${maxWaitIterations} ]; do sleep 0.2; i=$((i+1)); done; ` +
    'if kill -0 "$pid" 2>/dev/null; then exit 1; fi; ' +
    'exec "$@"'
  );
}

export const WAIT_THEN_EXEC_SCRIPT = buildWaitThenExecScript();

export interface RelaunchCommand {
  command: string;
  args: string[];
}

/** Build the launcher command(s): systemd-run first (if usable), plain sh as fallback. */
export function buildRelaunchCommands(opts: {
  target: string;
  args: string[];
  waitPid: number;
  systemdRun: string | null;
}): RelaunchCommand[] {
  const shArgs = ['-c', WAIT_THEN_EXEC_SCRIPT, 'sai-relaunch', String(opts.waitPid), opts.target, ...opts.args];
  const plain: RelaunchCommand = { command: '/bin/sh', args: shArgs };
  if (!opts.systemdRun) return [plain];
  return [
    {
      command: opts.systemdRun,
      args: ['--user', '--scope', '--quiet', '--collect', '--', '/bin/sh', ...shArgs],
    },
    plain,
  ];
}

function findSystemdRun(): string | null {
  for (const p of ['/usr/bin/systemd-run', '/bin/systemd-run']) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Resolve true if the launcher is alive after `graceMs` (it is blocked waiting
 * for us, i.e. it started fine), false if it failed to spawn or exited early
 * (e.g. systemd-run with no user bus).
 */
function launchAndConfirm(spawnFn: SpawnFn, cmd: RelaunchCommand, env: NodeJS.ProcessEnv, graceMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    let child: ChildProcess;
    try {
      child = spawnFn(cmd.command, cmd.args, { detached: true, stdio: 'ignore', env });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => done(true), graceMs);
    child.once('error', () => done(false));
    // The script cannot finish while we are alive, so any exit inside the grace
    // window means the launcher itself failed.
    child.once('exit', () => done(false));
    child.unref();
  });
}

/**
 * Start the freshly installed AppImage once this process has exited, with a
 * clean environment. Resolves true if a launcher is in place (caller should
 * then app.exit()), false if none could be started.
 */
export async function relaunchAppImage(
  target: string,
  args: string[],
  deps: {
    spawn?: SpawnFn;
    env?: NodeJS.ProcessEnv;
    pid?: number;
    systemdRun?: string | null;
    graceMs?: number;
  } = {},
): Promise<boolean> {
  const env = sanitizeAppImageEnv(deps.env ?? process.env);
  const commands = buildRelaunchCommands({
    target,
    args,
    waitPid: deps.pid ?? process.pid,
    systemdRun: deps.systemdRun !== undefined ? deps.systemdRun : findSystemdRun(),
  });
  for (const cmd of commands) {
    if (await launchAndConfirm(deps.spawn ?? nodeSpawn, cmd, env, deps.graceMs ?? 750)) return true;
    console.error(`[updater] relaunch via ${cmd.command} failed, trying next`);
  }
  return false;
}
