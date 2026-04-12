# Harden Rate Limit Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix inconsistent rate limit data by establishing clear precedence between the OAuth API poll (authoritative) and CLI `rate_limit_event` messages (supplementary), using `lastUpdated` timestamps.

**Architecture:** Add a `lastUpdated` field to the rate limit state entries in `ChatPanel.tsx`. The OAuth API handler always overwrites; the CLI event handler only updates `utilization` when existing data is stale (>60s). The `ChatInput.tsx` display dims stale entries (>120s without update).

**Tech Stack:** React, TypeScript, Vitest

---

### Task 1: Add `lastUpdated` to rate limit state type and OAuth handler

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx:486` (state declaration)
- Modify: `src/components/Chat/ChatPanel.tsx:827-862` (OAuth `usage:update` handler)

- [ ] **Step 1: Update the rate limit state type to include `lastUpdated`**

In `src/components/Chat/ChatPanel.tsx`, change line 486 from:

```typescript
const [rateLimits, setRateLimits] = useState<Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number }>>(new Map());
```

to:

```typescript
const [rateLimits, setRateLimits] = useState<Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number; lastUpdated: number }>>(new Map());
```

- [ ] **Step 2: Update the OAuth `usage:update` handler to set `lastUpdated`**

In the `handleUsage` callback (~line 827), update the `five_hour` block from:

```typescript
next.set('five_hour', {
  ...existing,
  utilization: (data.five_hour.utilization ?? 0) / 100,
  ...(data.five_hour.resets_at ? { resetsAt: Math.floor(new Date(data.five_hour.resets_at).getTime() / 1000) } : {}),
});
```

to:

```typescript
next.set('five_hour', {
  ...existing,
  utilization: (data.five_hour.utilization ?? 0) / 100,
  ...(data.five_hour.resets_at ? { resetsAt: Math.floor(new Date(data.five_hour.resets_at).getTime() / 1000) } : {}),
  lastUpdated: Date.now(),
});
```

Apply the same change to the `seven_day` block (~line 855):

```typescript
next.set('seven_day', {
  ...existing,
  utilization: (data.seven_day.utilization ?? 0) / 100,
  ...(data.seven_day.resets_at ? { resetsAt: Math.floor(new Date(data.seven_day.resets_at).getTime() / 1000) } : {}),
  lastUpdated: Date.now(),
});
```

- [ ] **Step 3: Verify the app still compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing errors may exist but no new type errors related to `lastUpdated`)

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat: add lastUpdated timestamp to rate limit state and OAuth handler"
```

---

### Task 2: Fix CLI `rate_limit_event` handler with staleness check

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx:633-649` (CLI event handler)

- [ ] **Step 1: Replace the CLI `rate_limit_event` handler**

In `src/components/Chat/ChatPanel.tsx`, replace lines 633-649:

```typescript
      // Capture rate limit info (may receive multiple: daily, weekly, etc.)
      if (msg.type === 'rate_limit_event' && msg.rate_limit_info) {
        const info = msg.rate_limit_info;
        const key = info.rateLimitType || 'unknown';
        setRateLimits(prev => {
          const next = new Map(prev);
          next.set(key, {
            rateLimitType: key,
            resetsAt: info.resetsAt || 0,
            status: info.status || 'unknown',
            isUsingOverage: !!info.isUsingOverage,
            overageResetsAt: info.overageResetsAt || 0,
            utilization: info.utilization,
          });
          return next;
        });
        return;
      }
```

with:

```typescript
      // Capture rate limit info (may receive multiple: daily, weekly, etc.)
      // CLI events are supplementary — only update utilization when the
      // authoritative OAuth API data is stale (>60 s) or absent.
      if (msg.type === 'rate_limit_event' && msg.rate_limit_info) {
        const info = msg.rate_limit_info;
        const key = info.rateLimitType || 'unknown';
        setRateLimits(prev => {
          const next = new Map(prev);
          const existing = next.get(key);
          const now = Date.now();

          const entry = {
            rateLimitType: key,
            resetsAt: info.resetsAt || existing?.resetsAt || 0,
            status: info.status || existing?.status || 'unknown',
            isUsingOverage: !!(info.isUsingOverage ?? existing?.isUsingOverage),
            overageResetsAt: info.overageResetsAt || existing?.overageResetsAt || 0,
            utilization: existing?.utilization,
            lastUpdated: existing?.lastUpdated || now,
          };

          // Only update utilization from CLI if no API data yet or API data is stale
          const apiDataStale = !existing?.lastUpdated || (now - existing.lastUpdated) > 60_000;
          if (info.utilization !== undefined && apiDataStale) {
            entry.utilization = info.utilization;
            entry.lastUpdated = now;
          }

          next.set(key, entry);
          return next;
        });
        return;
      }
```

- [ ] **Step 2: Verify the app still compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "fix: CLI rate_limit_event only updates utilization when API data is stale"
```

---

### Task 3: Update ChatInput props type and add stale indicator

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx:35` (props type)
- Modify: `src/components/Chat/ChatInput.tsx:881-891` (session limits rendering)
- Modify: `src/components/Chat/ChatInput.tsx:912-922` (weekly limits rendering)

- [ ] **Step 1: Update the `rateLimits` prop type to include `lastUpdated`**

In `src/components/Chat/ChatInput.tsx`, change line 35 from:

```typescript
  rateLimits?: Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number }>;
```

to:

```typescript
  rateLimits?: Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number; lastUpdated: number }>;
```

- [ ] **Step 2: Add stale dimming to session limit bars**

In `src/components/Chat/ChatInput.tsx`, update the session limits `.map()` block (~lines 881-891). Change:

```typescript
                      {sessionLimits.map(rl => {
                        const pct = getRateLimitProgress(rl) * 100;
                        return (
                          <UsageBar
                            key={rl.rateLimitType}
                            pct={pct}
                            color={pct >= 0 ? getBarColor(pct, false) : 'var(--text-muted)'}
                            label={getRateLimitLabel(rl.rateLimitType)}
                            sublabel={`Resets in ${formatResetTime(rl.resetsAt)}`}
                          />
                        );
                      })}
```

to:

```typescript
                      {sessionLimits.map(rl => {
                        const pct = getRateLimitProgress(rl) * 100;
                        const isStale = rl.lastUpdated && (Date.now() - rl.lastUpdated) > 120_000;
                        return (
                          <div key={rl.rateLimitType} style={isStale ? { opacity: 0.5 } : undefined}>
                            <UsageBar
                              pct={pct}
                              color={pct >= 0 ? getBarColor(pct, false) : 'var(--text-muted)'}
                              label={getRateLimitLabel(rl.rateLimitType)}
                              sublabel={isStale ? 'Data may be stale' : `Resets in ${formatResetTime(rl.resetsAt)}`}
                            />
                          </div>
                        );
                      })}
```

- [ ] **Step 3: Add stale dimming to weekly limit bars**

Update the weekly limits `.map()` block (~lines 912-922). Change:

```typescript
                      {weeklyLimits.map(rl => {
                        const pct = getRateLimitProgress(rl) * 100;
                        return (
                          <UsageBar
                            key={rl.rateLimitType}
                            pct={pct}
                            color={pct >= 0 ? getBarColor(pct, false) : 'var(--text-muted)'}
                            label={getRateLimitLabel(rl.rateLimitType)}
                            sublabel={`Resets ${formatResetTime(rl.resetsAt, 'absolute')}`}
                          />
                        );
                      })}
```

to:

```typescript
                      {weeklyLimits.map(rl => {
                        const pct = getRateLimitProgress(rl) * 100;
                        const isStale = rl.lastUpdated && (Date.now() - rl.lastUpdated) > 120_000;
                        return (
                          <div key={rl.rateLimitType} style={isStale ? { opacity: 0.5 } : undefined}>
                            <UsageBar
                              pct={pct}
                              color={pct >= 0 ? getBarColor(pct, false) : 'var(--text-muted)'}
                              label={getRateLimitLabel(rl.rateLimitType)}
                              sublabel={isStale ? 'Data may be stale' : `Resets ${formatResetTime(rl.resetsAt, 'absolute')}`}
                            />
                          </div>
                        );
                      })}
```

- [ ] **Step 4: Verify the app still compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat: dim stale rate limit bars when data is older than 2 minutes"
```

---

### Task 4: Add tests for rate limit reconciliation

**Files:**
- Create: `tests/unit/components/Chat/rateLimitReconciliation.test.ts`

- [ ] **Step 1: Write the reconciliation tests**

Create `tests/unit/components/Chat/rateLimitReconciliation.test.ts`:

```typescript
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
        lastUpdated: now - 30_000, // 30s ago — fresh
      };
      const result = applyCLIEvent(existing, {
        rateLimitType: 'five_hour',
        utilization: 0.50,
        resetsAt: 1000,
        status: 'ok',
      }, now);

      expect(result.utilization).toBe(0.45); // Preserved from API
      expect(result.lastUpdated).toBe(now - 30_000); // Not updated
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
        lastUpdated: now - 90_000, // 90s ago — stale
      };
      const result = applyCLIEvent(existing, {
        rateLimitType: 'five_hour',
        utilization: 0.55,
        resetsAt: 1000,
        status: 'ok',
      }, now);

      expect(result.utilization).toBe(0.55); // Updated from CLI
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
        lastUpdated: now - 10_000, // 10s ago — fresh
      };
      const result = applyCLIEvent(existing, {
        rateLimitType: 'five_hour',
        utilization: 0.50,
        resetsAt: 1500,
        status: 'warning',
        isUsingOverage: true,
        overageResetsAt: 2000,
      }, now);

      // Utilization NOT updated (fresh API data)
      expect(result.utilization).toBe(0.45);
      // Event-driven fields ARE updated
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
      // API poll arrives
      const afterApi = applyOAuthUpdate(undefined, { utilization: 40 }, t0);
      expect(afterApi.utilization).toBe(0.40);

      // CLI event arrives 5s later with different utilization
      const t1 = t0 + 5_000;
      const afterCli = applyCLIEvent(afterApi, {
        rateLimitType: 'five_hour',
        utilization: 0.50,
        status: 'ok',
      }, t1);

      // API data is fresh, CLI utilization ignored
      expect(afterCli.utilization).toBe(0.40);
    });

    it('API sets data, CLI event after 90s does overwrite', () => {
      const t0 = 1000000;
      const afterApi = applyOAuthUpdate(undefined, { utilization: 40 }, t0);

      // CLI event arrives 90s later
      const t1 = t0 + 90_000;
      const afterCli = applyCLIEvent(afterApi, {
        rateLimitType: 'five_hour',
        utilization: 0.60,
        status: 'ok',
      }, t1);

      // API data is stale, CLI utilization accepted
      expect(afterCli.utilization).toBe(0.60);
      expect(afterCli.lastUpdated).toBe(t1);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/unit/components/Chat/rateLimitReconciliation.test.ts`
Expected: All 9 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/Chat/rateLimitReconciliation.test.ts
git commit -m "test: add rate limit reconciliation unit tests"
```

---

### Task 5: Run full test suite and verify no regressions

**Files:** None (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run --project unit`
Expected: All existing tests pass, no regressions

- [ ] **Step 2: Run the integration test suite**

Run: `npx vitest run --project integration`
Expected: All existing tests pass

- [ ] **Step 3: Build the app to verify no compile errors**

Run: `npm run build 2>&1 | tail -10`
Expected: Build completes successfully
