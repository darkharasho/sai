/**
 * Unit tests for rate limit reconciliation logic.
 *
 * Tests the precedence rules:
 * - OAuth API poll is authoritative (always updates utilization + lastUpdated)
 * - CLI rate_limit_event only updates utilization when API data is stale (>60s)
 * - CLI always updates event-driven fields (resetsAt, status, isUsingOverage)
 */
import { describe, it, expect } from 'vitest';

type RateLimitEntry = {
  rateLimitType: string;
  resetsAt: number;
  status: string;
  isUsingOverage: boolean;
  overageResetsAt: number;
  utilization?: number;
  lastUpdated: number;
};

/**
 * Simulates the OAuth API handler logic from ChatPanel.tsx.
 * Always overwrites utilization and sets lastUpdated.
 */
function applyOAuthUpdate(
  existing: RateLimitEntry | undefined,
  data: { utilization?: number; resets_at?: string },
  now: number,
): RateLimitEntry {
  const base = existing || {
    rateLimitType: 'five_hour',
    resetsAt: 0,
    status: 'unknown',
    isUsingOverage: false,
    overageResetsAt: 0,
    utilization: undefined,
    lastUpdated: 0,
  };
  return {
    ...base,
    utilization: (data.utilization ?? 0) / 100,
    ...(data.resets_at ? { resetsAt: Math.floor(new Date(data.resets_at).getTime() / 1000) } : {}),
    lastUpdated: now,
  };
}

/**
 * Simulates the CLI rate_limit_event handler logic from ChatPanel.tsx.
 * Only updates utilization when API data is stale (>60s) or absent.
 */
function applyCLIEvent(
  existing: RateLimitEntry | undefined,
  info: { rateLimitType?: string; resetsAt?: number; status?: string; isUsingOverage?: boolean; overageResetsAt?: number; utilization?: number },
  now: number,
): RateLimitEntry {
  const key = info.rateLimitType || 'unknown';
  const entry: RateLimitEntry = {
    rateLimitType: key,
    resetsAt: info.resetsAt || existing?.resetsAt || 0,
    status: info.status || existing?.status || 'unknown',
    isUsingOverage: !!(info.isUsingOverage ?? existing?.isUsingOverage),
    overageResetsAt: info.overageResetsAt || existing?.overageResetsAt || 0,
    utilization: existing?.utilization,
    lastUpdated: existing?.lastUpdated || now,
  };

  const apiDataStale = !existing?.lastUpdated || (now - existing.lastUpdated) > 60_000;
  if (info.utilization !== undefined && apiDataStale) {
    entry.utilization = info.utilization;
    entry.lastUpdated = now;
  }

  return entry;
}

describe('Rate limit reconciliation', () => {
  describe('OAuth API handler (authoritative)', () => {
    it('creates a new entry with utilization and lastUpdated', () => {
      const now = 1000000;
      const result = applyOAuthUpdate(undefined, { utilization: 45 }, now);

      expect(result.utilization).toBe(0.45);
      expect(result.lastUpdated).toBe(now);
    });

    it('overwrites existing utilization from a CLI event', () => {
      const existing: RateLimitEntry = {
        rateLimitType: 'five_hour',
        resetsAt: 999,
        status: 'ok',
        isUsingOverage: false,
        overageResetsAt: 0,
        utilization: 0.30,
        lastUpdated: 500000,
      };
      const now = 1000000;
      const result = applyOAuthUpdate(existing, { utilization: 55 }, now);

      expect(result.utilization).toBe(0.55);
      expect(result.lastUpdated).toBe(now);
    });

    it('updates resetsAt when provided', () => {
      const now = 1000000;
      const resetDate = '2026-04-12T18:00:00Z';
      const result = applyOAuthUpdate(undefined, { utilization: 10, resets_at: resetDate }, now);

      expect(result.resetsAt).toBe(Math.floor(new Date(resetDate).getTime() / 1000));
    });

    it('preserves existing resetsAt when not provided in API response', () => {
      const existing: RateLimitEntry = {
        rateLimitType: 'five_hour',
        resetsAt: 12345,
        status: 'ok',
        isUsingOverage: false,
        overageResetsAt: 0,
        utilization: 0.20,
        lastUpdated: 500000,
      };
      const now = 1000000;
      const result = applyOAuthUpdate(existing, { utilization: 25 }, now);

      expect(result.resetsAt).toBe(12345);
    });
  });

  describe('CLI rate_limit_event handler (supplementary)', () => {
    it('updates utilization when no prior data exists', () => {
      const now = 1000000;
      const result = applyCLIEvent(undefined, {
        rateLimitType: 'five_hour',
        utilization: 0.40,
        resetsAt: 999,
        status: 'ok',
      }, now);

      expect(result.utilization).toBe(0.40);
      expect(result.lastUpdated).toBe(now);
    });

    it('does NOT update utilization when API data is fresh (<60s)', () => {
      const now = 1000000;
      const existing: RateLimitEntry = {
        rateLimitType: 'five_hour',
        resetsAt: 999,
        status: 'ok',
        isUsingOverage: false,
        overageResetsAt: 0,
        utilization: 0.45,
        lastUpdated: now - 30_000,
      };
      const result = applyCLIEvent(existing, {
        rateLimitType: 'five_hour',
        utilization: 0.50,
        resetsAt: 1000,
        status: 'ok',
      }, now);

      expect(result.utilization).toBe(0.45);
      expect(result.lastUpdated).toBe(now - 30_000);
    });

    it('updates utilization when API data is stale (>60s)', () => {
      const now = 1000000;
      const existing: RateLimitEntry = {
        rateLimitType: 'five_hour',
        resetsAt: 999,
        status: 'ok',
        isUsingOverage: false,
        overageResetsAt: 0,
        utilization: 0.45,
        lastUpdated: now - 90_000,
      };
      const result = applyCLIEvent(existing, {
        rateLimitType: 'five_hour',
        utilization: 0.55,
        resetsAt: 1000,
        status: 'ok',
      }, now);

      expect(result.utilization).toBe(0.55);
      expect(result.lastUpdated).toBe(now);
    });

    it('always updates event-driven fields regardless of staleness', () => {
      const now = 1000000;
      const existing: RateLimitEntry = {
        rateLimitType: 'five_hour',
        resetsAt: 999,
        status: 'ok',
        isUsingOverage: false,
        overageResetsAt: 0,
        utilization: 0.45,
        lastUpdated: now - 10_000,
      };
      const result = applyCLIEvent(existing, {
        rateLimitType: 'five_hour',
        utilization: 0.50,
        resetsAt: 1500,
        status: 'warning',
        isUsingOverage: true,
        overageResetsAt: 2000,
      }, now);

      expect(result.utilization).toBe(0.45);
      expect(result.resetsAt).toBe(1500);
      expect(result.status).toBe('warning');
      expect(result.isUsingOverage).toBe(true);
      expect(result.overageResetsAt).toBe(2000);
    });

    it('preserves existing values when CLI event fields are missing', () => {
      const now = 1000000;
      const existing: RateLimitEntry = {
        rateLimitType: 'five_hour',
        resetsAt: 999,
        status: 'ok',
        isUsingOverage: true,
        overageResetsAt: 1500,
        utilization: 0.45,
        lastUpdated: now - 10_000,
      };
      const result = applyCLIEvent(existing, {
        rateLimitType: 'five_hour',
      }, now);

      expect(result.resetsAt).toBe(999);
      expect(result.status).toBe('ok');
      expect(result.isUsingOverage).toBe(true);
      expect(result.overageResetsAt).toBe(1500);
      expect(result.utilization).toBe(0.45);
    });
  });

  describe('OAuth then CLI sequence', () => {
    it('API sets data, immediate CLI event does not overwrite', () => {
      const t0 = 1000000;
      const afterApi = applyOAuthUpdate(undefined, { utilization: 40 }, t0);
      expect(afterApi.utilization).toBe(0.40);

      const t1 = t0 + 5_000;
      const afterCli = applyCLIEvent(afterApi, {
        rateLimitType: 'five_hour',
        utilization: 0.50,
        status: 'ok',
      }, t1);

      expect(afterCli.utilization).toBe(0.40);
    });

    it('API sets data, CLI event after 90s does overwrite', () => {
      const t0 = 1000000;
      const afterApi = applyOAuthUpdate(undefined, { utilization: 40 }, t0);

      const t1 = t0 + 90_000;
      const afterCli = applyCLIEvent(afterApi, {
        rateLimitType: 'five_hour',
        utilization: 0.60,
        status: 'ok',
      }, t1);

      expect(afterCli.utilization).toBe(0.60);
      expect(afterCli.lastUpdated).toBe(t1);
    });
  });
});
