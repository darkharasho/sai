// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  sanitizeAppImageEnv,
  buildRelaunchCommands,
  relaunchAppImage,
  buildWaitThenExecScript,
  WAIT_THEN_EXEC_SCRIPT,
} from '../../../electron/services/appImageRelaunch';

const MOUNT = '/var/tmp/u/.mount_saiAbC123';

const appImageEnv = (): NodeJS.ProcessEnv => ({
  APPDIR: MOUNT,
  APPIMAGE: '/home/u/AppImages/sai.appimage',
  ARGV0: '/home/u/AppImages/sai.appimage',
  OWD: '/home/u',
  LD_LIBRARY_PATH: `${MOUNT}/usr/lib:${MOUNT}/usr/lib/x86_64-linux-gnu:${MOUNT}/lib`,
  PATH: `${MOUNT}:${MOUNT}/usr/sbin:/usr/local/bin:/usr/bin`,
  XDG_DATA_DIRS: `${MOUNT}/usr/share/:/usr/local/share:/usr/share`,
  DESKTOPINTEGRATION: '1',
  WAYLAND_DISPLAY: 'wayland-0',
  HOME: '/home/u',
});

describe('sanitizeAppImageEnv', () => {
  it('drops the AppImage runtime vars and every path entry inside the old mount', () => {
    const env = sanitizeAppImageEnv(appImageEnv());
    expect(env.APPDIR).toBeUndefined();
    expect(env.APPIMAGE).toBeUndefined();
    expect(env.ARGV0).toBeUndefined();
    expect(env.OWD).toBeUndefined();
    expect(env.LD_LIBRARY_PATH).toBeUndefined();
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(env.XDG_DATA_DIRS).toBe('/usr/local/share:/usr/share');
  });

  it('keeps unrelated vars and does not mutate the input', () => {
    const input = appImageEnv();
    const env = sanitizeAppImageEnv(input);
    expect(env.DESKTOPINTEGRATION).toBe('1');
    expect(env.WAYLAND_DISPLAY).toBe('wayland-0');
    expect(env.HOME).toBe('/home/u');
    expect(input.APPDIR).toBe(MOUNT);
  });

  it('does not strip sibling dirs that merely share the mount prefix', () => {
    const env = sanitizeAppImageEnv({ APPDIR: MOUNT, PATH: `${MOUNT}x/bin:/usr/bin` });
    expect(env.PATH).toBe(`${MOUNT}x/bin:/usr/bin`);
  });

  it('is a no-op beyond the runtime vars when APPDIR is absent', () => {
    expect(sanitizeAppImageEnv({ PATH: '/usr/bin', APPIMAGE: '/x' })).toEqual({ PATH: '/usr/bin' });
  });
});

describe('buildRelaunchCommands', () => {
  it('prefers a systemd scope, then plain sh', () => {
    const cmds = buildRelaunchCommands({ target: '/a/sai', args: ['--no-sandbox'], waitPid: 42, systemdRun: '/usr/bin/systemd-run' });
    expect(cmds).toHaveLength(2);
    expect(cmds[0].command).toBe('/usr/bin/systemd-run');
    expect(cmds[0].args.slice(0, 5)).toEqual(['--user', '--scope', '--quiet', '--collect', '--']);
    expect(cmds[0].args.slice(-4)).toEqual(['sai-relaunch', '42', '/a/sai', '--no-sandbox']);
    expect(cmds[1].command).toBe('/bin/sh');
  });

  it('uses only plain sh without systemd-run', () => {
    const cmds = buildRelaunchCommands({ target: '/a/sai', args: [], waitPid: 1, systemdRun: null });
    expect(cmds.map((c) => c.command)).toEqual(['/bin/sh']);
  });
});

class FakeChild extends EventEmitter {
  unref() {}
}

describe('relaunchAppImage', () => {
  it('passes the sanitized env and resolves true when the launcher stays alive', async () => {
    const calls: Array<{ command: string; env: NodeJS.ProcessEnv | undefined; detached?: boolean }> = [];
    const ok = await relaunchAppImage('/a/sai', ['--no-sandbox'], {
      env: appImageEnv(),
      pid: 7,
      systemdRun: '/usr/bin/systemd-run',
      graceMs: 10,
      spawn: (command, _args, options) => {
        calls.push({ command, env: options.env, detached: options.detached });
        return new FakeChild() as unknown as ChildProcess;
      },
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].detached).toBe(true);
    expect(calls[0].env?.LD_LIBRARY_PATH).toBeUndefined();
    expect(calls[0].env?.APPDIR).toBeUndefined();
  });

  it('falls back to plain sh when systemd-run exits early', async () => {
    const commands: string[] = [];
    const ok = await relaunchAppImage('/a/sai', [], {
      env: appImageEnv(),
      pid: 7,
      systemdRun: '/usr/bin/systemd-run',
      graceMs: 20,
      spawn: (command) => {
        commands.push(command);
        const child = new FakeChild();
        if (command.endsWith('systemd-run')) setTimeout(() => child.emit('exit', 1), 1);
        return child as unknown as ChildProcess;
      },
    });
    expect(ok).toBe(true);
    expect(commands).toEqual(['/usr/bin/systemd-run', '/bin/sh']);
  });

  it('resolves false when nothing can be launched', async () => {
    const ok = await relaunchAppImage('/a/sai', [], {
      env: {},
      pid: 7,
      systemdRun: null,
      graceMs: 20,
      spawn: () => {
        const child = new FakeChild();
        setTimeout(() => child.emit('error', new Error('ENOENT')), 1);
        return child as unknown as ChildProcess;
      },
    });
    expect(ok).toBe(false);
  });
});

describe('WAIT_THEN_EXEC_SCRIPT (real sh)', () => {
  it('waits for the pid to exit, then execs the target with its args', async () => {
    const waited = spawn('sleep', ['0.6']);
    const start = Date.now();
    const res = await new Promise<{ out: string; ms: number }>((resolve) => {
      let out = '';
      const child = spawn('/bin/sh', ['-c', WAIT_THEN_EXEC_SCRIPT, 'sai-relaunch', String(waited.pid), '/bin/echo', 'hello', 'world']);
      child.stdout.on('data', (d) => (out += d));
      child.on('exit', () => resolve({ out, ms: Date.now() - start }));
    });
    expect(res.out.trim()).toBe('hello world');
    expect(res.ms).toBeGreaterThanOrEqual(500);
  });

  it('execs immediately when the pid is already gone', () => {
    const res = spawnSync('/bin/sh', ['-c', WAIT_THEN_EXEC_SCRIPT, 'sai-relaunch', '999999999', '/bin/echo', 'now']);
    expect(res.stdout.toString().trim()).toBe('now');
  });

  it('aborts without exec when the old pid outlives the wait window', async () => {
    // A short cap so the test doesn't wait the real 60s. The "old instance"
    // (a sleep) is still alive when the window elapses, so we must NOT exec.
    const alive = spawn('sleep', ['5']);
    const script = buildWaitThenExecScript(2); // 2 * 0.2s = 0.4s window
    const res = await new Promise<{ out: string; code: number | null }>((resolve) => {
      let out = '';
      const child = spawn('/bin/sh', ['-c', script, 'sai-relaunch', String(alive.pid), '/bin/echo', 'should-not-run']);
      child.stdout.on('data', (d) => (out += d));
      child.on('exit', (code) => resolve({ out, code }));
    });
    alive.kill();
    expect(res.out.trim()).toBe('');
    expect(res.code).not.toBe(0);
  });
});
