// One-time sudo credential for agent-run commands. Ported from otto
// (src/main/shell/sudo-session.ts) with app-wide scope and a stable-path
// askpass (see createFileAskpass). Free of electron imports — wiring that
// needs `app` lives in ./index.ts.

import { spawn as nodeSpawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Detect whether a shell command will invoke `sudo` interactively somewhere.
// Matches `sudo` as a command word — at the start, or after a shell operator
// (`;`, `|`, `&`, `&&`, `||`, newline, subshell `(`) — but NOT when it already
// runs non-interactively (`sudo -n` / `sudo --non-interactive`), since those
// never prompt and must be allowed to fail fast on their own.
const SUDO_DETECT =
  /(?:^|[\n;&|(]|&&|\|\|)\s*sudo\b(?!\s+(?:-n\b|--non-interactive\b))/;

// Quoted spans are arguments or remote commands (`ssh host '… && sudo …'`,
// `grep 'a|sudo'`), never a local sudo invocation, so they are masked to `_`
// before matching. The deliberate miss — local sudo hidden inside quotes,
// e.g. `sh -c 'sudo x'` — fails fast on the locked askpass instead of
// hanging, which is recoverable; a false-positive password popup is not.
// An unterminated quote swallows the rest of the command, like a shell would.
function maskQuotedSpans(command: string): string {
  let out = '';
  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    if (ch === '\\') {
      out += '_';
      i += 2;
    } else if (ch === "'" || ch === '"') {
      i += 1;
      while (i < command.length && command[i] !== ch) {
        i += ch === '"' && command[i] === '\\' ? 2 : 1;
      }
      i += 1;
      out += '_';
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

export function commandRequiresSudo(command: string): boolean {
  return SUDO_DETECT.test(maskQuotedSpans(command));
}

/**
 * Runs `sudo` to validate a password. Injected so SudoSession is unit-testable
 * without a real sudo binary.
 */
export interface SudoRunner {
  /** Feed `password` to `sudo -S -v`. Resolves `{ ok: false, stderr }` on a
   *  wrong password rather than throwing. */
  validate(password: string): Promise<{ ok: boolean; stderr: string }>;
}

/** Turn sudo's stderr into a short, user-facing reason. */
export function parseSudoError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('incorrect password') || s.includes('sorry, try again')) {
    return 'Incorrect password';
  }
  if (s.includes('not in the sudoers') || s.includes('not allowed')) {
    return 'This user is not permitted to run sudo';
  }
  const firstLine = stderr.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  return firstLine || 'sudo authentication failed';
}

export const realSudoRunner: SudoRunner = {
  validate(password) {
    return new Promise((resolve) => {
      // `-S` reads the password from stdin; `-p ''` suppresses the prompt text;
      // `-v` only validates/extends the timestamp without running a command.
      const child = nodeSpawn('sudo', ['-S', '-p', '', '-v'], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.once('error', (err) => {
        resolve({ ok: false, stderr: (err as Error).message });
      });
      child.once('exit', (code) => {
        resolve({ ok: code === 0, stderr });
      });
      child.stdin.write(password + '\n');
      child.stdin.end();
    });
  },
};

/** Makes the captured password available to spawned `sudo` invocations. */
export interface AskpassController {
  install(password: string): void;
  uninstall(): void;
}

/**
 * Stable-path askpass. SAI's SDK subprocesses are long-lived, so a post-spawn
 * env change never reaches them; instead every subprocess gets
 * `SUDO_ASKPASS=<dir>/askpass.sh` at spawn (spawnEnv) and the helper `cat`s
 * `<dir>/pw`, which only exists while unlocked. With no tty sudo runs the
 * helper automatically; while locked the helper exits non-zero so sudo fails
 * fast instead of hanging. The password lives in a 0600 file, never in any
 * process env, so it can't leak into the output of unrelated commands.
 */
export function createFileAskpass(
  dir: string,
  logger: { warn: (msg: string) => void } = { warn: () => {} }
): AskpassController & { helperPath: string; init(): void } {
  const helperPath = path.join(dir, 'askpass.sh');
  const pwFile = path.join(dir, 'pw');
  return {
    helperPath,
    /** Write the helper script; delete any stale pw file (crash leftover). */
    init(): void {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      // userData paths contain no single quotes, so single-quoting is safe.
      fs.writeFileSync(helperPath, `#!/bin/sh\nexec cat -- '${pwFile}'\n`, { mode: 0o700 });
      fs.rmSync(pwFile, { force: true });
    },
    install(password: string): void {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        // Trailing newline is fine — sudo reads the first line from askpass.
        fs.writeFileSync(pwFile, `${password}\n`, { mode: 0o600 });
      } catch (err) {
        logger.warn(
          `failed to write sudo askpass credential: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    uninstall(): void {
      try {
        fs.rmSync(pwFile, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    },
  };
}

export interface SudoSessionDeps {
  /** Installs/removes the askpass credential. Required (no ambient default). */
  askpass: AskpassController;
  runner?: SudoRunner;
  /** How often to refresh/re-check the credential so revocation is noticed. */
  keepAliveMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logger?: { warn: (msg: string) => void };
  /** Fired on every locked/unlocked transition (drives the TitleBar chip). */
  onStateChange?: (unlocked: boolean) => void;
}

/**
 * Holds the elevated credential in memory, app-wide, for one app run.
 * Captured once via the SudoBroker prompt, validated, then materialized
 * through the AskpassController. A keep-alive periodically re-validates and
 * drops it if it stops working (password changed/revoked).
 */
export class SudoSession {
  private password: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly askpass: AskpassController;
  private readonly runner: SudoRunner;
  private readonly keepAliveMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly logger: { warn: (msg: string) => void };
  private readonly onStateChange: (unlocked: boolean) => void;

  constructor(deps: SudoSessionDeps) {
    this.askpass = deps.askpass;
    this.runner = deps.runner ?? realSudoRunner;
    this.keepAliveMs = deps.keepAliveMs ?? 60_000;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
    this.logger = deps.logger ?? { warn: () => {} };
    this.onStateChange = deps.onStateChange ?? (() => {});
  }

  isUnlocked(): boolean {
    return this.password !== null;
  }

  /** Validate `password` and, on success, hold it and start the keep-alive. */
  async unlock(password: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.runner.validate(password);
    if (!res.ok) {
      return { ok: false, error: parseSudoError(res.stderr) };
    }
    this.clear();
    this.password = password;
    this.askpass.install(password);
    this.startKeepAlive();
    this.onStateChange(true);
    return { ok: true };
  }

  /** Wipe the credential, remove the askpass pw file, stop the keep-alive. */
  clear(): void {
    const wasUnlocked = this.password !== null;
    this.password = null;
    this.askpass.uninstall();
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
    if (wasUnlocked) this.onStateChange(false);
  }

  private startKeepAlive(): void {
    this.timer = this.setIntervalFn(() => {
      const pw = this.password;
      if (pw === null) return;
      void this.runner.validate(pw).then((res) => {
        // A lock/unlock may have swapped the credential while this validate
        // was in flight — never let a stale result clear the new session.
        if (this.password !== pw) return;
        if (!res.ok) {
          // Password no longer works (changed, revoked) — drop it so the next
          // elevated command re-prompts rather than silently failing.
          this.logger.warn(`sudo keep-alive failed, clearing credential: ${parseSudoError(res.stderr)}`);
          this.clear();
        }
      });
    }, this.keepAliveMs);
    // Don't let the keep-alive keep the process alive on its own.
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }
}
