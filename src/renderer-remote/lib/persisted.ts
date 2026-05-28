/**
 * Versioned, validated localStorage helpers.
 *
 * Every value is stored as { v: <schemaVersion>, d: <payload> }. Reads run the
 * payload through a caller-provided validator; anything that fails parsing,
 * shape-checking, or version-matching is dropped (returning the fallback)
 * instead of being handed back as garbage to the caller.
 *
 * Writes return a boolean so callers can react to quota/private-mode failures
 * instead of failing silently. Use `removePersisted` to clear values that no
 * longer parse — never trust a thrown JSON error to leave the slot empty.
 */

interface Envelope<T> { v: number; d: T }

function isAvailable(): boolean {
  try {
    const k = '__sai_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

export function readPersisted<T>(
  key: string,
  version: number,
  validate: (raw: unknown) => T | null,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      localStorage.removeItem(key);
      return fallback;
    }
    const env = parsed as Partial<Envelope<unknown>>;
    if (env.v !== version) {
      // Schema drift. Drop rather than risk feeding stale shapes downstream.
      localStorage.removeItem(key);
      return fallback;
    }
    const ok = validate(env.d);
    if (ok == null) {
      localStorage.removeItem(key);
      return fallback;
    }
    return ok;
  } catch {
    try { localStorage.removeItem(key); } catch { /* nothing we can do */ }
    return fallback;
  }
}

export function writePersisted<T>(key: string, version: number, value: T): boolean {
  if (!isAvailable()) return false;
  try {
    const env: Envelope<T> = { v: version, d: value };
    localStorage.setItem(key, JSON.stringify(env));
    return true;
  } catch {
    return false;
  }
}

export function removePersisted(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function isString(v: unknown): v is string {
  return typeof v === 'string';
}
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
