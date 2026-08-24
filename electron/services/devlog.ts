import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Developer diagnostics log — a general-purpose tracing facility for dogfooding.
 *
 * This is deliberately NOT tied to any one subsystem. Any code that makes a
 * decision worth explaining later can call devlog(channel, event, data); the
 * channel is just a free-form subsystem tag. Records are newline-delimited JSON
 * so a whole session can be sliced after the fact:
 *
 *   tail -f ~/.config/sai/logs/devlog.jsonl | jq -c 'select(.ch=="notify")'
 *   jq -c 'select(.ev|startswith("turnEnd"))' ~/.config/sai/logs/devlog.jsonl
 *
 * Each entry should capture one decision at one boundary — who acted, what
 * state they read, and what they decided — so "why did that happen?" is
 * answered from the log rather than from a rebuild with printf debugging.
 *
 * Enabled when any of these hold (checked at most every SETTINGS_TTL_MS):
 *   - the signed-in GitHub account is one of DEV_LOGINS (we dogfood; users don't)
 *   - settings.json has `"devlog": true` (opt-in for anyone helping debug)
 *   - SAI_DEVLOG=1 in the environment
 * SAI_DEVLOG=0 forces it off everywhere, including for the above.
 *
 * SAI_DEVLOG_CHANNELS optionally narrows output to a comma-separated set of
 * channels (e.g. SAI_DEVLOG_CHANNELS=notify,claude-sdk) to keep a noisy repro
 * readable. Unset means all channels.
 */

/** GitHub logins that get diagnostics without any opt-in. */
const DEV_LOGINS = ['darkharasho'];
const MAX_BYTES = 5 * 1024 * 1024;
const SETTINGS_TTL_MS = 5000;

let cachedEnabled: boolean | null = null;
let cachedAt = 0;
let logPath: string | null = null;
let warned = false;

function readSettings(): any {
  try {
    const file = path.join(app.getPath('userData'), 'settings.json');
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/** Channels allowed through, or null for "everything". */
function channelFilter(): Set<string> | null {
  const raw = process.env.SAI_DEVLOG_CHANNELS;
  if (!raw) return null;
  const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

/** Whether diagnostics are on right now. Re-checked at most every 5s. */
export function devlogEnabled(): boolean {
  if (process.env.SAI_DEVLOG === '0') return false;
  if (process.env.SAI_DEVLOG === '1') return true;
  const now = Date.now();
  if (cachedEnabled !== null && now - cachedAt < SETTINGS_TTL_MS) return cachedEnabled;
  cachedAt = now;
  const settings = readSettings();
  const login = settings?.github_auth?.user?.login;
  cachedEnabled =
    settings?.devlog === true ||
    (typeof login === 'string' && DEV_LOGINS.includes(login));
  return cachedEnabled;
}

export function devlogPath(): string {
  if (!logPath) {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'devlog.jsonl');
  }
  return logPath;
}

function rotateIfNeeded(file: string) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    fs.renameSync(file, `${file}.1`);
  } catch { /* missing file, or a racing rotate — next append recreates it */ }
}

/**
 * Append one diagnostic record. Never throws and never blocks a decision:
 * a broken log must not change app behaviour.
 *
 * @param channel coarse subsystem, e.g. 'notify' | 'claude-sdk' | 'renderer'
 * @param event   what happened, e.g. 'completion.suppressed'
 * @param data    flat, JSON-safe state that explains the decision
 */
export function devlog(channel: string, event: string, data?: Record<string, unknown>): void {
  if (!devlogEnabled()) return;
  const only = channelFilter();
  if (only && !only.has(channel)) return;
  try {
    const file = devlogPath();
    rotateIfNeeded(file);
    const rec = { t: new Date().toISOString(), ch: channel, ev: event, ...(data ?? {}) };
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn('[devlog] disabled — write failed:', err);
    }
  }
}

/**
 * Bind a channel so a subsystem can instrument itself in one line:
 *
 *   const log = devlogFor('terminal');
 *   log('spawn', { shell, cwd });
 */
export function devlogFor(channel: string) {
  return (event: string, data?: Record<string, unknown>) => devlog(channel, event, data);
}

/**
 * Time a block and log how long it took. Works for sync and async bodies;
 * the result (or the error) is passed through untouched.
 */
export function devlogTimed<T>(channel: string, event: string, fn: () => T, data?: Record<string, unknown>): T {
  if (!devlogEnabled()) return fn();
  const started = Date.now();
  const finish = (extra: Record<string, unknown>) =>
    devlog(channel, event, { ...(data ?? {}), ms: Date.now() - started, ...extra });
  try {
    const out = fn();
    if (out instanceof Promise) {
      return out.then(
        (v) => { finish({ ok: true }); return v; },
        (err) => { finish({ ok: false, error: devlogSnip(String(err)) }); throw err; },
      ) as unknown as T;
    }
    finish({ ok: true });
    return out;
  } catch (err) {
    finish({ ok: false, error: devlogSnip(String(err)) });
    throw err;
  }
}

/** Truncate free text so a log line stays greppable. */
export function devlogSnip(text: unknown, max = 120): string | undefined {
  if (typeof text !== 'string') return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
