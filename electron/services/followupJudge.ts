import { spawn } from 'node:child_process';
import { spawnEnv } from './claude';
import { devlog, devlogSnip } from './devlog';
import type { FollowUpVerdict } from './followupState';

const IS_WIN = process.platform === 'win32';

export const FOLLOWUP_JUDGE_TIMEOUT_MS = 15_000;
export const FOLLOWUP_JUDGE_MAX_CHARS = 2000;

/** runner returns the model's stdout; injected for tests. */
export type JudgeRunner = (prompt: string, signal: AbortSignal) => Promise<string>;

export function buildJudgePrompt(finalText: string): string {
  const tail = finalText.slice(-FOLLOWUP_JUDGE_MAX_CHARS);
  return `Decide whether an AI assistant's closing message says or implies the AI will act again later on its own, without the user. Questions to the user and optional offers are NOT follow-ups.
Reply with JSON only: {"followUp": boolean, "waitingFor": string|null} (waitingFor: a short NOUN PHRASE naming the thing being waited on, at most 8 words, e.g. "CI for PR #42" or "the staging deploy" — not a verb phrase like "the deploy to finish"; null if none).

Examples:
"I'll keep watching CI and fix anything that fails." -> {"followUp":true,"waitingFor":"CI for PR #42"}
"I'll report back when the agents finish." -> {"followUp":true,"waitingFor":"the review agents"}
"Want me to open a PR?" -> {"followUp":false,"waitingFor":null}
"Which option do you prefer?" -> {"followUp":false,"waitingFor":null}
"Done — tests pass." -> {"followUp":false,"waitingFor":null}

<message>
${tail}
</message>`;
}

export function parseJudgeVerdict(raw: string): FollowUpVerdict | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.followUp !== 'boolean') return null;
  let waitingFor: string | null = null;
  if (typeof o.waitingFor === 'string') {
    const words = o.waitingFor.trim().split(/\s+/).filter(Boolean);
    waitingFor = words.length ? words.slice(0, 8).join(' ') : null;
  }
  return { followUp: o.followUp, waitingFor };
}

export function makeCliJudgeRunner(claudePath: string | undefined): JudgeRunner {
  return (prompt, signal) => new Promise<string>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('aborted')); return; }
    const proc = spawn(claudePath ?? 'claude', [
      '-p', '--output-format', 'text', '--max-turns', '1', '--model', 'haiku',
      '--no-session-persistence', '--tools', IS_WIN ? '""' : '', '--strict-mcp-config',
    ], { env: spawnEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: IS_WIN });
    // Prompt goes via stdin, never argv: with shell:true on Windows, AI text containing & or | would be executed by cmd.
    proc.stdin?.on('error', () => {});
    proc.stdin?.end(prompt);
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', () => {});
    const onAbort = () => { proc.kill(); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
    proc.on('error', (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
    proc.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve(out); else reject(new Error(`claude exited ${code}`));
    });
  });
}

export async function judgeFollowUp(
  finalText: string,
  run: JudgeRunner,
  timeoutMs: number = FOLLOWUP_JUDGE_TIMEOUT_MS,
): Promise<FollowUpVerdict | null> {
  if (!finalText || !finalText.trim()) return null;
  const started = Date.now();
  const ac = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => { timedOut = true; ac.abort(); resolve(null); }, timeoutMs);
  });
  let raw = '';
  try {
    const out = await Promise.race([run(buildJudgePrompt(finalText), ac.signal), timeout]);
    if (out === null) {
      devlog('followupJudge', 'fail', { reason: 'timeout' });
      return null;
    }
    raw = out;
  } catch {
    devlog('followupJudge', 'fail', { reason: timedOut ? 'timeout' : 'error' });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const verdict = parseJudgeVerdict(raw);
  if (!verdict) {
    devlog('followupJudge', 'fail', { reason: 'parse', raw: devlogSnip(raw) });
    return null;
  }
  devlog('followupJudge', 'verdict', { ...verdict, ms: Date.now() - started });
  return verdict;
}
