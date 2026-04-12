# Harden Rate Limit Tracking

## Problem

SAI tracks Claude rate limits (5-hour and 7-day) from two sources that can conflict:

1. **CLI `rate_limit_event` messages** — emitted by the Claude CLI process. Sporadic and inconsistent; only fire on certain events, not on a regular cadence.
2. **Anthropic OAuth API polling** (`electron/services/usage.ts`) — polls `/api/oauth/usage` every 60 seconds. Returns `utilization` (0-100) and `resets_at` for each limit type.

Both sources write into the same `rateLimits` state map in `ChatPanel.tsx` with no coordination. A stale CLI event can overwrite a fresh API poll value, or vice versa, leading to inconsistent utilization percentages in the UI.

## Solution

Add a `lastUpdated` timestamp to each rate limit entry and establish clear precedence rules between the two data sources.

## Changes

### 1. Extend rate limit state type

Add `lastUpdated` field to track when each entry was last written:

```typescript
// In ChatPanel.tsx rate limit state
type RateLimitEntry = {
  rateLimitType: string;
  resetsAt: number;
  status: string;
  isUsingOverage: boolean;
  overageResetsAt: number;
  utilization?: number;
  lastUpdated: number; // Date.now() when this entry was last updated
};
```

### 2. OAuth API poll handler (authoritative source)

In the `usage:update` handler (~line 827), always overwrite the entry and set `lastUpdated`:

```typescript
// OAuth API is authoritative — always update
next.set('five_hour', {
  ...existing,
  utilization: (data.five_hour.utilization ?? 0) / 100,
  ...(data.five_hour.resets_at
    ? { resetsAt: Math.floor(new Date(data.five_hour.resets_at).getTime() / 1000) }
    : {}),
  lastUpdated: Date.now(),
});
```

Same pattern for `seven_day`.

### 3. CLI `rate_limit_event` handler (supplementary source)

In the message handler (~line 633), only update `utilization` if the existing entry has no `lastUpdated` or the CLI event is fresher. Always update event-driven fields (`resetsAt`, `status`, `isUsingOverage`) since those reflect real-time state changes:

```typescript
if (msg.type === 'rate_limit_event' && msg.rate_limit_info) {
  const info = msg.rate_limit_info;
  const key = info.rateLimitType || 'unknown';
  setRateLimits(prev => {
    const next = new Map(prev);
    const existing = next.get(key);
    const now = Date.now();

    // Event-driven fields always update
    const entry: RateLimitEntry = {
      rateLimitType: key,
      resetsAt: info.resetsAt || existing?.resetsAt || 0,
      status: info.status || existing?.status || 'unknown',
      isUsingOverage: !!(info.isUsingOverage ?? existing?.isUsingOverage),
      overageResetsAt: info.overageResetsAt || existing?.overageResetsAt || 0,
      // Preserve existing utilization if it's fresher (from API poll)
      utilization: existing?.utilization,
      lastUpdated: existing?.lastUpdated || now,
    };

    // Only update utilization from CLI if we have no API data yet,
    // or if the existing data is older than one poll interval (60s)
    const apiDataStale = !existing?.lastUpdated
      || (now - existing.lastUpdated) > 60_000;

    if (info.utilization !== undefined && apiDataStale) {
      entry.utilization = info.utilization;
      entry.lastUpdated = now;
    }

    next.set(key, entry);
    return next;
  });
}
```

### 4. Stale data indicator

In `ChatInput.tsx`, when rendering rate limit bars, check if `lastUpdated` is older than 2 minutes. If so, apply reduced opacity to signal stale data:

```typescript
const isStale = entry.lastUpdated && (Date.now() - entry.lastUpdated) > 120_000;
// Apply opacity: 0.5 to the usage bar/text when stale
```

## Files affected

| File | Change |
|------|--------|
| `src/components/Chat/ChatPanel.tsx` | Update rate limit state type, fix CLI event handler, fix OAuth handler |
| `src/components/Chat/ChatInput.tsx` | Add stale data dimming to rate limit display |

## Out of scope

- New UI elements (chips, metrics rows)
- New settings toggles
- Session duration, output speed, or other new metrics
- Any claude-hud dependency or integration
