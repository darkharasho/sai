const DEFAULT_MS = 180_000;
const MIN_MS = 10_000;
const MAX_MS = 600_000;

/** Clamp a render_form `timeoutMs` input to a sane range; default 3 min. */
export function formTimeoutMs(input: unknown): number {
  const raw = input && typeof input === 'object' ? (input as { timeoutMs?: unknown }).timeoutMs : undefined;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, n));
}
