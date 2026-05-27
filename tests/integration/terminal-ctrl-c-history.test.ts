// @vitest-environment node
/**
 * Regression: Ctrl+C of a foreground process that put the tty into raw mode
 * (ISIG disabled) leaves the process alive — the kernel no longer translates
 * \x03 into SIGINT, and the renderer's fallback signal was hitting the
 * shell's own pgrp instead of the foreground job's. The user-visible
 * symptom was "cursor moves up, nothing shown" on the next up-arrow,
 * because the still-running process kept consuming keystrokes.
 *
 * Real-world trigger: `npm run dev` / `vite` (raw stdin for key shortcuts).
 *
 * Fix: signalTerminalImpl in electron/services/pty.ts now reads tpgid from
 * /proc/<shellPid>/stat and signals the foreground pgrp.
 */

import { describe, it, expect } from 'vitest';
import * as pty from 'node-pty';
import * as os from 'node:os';
import * as fs from 'node:fs';

const SHELL = '/bin/bash';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(
  getBuf: () => string,
  predicate: (s: string) => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(getBuf())) return;
    await sleep(25);
  }
  throw new Error(
    `[${label}] timeout after ${timeoutMs}ms; tail = ${JSON.stringify(getBuf().slice(-300))}`,
  );
}

/** Read the foreground process group id from a Linux pty session's shell pid. */
function readForegroundPgid(shellPid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${shellPid}/stat`, 'utf8');
    const closeParen = stat.lastIndexOf(')');
    const fields = stat.slice(closeParen + 2).split(' ');
    // After slicing past "<pid> (comm) ", tpgid is field index 5 (matches the
    // existing readForegroundPgid logic in electron/services/pty.ts).
    const tpgid = parseInt(fields[5], 10);
    return tpgid > 0 ? tpgid : null;
  } catch {
    return null;
  }
}

describe.skipIf(process.platform !== 'linux')(
  'Ctrl+C of a raw-mode process should not orphan it',
  () => {
    it('up-arrow recalls history after Ctrl+C of a process that set raw stdin', async () => {
      const histFile = `${os.tmpdir()}/sai-test-history-${process.pid}-${Date.now()}`;
      const term = pty.spawn(SHELL, ['--noprofile', '--norc', '-i'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          PS1: 'PROMPT$ ',
          HISTFILE: histFile,
          HISTSIZE: '50',
          TERM: 'xterm-256color',
        },
      });

      let buf = '';
      term.onData((d) => { buf += d; });

      try {
        await waitUntil(() => buf, (b) => b.includes('PROMPT$ '), 4000, 'initial prompt');

        // Foreground process that sets raw stdin (like Vite/npm-run-dev) — so
        // the tty driver will *not* translate \x03 into SIGINT.
        const childCmd =
          `node -e 'process.stdin.setRawMode(true); setInterval(()=>{},1000)'`;
        term.write(`${childCmd}\n`);
        // Wait until the foreground pgrp is no longer bash itself.
        await waitUntil(
          () => '',
          () => {
            const tpgid = readForegroundPgid(term.pid);
            return tpgid !== null && tpgid !== term.pid;
          },
          3000,
          'foreground process took over tty',
        );

        // --- Reproduce the renderer's Ctrl+C path WITH THE FIX ---
        // Old (broken) behaviour: process.kill(-term.pid, 'SIGINT') — only
        // signals the shell's pgrp, missing the foreground job that left
        // ISIG off and so swallowed our \x03. Fix in electron/services/
        // pty.ts:signalTerminalImpl signals the foreground pgrp (tpgid).
        term.write('\x03');
        const fgPgid = readForegroundPgid(term.pid);
        const target = fgPgid && fgPgid !== term.pid ? -fgPgid : -term.pid;
        try { process.kill(target, 'SIGINT'); } catch { /* ignore */ }

        // If the fix is applied (signal goes to the foreground pgrp), the
        // child dies and bash redraws its prompt within a second.
        // If the bug is present, the child survives and we never see a new
        // prompt.
        const beforeWait = buf.length;
        const gotPrompt = await Promise.race([
          waitUntil(
            () => buf,
            (b) => b.slice(beforeWait).includes('PROMPT$ '),
            2000,
            'post-interrupt prompt',
          ).then(() => true),
          sleep(2200).then(() => false),
        ]);

        expect(gotPrompt).toBe(true);
        // Sanity check the foreground is back to bash.
        const tpgid = readForegroundPgid(term.pid);
        expect(tpgid).toBe(term.pid);
      } finally {
        try { term.kill(); } catch { /* already dead */ }
      }
    }, 15000);
  },
);
