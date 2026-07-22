// Read-only Codex account rate-limit telemetry.
//
// `requestCodexRateLimits()` is a single one-shot app-server round trip:
// spawn -> initialize -> initialized -> account/rateLimits/read -> kill.
// `CodexTelemetryService` layers a short success cache, in-flight
// coalescing, stale marking, and bounded backoff on top of it so renderer
// callers can poll cheaply without hammering a failing Codex binary.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { enrichedEnv } from './shellEnv';
import { resolveBundledCodex } from './codexBackend/bundledModels';
import type { CodexRateLimitsSnapshot, CodexRateLimitWindow } from '../../src/lib/composerTelemetry';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30_000;
const STALE_AFTER_MS = 120_000;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

// Messages surfaced to callers are always static strings — never child
// process stderr, spawn error details, or anything else that could leak
// environment or auth data.
const ERRORS = {
  spawn: 'Codex telemetry process could not be started.',
  initialize: 'Codex telemetry failed to initialize.',
  protocol: 'Codex telemetry rate-limit request failed.',
  processError: 'Codex telemetry process reported an error.',
  processExit: 'Codex telemetry process exited unexpectedly.',
  timeout: 'Codex telemetry request timed out.',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A malformed or missing window normalizes to `null` rather than throwing. */
function normalizeWindow(raw: unknown): CodexRateLimitWindow | null {
  if (!isRecord(raw)) return null;
  const usedPercent = toFiniteOrNull(raw.usedPercent);
  if (usedPercent === null) return null;
  return {
    usedPercent,
    windowDurationMins: toFiniteOrNull(raw.windowDurationMins),
    resetsAt: toFiniteOrNull(raw.resetsAt),
  };
}

/** Prefers `rateLimitsByLimitId.codex`, falls back to the compatibility `rateLimits` shape. */
function pickWindowSource(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result)) return undefined;
  const byLimitId = result.rateLimitsByLimitId;
  if (isRecord(byLimitId) && isRecord(byLimitId.codex)) return byLimitId.codex;
  if (isRecord(result.rateLimits)) return result.rateLimits;
  return undefined;
}

function buildSnapshot(result: unknown, fetchedAt: number): CodexRateLimitsSnapshot {
  const source = pickWindowSource(result);
  return {
    provider: 'codex',
    fetchedAt,
    stale: false,
    primary: normalizeWindow(source?.primary),
    secondary: normalizeWindow(source?.secondary),
  };
}

export interface RequestCodexRateLimitsDeps {
  spawn?: typeof spawn;
  resolveBundledCodex?: typeof resolveBundledCodex;
  enrichedEnv?: typeof enrichedEnv;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  timeoutMs?: number;
  /** Invoked once the child process is spawned, so callers (the service) can kill it early. */
  onProcess?: (proc: ChildProcess) => void;
}

/** One-shot Codex `app-server` rate-limit read. Always terminates the child process before settling. */
export function requestCodexRateLimits(deps: RequestCodexRateLimitsDeps = {}): Promise<CodexRateLimitsSnapshot> {
  const spawnFn = deps.spawn ?? spawn;
  const resolveFn = deps.resolveBundledCodex ?? resolveBundledCodex;
  const envFn = deps.enrichedEnv ?? enrichedEnv;
  const now = deps.now ?? Date.now;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return new Promise<CodexRateLimitsSnapshot>((resolve, reject) => {
    let proc: ChildProcess;
    try {
      const bundled = resolveFn();
      const env = envFn();
      const pathKey = process.platform === 'win32'
        ? (Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path')
        : 'PATH';
      env[pathKey] = [...bundled.pathDirs, env[pathKey]].filter(Boolean).join(path.delimiter);
      // stderr is ignored, not piped: nothing ever consumes it here, and a
      // piped-but-unread stream can fill its OS pipe buffer and block the
      // child if it writes enough diagnostics.
      proc = spawnFn(bundled.executablePath, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    } catch {
      reject(new Error(ERRORS.spawn));
      return;
    }

    deps.onProcess?.(proc);

    let buffer = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function finish(outcome: { ok: true; snapshot: CodexRateLimitsSnapshot } | { ok: false; message: string }) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeoutFn(timer);
      proc.stdout?.off('data', onData);
      proc.off('error', onError);
      proc.off('exit', onExit);
      try { proc.kill(); } catch { /* already exited */ }
      if (outcome.ok) resolve(outcome.snapshot);
      else reject(new Error(outcome.message));
    }

    function write(msg: unknown) {
      try { proc.stdin?.write(`${JSON.stringify(msg)}\n`); } catch { /* pipe already closed */ }
    }

    function handleLine(rawLine: string) {
      const line = rawLine.trim();
      if (!line) return;
      let msg: unknown;
      try { msg = JSON.parse(line); } catch { return; /* tolerate non-JSON diagnostics */ }
      if (!isRecord(msg)) return;
      if (msg.id === 0) {
        if (msg.error) { finish({ ok: false, message: ERRORS.initialize }); return; }
        write({ jsonrpc: '2.0', method: 'initialized' });
        write({ jsonrpc: '2.0', method: 'account/rateLimits/read', id: 1 });
        return;
      }
      if (msg.id === 1) {
        if (msg.error) { finish({ ok: false, message: ERRORS.protocol }); return; }
        finish({ ok: true, snapshot: buildSnapshot(msg.result, now()) });
      }
    }

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) handleLine(rawLine);
    };
    const onError = () => finish({ ok: false, message: ERRORS.processError });
    // Unlike bundledModels' resolveBundledCodex flow, which flushes buffered
    // stdout on 'exit' because the child is expected to run-and-terminate,
    // this app-server session is long-lived for the whole handshake — it
    // should still be alive when the rate-limit response arrives. An 'exit'
    // here always means the process died before responding, so it's treated
    // as a failure rather than a flush point.
    const onExit = () => finish({ ok: false, message: ERRORS.processExit });

    timer = setTimeoutFn(() => finish({ ok: false, message: ERRORS.timeout }), timeoutMs);

    proc.stdout?.on('data', onData);
    proc.on('error', onError);
    proc.on('exit', onExit);

    write({ jsonrpc: '2.0', method: 'initialize', id: 0, params: { clientInfo: { name: 'sai', version: '1.0' } } });
  });
}

export type CodexTelemetryLoad = (registerCleanup: (cleanup: () => void) => void) => Promise<CodexRateLimitsSnapshot>;

export interface CodexTelemetryServiceDeps {
  load?: CodexTelemetryLoad;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Caches and coalesces `requestCodexRateLimits()` calls for renderer polling.
 *
 * A success is reused for `CACHE_TTL_MS`, then marked `stale` after
 * `STALE_AFTER_MS` if refreshes keep failing. Failures never propagate to
 * callers — they return the last success (recalculated stale) or `null`.
 */
export class CodexTelemetryService {
  private readonly loadFn: CodexTelemetryLoad;
  private readonly nowFn: () => number;

  private lastSuccess: CodexRateLimitsSnapshot | null = null;
  private inFlight: Promise<CodexRateLimitsSnapshot | null> | null = null;
  private failureCount = 0;
  private nextRetryAt = 0;
  private activeCleanup: (() => void) | null = null;
  // Bumped by destroy() so a still-settling attempt from before shutdown can't
  // mutate failureCount/nextRetryAt/lastSuccess after the instance was torn down.
  private generation = 0;

  constructor(deps: CodexTelemetryServiceDeps = {}) {
    this.nowFn = deps.now ?? Date.now;
    const setTimeoutFn = deps.setTimeoutFn;
    const clearTimeoutFn = deps.clearTimeoutFn;
    this.loadFn = deps.load ?? ((registerCleanup) => requestCodexRateLimits({
      now: this.nowFn,
      setTimeoutFn,
      clearTimeoutFn,
      onProcess: (proc) => registerCleanup(() => { try { proc.kill(); } catch { /* already exited */ } }),
    }));
  }

  private withStale(snapshot: CodexRateLimitsSnapshot, now: number): CodexRateLimitsSnapshot {
    return { ...snapshot, stale: now - snapshot.fetchedAt > STALE_AFTER_MS };
  }

  readRateLimits(options: { force?: boolean } = {}): Promise<CodexRateLimitsSnapshot | null> {
    if (this.inFlight) return this.inFlight;

    const now = this.nowFn();

    if (!options.force && this.lastSuccess && now - this.lastSuccess.fetchedAt < CACHE_TTL_MS) {
      return Promise.resolve(this.withStale(this.lastSuccess, now));
    }

    // `force` deliberately does NOT bypass failure backoff (only the success
    // cache above) — a failing Codex binary should not be re-spawned on every
    // forced post-turn refresh; backoff exists specifically to protect against
    // that hammering.
    if (now < this.nextRetryAt) {
      return Promise.resolve(this.lastSuccess ? this.withStale(this.lastSuccess, now) : null);
    }

    this.activeCleanup = null;
    const generation = this.generation;
    const attempt: Promise<CodexRateLimitsSnapshot | null> = this.loadFn((cleanup) => { this.activeCleanup = cleanup; })
      .then((snapshot) => {
        if (generation !== this.generation) return this.lastSuccess ? this.withStale(this.lastSuccess, this.nowFn()) : null;
        this.failureCount = 0;
        this.nextRetryAt = 0;
        const stamped: CodexRateLimitsSnapshot = { ...snapshot, fetchedAt: this.nowFn(), stale: false };
        this.lastSuccess = stamped;
        return stamped;
      })
      .catch(() => {
        if (generation !== this.generation) return this.lastSuccess ? this.withStale(this.lastSuccess, this.nowFn()) : null;
        this.failureCount += 1;
        const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.failureCount - 1));
        this.nextRetryAt = this.nowFn() + backoff;
        return this.lastSuccess ? this.withStale(this.lastSuccess, this.nowFn()) : null;
      })
      .finally(() => {
        if (generation === this.generation) {
          this.inFlight = null;
          this.activeCleanup = null;
        }
      });

    this.inFlight = attempt;
    return attempt;
  }

  /** Kills any active child, drops cached/in-flight state. Never rejects a caller already holding a promise. */
  destroy(): void {
    this.generation += 1;
    if (this.activeCleanup) {
      try { this.activeCleanup(); } catch { /* already gone */ }
      this.activeCleanup = null;
    }
    this.inFlight = null;
    this.lastSuccess = null;
    this.failureCount = 0;
    this.nextRetryAt = 0;
  }
}
