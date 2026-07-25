// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  commandRequiresSudo,
  createFileAskpass,
  parseSudoError,
  SudoSession,
  type AskpassController,
  type SudoRunner,
} from '@electron/services/sudo/sudoSession';

function fakeAskpass(): AskpassController & { installed: string[]; uninstalls: number } {
  const installed: string[] = [];
  let uninstalls = 0;
  return {
    installed,
    get uninstalls() { return uninstalls; },
    install(password: string) { installed.push(password); },
    uninstall() { uninstalls += 1; },
  };
}

function fakeRunner(results: Array<{ ok: boolean; stderr: string }>): SudoRunner & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async validate(password: string) {
      calls.push(password);
      return results[Math.min(i++, results.length - 1)]!;
    },
  };
}

describe('commandRequiresSudo', () => {
  it('detects a leading sudo', () => {
    expect(commandRequiresSudo('sudo apt update')).toBe(true);
    expect(commandRequiresSudo('  sudo dnf install x')).toBe(true);
  });

  it('detects sudo inside a pipeline or sequence', () => {
    expect(commandRequiresSudo('echo hi | sudo tee /etc/foo')).toBe(true);
    expect(commandRequiresSudo('cd /tmp && sudo systemctl restart x')).toBe(true);
    expect(commandRequiresSudo('foo; sudo bar')).toBe(true);
    expect(commandRequiresSudo('(sudo whoami)')).toBe(true);
  });

  it('ignores non-interactive sudo', () => {
    expect(commandRequiresSudo('sudo -n true')).toBe(false);
    expect(commandRequiresSudo('sudo --non-interactive systemctl status x')).toBe(false);
  });

  it('does not match plain commands or sudo as a substring', () => {
    expect(commandRequiresSudo('apt update')).toBe(false);
    expect(commandRequiresSudo('echo pseudosudo')).toBe(false);
    expect(commandRequiresSudo('cat sudoku.txt')).toBe(false);
  });

  it('ignores sudo inside quoted strings', () => {
    // Remote sudo via ssh — local elevation can't help it.
    expect(commandRequiresSudo("ssh venus.local 'mkdir -p /opt/x && sudo systemctl restart bot'")).toBe(false);
    expect(commandRequiresSudo('ssh host "cd /srv; sudo reboot"')).toBe(false);
    // sudo as data, not a command.
    expect(commandRequiresSudo("grep -iE 'askpass|sudo' file.ts")).toBe(false);
    expect(commandRequiresSudo("git commit -m 'fix: gate & sudo prompt'")).toBe(false);
  });

  it('still detects sudo when quotes appear elsewhere in the command', () => {
    expect(commandRequiresSudo("sudo cp 'a b.txt' /etc/")).toBe(true);
    expect(commandRequiresSudo("echo 'done' && sudo reboot")).toBe(true);
  });

  it('treats a backslash-escaped quote as literal, not a quote opener', () => {
    expect(commandRequiresSudo("echo \\' ; sudo ls")).toBe(true);
  });

  it('treats everything after an unbalanced quote as quoted', () => {
    expect(commandRequiresSudo("echo 'oops && sudo ls")).toBe(false);
  });
});

describe('parseSudoError', () => {
  it('recognizes a wrong password', () => {
    expect(parseSudoError('Sorry, try again.')).toBe('Incorrect password');
    expect(parseSudoError('sudo: 1 incorrect password attempt')).toBe('Incorrect password');
  });
  it('recognizes a non-sudoer', () => {
    expect(parseSudoError('user is not in the sudoers file.')).toMatch(/not permitted/);
  });
  it('falls back to the first stderr line', () => {
    expect(parseSudoError('\n  some other failure\nmore\n')).toBe('some other failure');
  });
});

describe('SudoSession', () => {
  it('starts locked', () => {
    const s = new SudoSession({ askpass: fakeAskpass(), runner: fakeRunner([{ ok: true, stderr: '' }]) });
    expect(s.isUnlocked()).toBe(false);
  });

  it('unlocks on a valid password and notifies state change', async () => {
    const runner = fakeRunner([{ ok: true, stderr: '' }]);
    const states: boolean[] = [];
    const s = new SudoSession({
      askpass: fakeAskpass(),
      runner,
      setIntervalFn: (() => 0) as never,
      onStateChange: (u) => states.push(u),
    });
    const res = await s.unlock('hunter2');
    expect(res.ok).toBe(true);
    expect(runner.calls).toEqual(['hunter2']);
    expect(s.isUnlocked()).toBe(true);
    expect(states).toEqual([true]);
  });

  it('rejects a wrong password, stays locked, no state change', async () => {
    const states: boolean[] = [];
    const s = new SudoSession({
      askpass: fakeAskpass(),
      runner: fakeRunner([{ ok: false, stderr: 'Sorry, try again.' }]),
      onStateChange: (u) => states.push(u),
    });
    const res = await s.unlock('bad');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Incorrect password');
    expect(s.isUnlocked()).toBe(false);
    expect(states).toEqual([]);
  });

  it('clear() wipes the credential, uninstalls askpass, stops keep-alive, notifies', async () => {
    const askpass = fakeAskpass();
    const states: boolean[] = [];
    const clearIntervalFn = vi.fn();
    const s = new SudoSession({
      askpass,
      runner: fakeRunner([{ ok: true, stderr: '' }]),
      setIntervalFn: (() => 123) as never,
      clearIntervalFn,
      onStateChange: (u) => states.push(u),
    });
    await s.unlock('pw');
    s.clear();
    expect(s.isUnlocked()).toBe(false);
    expect(clearIntervalFn).toHaveBeenCalledWith(123);
    expect(askpass.uninstalls).toBeGreaterThanOrEqual(1);
    expect(states).toEqual([true, false]);
  });

  it('clear() when already locked does not re-notify', () => {
    const states: boolean[] = [];
    const s = new SudoSession({ askpass: fakeAskpass(), onStateChange: (u) => states.push(u) });
    s.clear();
    expect(states).toEqual([]);
  });

  it('installs the askpass credential on unlock only', async () => {
    const askpass = fakeAskpass();
    const good = new SudoSession({
      askpass,
      runner: fakeRunner([{ ok: true, stderr: '' }]),
      setIntervalFn: (() => 0) as never,
    });
    await good.unlock('hunter2');
    expect(askpass.installed).toEqual(['hunter2']);

    const askpass2 = fakeAskpass();
    const bad = new SudoSession({
      askpass: askpass2,
      runner: fakeRunner([{ ok: false, stderr: 'Sorry, try again.' }]),
    });
    await bad.unlock('bad');
    expect(askpass2.installed).toEqual([]);
  });

  it('keep-alive re-validates the credential and clears on failure', async () => {
    let tick: (() => void) | null = null;
    const runner = fakeRunner([
      { ok: true, stderr: '' }, // initial unlock
      { ok: false, stderr: 'Sorry, try again.' }, // keep-alive sees revoked creds
    ]);
    const s = new SudoSession({
      askpass: fakeAskpass(),
      runner,
      setIntervalFn: ((fn: () => void) => { tick = fn; return 1; }) as never,
      clearIntervalFn: () => {},
    });
    await s.unlock('pw');
    expect(s.isUnlocked()).toBe(true);
    tick!();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.isUnlocked()).toBe(false);
    expect(runner.calls).toEqual(['pw', 'pw']);
  });

  it('a stale in-flight keep-alive validate does not clear a newer credential', async () => {
    let tick: (() => void) | null = null;
    const calls: string[] = [];
    // Deferred validate results, keyed per-call, so the test controls exactly
    // when each resolves.
    const pending: Array<{ password: string; resolve: (r: { ok: boolean; stderr: string }) => void }> = [];
    const runner: SudoRunner = {
      validate(password: string) {
        calls.push(password);
        return new Promise((resolve) => {
          pending.push({ password, resolve: resolve as never });
        });
      },
    };
    const s = new SudoSession({
      askpass: fakeAskpass(),
      runner,
      setIntervalFn: ((fn: () => void) => { tick = fn; return 1; }) as never,
      clearIntervalFn: () => {},
    });

    // Unlock with 'pw-a' — resolve its initial validate immediately.
    const unlockA = s.unlock('pw-a');
    pending.shift()!.resolve({ ok: true, stderr: '' });
    await unlockA;
    expect(s.isUnlocked()).toBe(true);

    // Trigger the keep-alive tick for 'pw-a'; its validate stays pending (deferred).
    tick!();
    expect(calls).toEqual(['pw-a', 'pw-a']);
    const staleValidate = pending.shift()!;
    expect(staleValidate.password).toBe('pw-a');

    // Before the stale validate resolves, the credential is swapped: clear(),
    // then unlock with 'pw-b' (its own validate resolves immediately).
    s.clear();
    const unlockB = s.unlock('pw-b');
    pending.shift()!.resolve({ ok: true, stderr: '' });
    await unlockB;
    expect(s.isUnlocked()).toBe(true);

    // Now resolve the stale 'pw-a' validate as a failure — it must NOT clear
    // the newer 'pw-b' session.
    staleValidate.resolve({ ok: false, stderr: 'Sorry, try again.' });
    await Promise.resolve();
    await Promise.resolve();
    expect(s.isUnlocked()).toBe(true);
  });
});

describe('createFileAskpass', () => {
  let dir: string;
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('init() writes an executable helper and deletes a stale pw file', () => {
    dir = mkdtempSync(join(tmpdir(), 'sai-sudo-test-'));
    const askpass = createFileAskpass(dir);
    askpass.install('stale'); // simulate a crash leaving a pw file behind
    askpass.init();
    expect(existsSync(askpass.helperPath)).toBe(true);
    expect(existsSync(join(dir, 'pw'))).toBe(false);
    expect(readFileSync(askpass.helperPath, 'utf8')).toContain('cat --');
  });

  it('helper prints the password while installed and fails after uninstall', () => {
    dir = mkdtempSync(join(tmpdir(), 'sai-sudo-test-'));
    const askpass = createFileAskpass(dir);
    askpass.init();
    askpass.install('s3cr3t-pw');
    const out = execFileSync(askpass.helperPath, { encoding: 'utf8' });
    expect(out.replace(/\n$/, '')).toBe('s3cr3t-pw');

    askpass.uninstall();
    expect(existsSync(join(dir, 'pw'))).toBe(false);
    // With no pw file the helper exits non-zero → sudo fails fast instead of hanging.
    expect(() => execFileSync(askpass.helperPath, { stdio: 'pipe' })).toThrow();
  });
});
