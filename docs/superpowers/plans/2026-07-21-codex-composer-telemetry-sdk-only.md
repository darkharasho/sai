# Codex Composer Telemetry and SDK-Only Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Codex the same under-composer context, plan-usage, and task-progress visibility as Claude, make the SDK SAI's only Codex conversation backend, and repair Codex workspace classification in the desktop picker.

**Architecture:** Keep `@openai/codex-sdk` as the only conversation path and add a short-lived `codex app-server` sidecar solely for read-only account rate-limit telemetry. Normalize provider data into shared composer view models, enrich Codex models from the local model catalog, and make `SdkCodexBackend` register every started or messaged project with the authoritative workspace registry.

**Tech Stack:** Electron 36, TypeScript 5.7, React 19, Vitest 4, `@openai/codex-sdk` 0.144.6, Codex app-server JSON-RPC over stdio

---

## Scope and design source

Implement the approved [Codex composer telemetry and SDK-only design](../specs/2026-07-21-codex-composer-telemetry-sdk-only-design.md). This is one coordinated cleanup because the composer data, SDK lifecycle, and removal of the rollback transport all converge on one supported Codex runtime. Do not expand it into app-server conversations, Codex compaction, account lifetime usage, reset-credit redemption, mobile picker work, or a broad provider-event refactor.

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/composerTelemetry.ts` | Create | Provider-neutral context/limit view types and pure Codex/Claude adapters |
| `tests/unit/lib/composerTelemetry.test.ts` | Create | Context accounting, stale state, and rate-limit adapter tests |
| `src/types.ts` | Modify | Add effective Codex context-window metadata |
| `electron/services/codexBackend/types.ts` | Modify | Mirror model metadata and remove transport-selection types |
| `electron/services/codexBackend/bundledModels.ts` | Modify | Parse the local Codex model catalog and enrich app-server model results |
| `tests/unit/electron/codexBundledModels.test.ts` | Modify | Effective-window parsing and enrichment tests |
| `electron/services/codexTelemetry.ts` | Create | Short-lived app-server request plus cache/coalescing/backoff service |
| `tests/unit/electron/codexTelemetry.test.ts` | Create | Protocol ordering, normalization, cache, stale, timeout, and cleanup tests |
| `electron/services/codex.ts` | Modify | Register Codex telemetry IPC alongside existing SDK chat IPC |
| `electron/preload.ts` | Modify | Expose provider-tagged Codex telemetry reads to the renderer |
| `electron/main.ts` | Modify | Destroy telemetry and the SDK backend on app shutdown |
| `tests/unit/preload.test.ts` | Modify | Verify the new telemetry bridge and provider tag |
| `electron/services/codexBackend/sdkEventMap.ts` | Modify | Normalize SDK todo-list snapshots on started and updated events |
| `tests/unit/electron/codexSdkEventMap.test.ts` | Modify | Todo normalization, advancement, malformed input, and idempotence tests |
| `tests/unit/components/Chat/TodoProgress.test.tsx` | Modify | Verify normalized Codex tasks advance and disappear when complete |
| `electron/services/codexBackend/sdkBackend.ts` | Modify | Register/reactivate Codex projects in the workspace registry |
| `tests/unit/electron/codexSdkBackend.test.ts` | Modify | Workspace registration and isolation tests |
| `electron/services/codexBackend/index.ts` | Modify | Construct one SDK-only backend singleton |
| `electron/services/codexBackend/cliBackend.ts` | Delete | Remove SAI's direct CLI conversation transport |
| `tests/unit/services/codex.test.ts` | Delete | Remove rollback-transport-only tests |
| `tests/unit/electron/codexBackendDispatch.test.ts` | Modify | Assert SDK-only selection, hooks, and IPC delegation |
| `src/components/SettingsModal.tsx` | Modify | Remove Codex transport selector and synchronization |
| `tests/unit/components/SettingsModal.test.tsx` | Modify | Assert the removed setting is never read, rendered, or written |
| `src/components/Chat/ChatInput.tsx` | Modify | Render shared context/usage views by availability, with read-only Codex ring |
| `tests/unit/components/Chat/ChatInput.test.tsx` | Modify | Codex/Claude context and usage presentation tests |
| `src/components/Chat/ChatPanel.tsx` | Modify | Provider-correct usage accounting, context totals, polling, and state isolation |
| `tests/unit/components/Chat/ChatPanel.test.tsx` | Modify | Provider switching, session reset, post-turn refresh, and no-fake-window tests |
| `tests/unit/components/TitleBar.test.tsx` | Modify | Preserve Active/Suspended/Recent rendering from registry state |

---

### Task 1: Define and test provider-neutral composer telemetry

**Files:**
- Create: `src/lib/composerTelemetry.ts`
- Create: `tests/unit/lib/composerTelemetry.test.ts`

- [ ] **Step 1: Write failing tests for Codex accounting and shared limit views**

Create `tests/unit/lib/composerTelemetry.test.ts` with these cases:

```typescript
import { describe, expect, it } from 'vitest';
import {
  contextUsageFromCodex,
  codexRateLimitsToViews,
  claudeRateLimitsToViews,
  resolveEffectiveContextWindow,
} from '../../../src/lib/composerTelemetry';

describe('contextUsageFromCodex', () => {
  it('does not add cached input a second time and retains reasoning output', () => {
    expect(contextUsageFromCodex({
      input_tokens: 1_000,
      cached_input_tokens: 700,
      output_tokens: 250,
      reasoning_output_tokens: 100,
    }, 8_000)).toEqual({
      used: 1_250,
      total: 8_000,
      inputTokens: 1_000,
      cachedInputTokens: 700,
      cacheCreationTokens: 0,
      outputTokens: 250,
      reasoningOutputTokens: 100,
    });
  });

  it('returns token detail without a percentage denominator when the model window is unknown', () => {
    expect(contextUsageFromCodex({ input_tokens: 50, output_tokens: 10 }, undefined)).toMatchObject({
      used: 60,
      total: null,
    });
  });

  it('prefers an explicit smaller runtime context limit', () => {
    expect(resolveEffectiveContextWindow(258_400, 200_000)).toBe(200_000);
    expect(resolveEffectiveContextWindow(258_400, 300_000)).toBe(258_400);
    expect(resolveEffectiveContextWindow(undefined, undefined)).toBeUndefined();
  });
});

describe('usage limit adapters', () => {
  it('maps Codex primary and secondary windows into session and weekly groups', () => {
    expect(codexRateLimitsToViews({
      provider: 'codex',
      fetchedAt: 1_000,
      stale: false,
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 2_000 },
      secondary: { usedPercent: 73, windowDurationMins: 10_080, resetsAt: 3_000 },
    })).toEqual([
      { id: 'codex-primary', label: 'Current session', group: 'session', usedPercent: 42, resetsAt: 2_000, windowDurationMins: 300, updatedAt: 1_000, stale: false },
      { id: 'codex-secondary', label: 'All models', group: 'weekly', usedPercent: 73, resetsAt: 3_000, windowDurationMins: 10_080, updatedAt: 1_000, stale: false },
    ]);
  });

  it('preserves Claude labels, utilization, grouping, and overage metadata', () => {
    const limits = new Map([['five_hour', {
      rateLimitType: 'five_hour', resetsAt: 99, status: 'allowed',
      isUsingOverage: false, overageResetsAt: 0, utilization: 0.25, lastUpdated: 10,
    }]]);
    expect(claudeRateLimitsToViews(limits)[0]).toMatchObject({
      id: 'five_hour', label: 'Current session', group: 'session', usedPercent: 25,
      resetsAt: 99, updatedAt: 10, isUsingOverage: false,
    });
  });
});
```

- [ ] **Step 2: Run the new test and verify the module is missing**

Run:

```bash
npx vitest run --project unit tests/unit/lib/composerTelemetry.test.ts
```

Expected: FAIL because `src/lib/composerTelemetry.ts` does not exist.

- [ ] **Step 3: Implement the shared types and pure adapters**

Create `src/lib/composerTelemetry.ts` with these exported contracts and rules:

```typescript
export interface ContextUsageView {
  used: number;
  total: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningOutputTokens?: number;
}

export interface UsageLimitView {
  id: string;
  label: string;
  group: 'session' | 'weekly';
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
  updatedAt: number;
  stale: boolean;
  status?: string;
  isUsingOverage?: boolean;
  overageResetsAt?: number;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimitsSnapshot {
  provider: 'codex';
  fetchedAt: number;
  stale: boolean;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
}

export function contextUsageFromCodex(usage: Record<string, unknown>, total?: number): ContextUsageView {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  const inputTokens = number(usage.input_tokens);
  const cachedInputTokens = number(usage.cached_input_tokens ?? usage.cache_read_input_tokens);
  const outputTokens = number(usage.output_tokens);
  const reasoningOutputTokens = number(usage.reasoning_output_tokens);
  return {
    used: inputTokens + outputTokens,
    total: typeof total === 'number' && total > 0 ? total : null,
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens: 0,
    outputTokens,
    ...(reasoningOutputTokens > 0 ? { reasoningOutputTokens } : {}),
  };
}

export function resolveEffectiveContextWindow(...candidates: Array<number | undefined>): number | undefined {
  const valid = candidates.filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0);
  return valid.length ? Math.min(...valid) : undefined;
}
```

Implement the adapters in the same module. Move the existing Claude labels into the provider-neutral adapter instead of duplicating them in `ChatInput`:

```typescript
const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const CLAUDE_LABELS: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'All models',
  seven_day_opus: 'Opus only',
  seven_day_sonnet: 'Sonnet only',
  seven_day_oauth_apps: 'OAuth apps',
};

export function codexRateLimitsToViews(snapshot: CodexRateLimitsSnapshot): UsageLimitView[] {
  return ([
    ['primary', snapshot.primary, 'Current session', 'session'],
    ['secondary', snapshot.secondary, 'All models', 'weekly'],
  ] as const).flatMap(([id, window, label, group]) => window ? [{
    id: `codex-${id}`,
    label,
    group,
    usedPercent: clampPercent(window.usedPercent),
    resetsAt: window.resetsAt,
    windowDurationMins: window.windowDurationMins,
    updatedAt: snapshot.fetchedAt,
    stale: snapshot.stale,
  }] : []);
}

export interface ClaudeRateLimitRecord {
  rateLimitType: string;
  resetsAt: number;
  status: string;
  isUsingOverage: boolean;
  overageResetsAt: number;
  utilization?: number;
  lastUpdated: number;
}

export function claudeRateLimitsToViews(
  limits: Map<string, ClaudeRateLimitRecord>,
  now = Date.now(),
): UsageLimitView[] {
  return [...limits.values()].flatMap((limit) => typeof limit.utilization === 'number' ? [{
    id: limit.rateLimitType,
    label: CLAUDE_LABELS[limit.rateLimitType] ?? limit.rateLimitType,
    group: limit.rateLimitType.startsWith('seven_day') ? 'weekly' as const : 'session' as const,
    usedPercent: clampPercent(limit.utilization * 100),
    resetsAt: limit.resetsAt || null,
    windowDurationMins: null,
    updatedAt: limit.lastUpdated,
    stale: now - limit.lastUpdated > 120_000,
    status: limit.status,
    isUsingOverage: limit.isUsingOverage,
    overageResetsAt: limit.overageResetsAt,
  }] : []);
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run --project unit tests/unit/lib/composerTelemetry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the view-model boundary**

```bash
git add src/lib/composerTelemetry.ts tests/unit/lib/composerTelemetry.test.ts
git commit -m "feat(codex): define composer telemetry views"
```

---

### Task 2: Enrich Codex models with effective context windows

**Files:**
- Modify: `src/types.ts`
- Modify: `electron/services/codexBackend/types.ts`
- Modify: `electron/services/codexBackend/bundledModels.ts`
- Modify: `tests/unit/electron/codexBundledModels.test.ts`

- [ ] **Step 1: Add failing parser and enrichment tests**

Extend `tests/unit/electron/codexBundledModels.test.ts`:

```typescript
import {
  parseCodexModelContextWindows,
  enrichCodexModelsWithContext,
} from '../../../electron/services/codexBackend/bundledModels';

it('calculates the effective context window from the local model catalog', () => {
  const windows = parseCodexModelContextWindows(JSON.stringify([
    { slug: 'gpt-5-codex', context_window: 272_000, effective_context_window_percent: 95 },
    { slug: 'broken', context_window: -1, effective_context_window_percent: 95 },
  ]));
  expect(windows.get('gpt-5-codex')).toBe(258_400);
  expect(windows.has('broken')).toBe(false);
});

it('enriches known models and leaves unknown models unset', () => {
  expect(enrichCodexModelsWithContext([
    { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
    { id: 'unknown', name: 'Unknown' },
  ], new Map([['gpt-5-codex', 258_400]]))).toEqual([
    { id: 'gpt-5-codex', name: 'GPT-5 Codex', effectiveContextWindow: 258_400 },
    { id: 'unknown', name: 'Unknown' },
  ]);
});
```

- [ ] **Step 2: Verify the new exports do not exist**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexBundledModels.test.ts
```

Expected: FAIL with missing export errors.

- [ ] **Step 3: Add the model field and pure catalog helpers**

Add this optional field to `CodexModelOption` in both `src/types.ts` and `electron/services/codexBackend/types.ts`:

```typescript
effectiveContextWindow?: number;
```

In `electron/services/codexBackend/bundledModels.ts`, export:

```typescript
export function parseCodexModelContextWindows(raw: string): Map<string, number> {
  const result = new Map<string, number>();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return result; }
  if (!Array.isArray(parsed)) return result;
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const model = entry as Record<string, unknown>;
    const slug = typeof model.slug === 'string' ? model.slug : '';
    const window = typeof model.context_window === 'number' ? model.context_window : 0;
    const percent = typeof model.effective_context_window_percent === 'number'
      ? model.effective_context_window_percent : 100;
    if (!slug || window <= 0 || percent <= 0 || percent > 100) continue;
    result.set(slug, Math.floor(window * percent / 100));
  }
  return result;
}

export function enrichCodexModelsWithContext(
  models: CodexModelOption[],
  catalog: Map<string, number>,
): CodexModelOption[] {
  return models.map((model) => {
    const effectiveContextWindow = catalog.get(model.id);
    return effectiveContextWindow
      ? { ...model, effectiveContextWindow }
      : model;
  });
}
```

Add a focused `readCodexModelCatalog()` helper that reads `fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json'), 'utf8')` and returns an empty map on any read/parse error. In `fetchBundledCodexModels`, call it once per refresh and enrich the normalized `model/list` result before caching. Catalog errors must return models without `effectiveContextWindow`, never fail discovery.

- [ ] **Step 4: Run model tests and type-check**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexBundledModels.test.ts
npx tsc --noEmit
```

Expected: both commands PASS.

- [ ] **Step 5: Commit model-window discovery**

```bash
git add src/types.ts electron/services/codexBackend/types.ts electron/services/codexBackend/bundledModels.ts tests/unit/electron/codexBundledModels.test.ts
git commit -m "feat(codex): expose effective context windows"
```

---

### Task 3: Build the read-only Codex rate-limit telemetry service

**Files:**
- Create: `electron/services/codexTelemetry.ts`
- Create: `tests/unit/electron/codexTelemetry.test.ts`

- [ ] **Step 1: Write failing protocol and normalization tests**

Create `tests/unit/electron/codexTelemetry.test.ts` with a fake child process exposing `stdin.write`, `stdout.emit`, `kill`, and `on`. Assert that `requestCodexRateLimits()`:

```typescript
expect(JSON.parse(writes[0])).toMatchObject({ method: 'initialize', id: 0 });
stdout.emit('data', Buffer.from(JSON.stringify({ id: 0, result: {} }) + '\n'));
expect(JSON.parse(writes[1])).toEqual({ jsonrpc: '2.0', method: 'initialized' });
expect(JSON.parse(writes[2])).toMatchObject({ method: 'account/rateLimits/read', id: 1 });

stdout.emit('data', Buffer.from(JSON.stringify({
  id: 1,
  result: {
    rateLimits: { primary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 10 } },
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 20 },
        secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 30 },
      },
    },
  },
}) + '\n'));

await expect(promise).resolves.toMatchObject({
  provider: 'codex',
  primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 20 },
  secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 30 },
});
expect(kill).toHaveBeenCalledOnce();
```

Add separate cases for fallback to `result.rateLimits`, malformed windows becoming `null`, process error, protocol error, and timeout. Every settlement path must call `kill()` and error messages exposed by the promise must not include environment or auth data.

- [ ] **Step 2: Write failing cache/coalescing/backoff tests**

In the same file, inject `load`, `now`, and timers into `CodexTelemetryService` and assert:

```typescript
const first = service.readRateLimits();
const second = service.readRateLimits();
expect(load).toHaveBeenCalledOnce();
expect(first).toBe(second);

await first;
now = 29_999;
await service.readRateLimits();
expect(load).toHaveBeenCalledOnce();

now = 31_000;
await service.readRateLimits();
expect(load).toHaveBeenCalledTimes(2);
```

Then reject the next load and assert the last successful snapshot remains returned with `stale: false` before 120 seconds and `stale: true` after 120 seconds. Assert retries are suppressed during `min(60_000, 5_000 * 2 ** (failures - 1))` backoff, while `force: true` bypasses the 30-second success cache but not an in-flight call.

- [ ] **Step 3: Verify the service is absent**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexTelemetry.test.ts
```

Expected: FAIL because `electron/services/codexTelemetry.ts` does not exist.

- [ ] **Step 4: Implement the one-shot protocol request**

Create `electron/services/codexTelemetry.ts`. Export `requestCodexRateLimits(deps?)` and `CodexTelemetryService`. The request must use this sequence:

```typescript
write({ jsonrpc: '2.0', method: 'initialize', id: 0, params: {
  clientInfo: { name: 'sai', version: '1.0' },
} });

// after successful response id 0
write({ jsonrpc: '2.0', method: 'initialized' });
write({ jsonrpc: '2.0', method: 'account/rateLimits/read', id: 1 });
```

Resolve the executable with `resolveBundledCodex()`, build the PATH exactly as `fetchBundledCodexModels()` does, spawn with `['app-server']`, `shell: false`, and a 10-second timeout. Parse stdout line-by-line. Prefer `result.rateLimitsByLimitId.codex`, fall back to `result.rateLimits`, and normalize only finite percentages/durations/timestamps. Use a single `finish()` function that clears the timer, removes listeners, kills the child, and settles once.

- [ ] **Step 5: Implement cache, in-flight sharing, stale state, and bounded backoff**

Use these fixed constants and public signature:

```typescript
const CACHE_TTL_MS = 30_000;
const STALE_AFTER_MS = 120_000;
const MAX_BACKOFF_MS = 60_000;

export class CodexTelemetryService {
  readRateLimits(options: { force?: boolean } = {}): Promise<CodexRateLimitsSnapshot | null>;
  destroy(): void;
}
```

Store `lastSuccess`, `inFlight`, `failureCount`, `nextRetryAt`, and the currently spawned cleanup callback. A success resets failures and stamps `fetchedAt`; a failure returns the last success with recalculated stale state, or `null`. `destroy()` must terminate an active child and clear cached/in-flight state without rejecting renderer callers during shutdown.

- [ ] **Step 6: Run the telemetry service tests**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexTelemetry.test.ts
```

Expected: PASS, including timeout and cleanup cases.

- [ ] **Step 7: Commit the isolated telemetry service**

```bash
git add electron/services/codexTelemetry.ts tests/unit/electron/codexTelemetry.test.ts
git commit -m "feat(codex): read plan rate limits"
```

---

### Task 4: Expose telemetry through provider-tagged IPC and clean shutdown

**Files:**
- Modify: `electron/services/codex.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `tests/unit/preload.test.ts`
- Modify: `tests/unit/electron/codexBackendDispatch.test.ts`

- [ ] **Step 1: Add failing preload and IPC tests**

Extend `tests/unit/preload.test.ts`:

```typescript
it('reads provider-tagged Codex usage with an optional forced refresh', async () => {
  invoke.mockResolvedValue({ provider: 'codex', primary: null, secondary: null });
  await exposed.codexUsageFetch(true);
  expect(invoke).toHaveBeenCalledWith('codex:usage', { force: true });
});
```

Extend `tests/unit/electron/codexBackendDispatch.test.ts` so the `ipcMain.handle` capture invokes `codex:usage`, then assert the injected telemetry singleton receives `{ force: true }` and returns an object whose `provider` is `codex`.

- [ ] **Step 2: Run the focused tests to verify missing IPC**

Run:

```bash
npx vitest run --project unit tests/unit/preload.test.ts tests/unit/electron/codexBackendDispatch.test.ts
```

Expected: FAIL because `codexUsageFetch` and `codex:usage` are not registered.

- [ ] **Step 3: Register the IPC and preload bridge**

In `electron/services/codex.ts`, create one module-owned `CodexTelemetryService` and register:

```typescript
ipcMain.handle('codex:usage', (_event, options?: { force?: boolean }) =>
  codexTelemetry.readRateLimits({ force: options?.force === true }));
```

Export `destroyCodexTelemetry()` and a test seam `__setCodexTelemetryForTests(service)` that destroys the previous instance before replacement.

In `electron/preload.ts`, change the stale `// Codex CLI` comment to `// Codex SDK` and add:

```typescript
codexUsageFetch: (force = false) =>
  ipcRenderer.invoke('codex:usage', { force }) as Promise<CodexRateLimitsSnapshot | null>,
```

The response itself carries `provider: 'codex'`; do not reuse Claude's `usage:update` channel.

- [ ] **Step 4: Destroy telemetry on all app exit paths**

Import `destroyCodexTelemetry` in `electron/main.ts`. Call it beside `destroyCodexBackendIfActive()` in `before-quit`, and beside `destroyUsagePolling()` in `window-all-closed`. Both calls must remain idempotent and wrapped consistently with neighboring cleanup.

- [ ] **Step 5: Run the focused tests and type-check**

Run:

```bash
npx vitest run --project unit tests/unit/preload.test.ts tests/unit/electron/codexBackendDispatch.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit the telemetry bridge**

```bash
git add electron/services/codex.ts electron/preload.ts electron/main.ts tests/unit/preload.test.ts tests/unit/electron/codexBackendDispatch.test.ts
git commit -m "feat(codex): bridge usage telemetry to composer"
```

---

### Task 5: Normalize Codex todo snapshots on started and updated events

**Files:**
- Modify: `electron/services/codexBackend/sdkEventMap.ts`
- Modify: `tests/unit/electron/codexSdkEventMap.test.ts`
- Modify: `tests/unit/components/Chat/TodoProgress.test.tsx`

- [ ] **Step 1: Replace raw-todo expectations with failing normalized snapshots**

In `tests/unit/electron/codexSdkEventMap.test.ts`, assert both `item.started` and `item.updated` for the same item ID emit the same `TodoWrite` tool-use ID and normalized values:

```typescript
expect(mapCodexSdkEvent({ type: 'item.started', item: {
  id: 'todo-1', type: 'todo_list', items: [
    { text: 'Inspect', completed: true },
    { text: 'Implement', completed: false },
    { text: 'Verify', completed: false },
  ],
} } as any, ctx)).toEqual([expect.objectContaining({
  type: 'assistant',
  message: { content: [expect.objectContaining({
    type: 'tool_use', id: 'todo-1', name: 'TodoWrite', input: { todos: [
      { id: 'todo-1:0', content: 'Inspect', status: 'completed' },
      { id: 'todo-1:1', content: 'Implement', status: 'in_progress' },
      { id: 'todo-1:2', content: 'Verify', status: 'pending' },
    ] },
  })] },
})]);
```

Add an `item.updated` case advancing `Implement` to completed and `Verify` to in-progress. Add malformed entries (`null`, blank text, wrong completed type) and assert they are omitted without throwing. Add an all-complete case.

In `tests/unit/components/Chat/TodoProgress.test.tsx`, feed the normalized `TodoWrite` input through an assistant tool-call message. Assert `Implement` is the active label while incomplete, then rerender with every status `completed` and assert the progress control disappears. This locks the existing Claude visibility/dismissal behavior to the new Codex shape.

- [ ] **Step 2: Run mapper tests and observe raw payload/empty update failures**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexSdkEventMap.test.ts
```

Expected: FAIL because started emits `{ text, completed }` and updated emits nothing.

- [ ] **Step 3: Implement one normalization helper used by both event paths**

Add to `sdkEventMap.ts`:

```typescript
function normalizeTodos(item: Extract<ThreadItem, { type: 'todo_list' }>) {
  const valid = (Array.isArray(item.items) ? item.items : []).filter((todo): todo is { text: string; completed: boolean } =>
    !!todo && typeof todo.text === 'string' && todo.text.trim().length > 0 && typeof todo.completed === 'boolean');
  const firstIncomplete = valid.findIndex((todo) => !todo.completed);
  return valid.map((todo, index) => ({
    id: `${item.id}:${index}`,
    content: todo.text,
    status: todo.completed ? 'completed' : index === firstIncomplete ? 'in_progress' : 'pending',
  }));
}

function todoSnapshot(item: Extract<ThreadItem, { type: 'todo_list' }>, ctx: CodexMapContext): SaiEnvelope[] {
  return [toolUse(item.id, 'TodoWrite', { todos: normalizeTodos(item) }, ctx)];
}
```

Call `todoSnapshot` from both `startedItem(item, ctx)` and `updatedItem(item, ctx)`. Keep `completedItem`'s tool result so the tool card settles, but do not emit an empty replacement snapshot.

- [ ] **Step 4: Run mapper and tool-card regression tests**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexSdkEventMap.test.ts tests/unit/components/Chat/ToolCallCard.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit task-progress normalization**

```bash
git add electron/services/codexBackend/sdkEventMap.ts tests/unit/electron/codexSdkEventMap.test.ts tests/unit/components/Chat/TodoProgress.test.tsx
git commit -m "fix(codex): normalize live task progress"
```

---

### Task 6: Register and reactivate SDK Codex workspaces

**Files:**
- Modify: `electron/services/codexBackend/sdkBackend.ts`
- Modify: `tests/unit/electron/codexSdkBackend.test.ts`
- Modify: `tests/unit/components/TitleBar.test.tsx`

- [ ] **Step 1: Add failing backend registration tests**

Extend the existing SDK backend harness with `registerWorkspace: vi.fn()`. Add:

```typescript
it('registers a workspace when a scope starts', () => {
  const h = harness();
  h.backend.start({ projectPath: '/repo', scope: 'chat' });
  expect(h.registerWorkspace).toHaveBeenCalledWith('/repo');
});

it('reactivates a workspace again before every send', () => {
  const h = harness();
  h.backend.start({ projectPath: '/repo', scope: 'chat' });
  h.backend.send({ projectPath: '/repo', scope: 'chat', message: 'continue' });
  expect(h.registerWorkspace).toHaveBeenCalledTimes(2);
});

it('does not register or disturb another project', () => {
  const h = harness();
  h.backend.start({ projectPath: '/one' });
  h.backend.start({ projectPath: '/two' });
  h.backend.suspendWorkspace('/one');
  expect(h.registerWorkspace.mock.calls).toEqual([['/one'], ['/two']]);
  expect(h.backend.isWorkspaceBusy('/two')).toBe(false);
});
```

- [ ] **Step 2: Run the SDK backend test and verify the missing dependency**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexSdkBackend.test.ts
```

Expected: FAIL because `SdkCodexBackendDeps` has no `registerWorkspace` seam.

- [ ] **Step 3: Add the registry lifecycle call**

In `sdkBackend.ts`, import `getOrCreateWorkspace` from `../workspace`, add this dependency, and call it at the top of `start()` and `send()`:

```typescript
export interface SdkCodexBackendDeps {
  // existing dependencies
  registerWorkspace?: (projectPath: string) => void;
}

private readonly registerWorkspace: (projectPath: string) => void;

// constructor
this.registerWorkspace = deps.registerWorkspace ?? ((projectPath) => {
  try { getOrCreateWorkspace(projectPath); } catch { /* isolated tests or shutdown */ }
});

// first statement in start() and send()
this.registerWorkspace(args.projectPath);
```

Do not add provider-specific classification to `TitleBar`; registration is the fix.

- [ ] **Step 4: Add a picker regression assertion**

In `tests/unit/components/TitleBar.test.tsx`, add one fixture containing an active Codex-created registry row, a suspended row, and a recent-history-only row. Assert each path renders under the existing `Active`, `Suspended`, and `Recent` section headings. This test characterizes the UI contract; it should pass without production `TitleBar` changes.

- [ ] **Step 5: Run backend, workspace, and picker tests**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexSdkBackend.test.ts tests/unit/services/workspace.test.ts tests/unit/components/TitleBar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the workspace lifecycle fix**

```bash
git add electron/services/codexBackend/sdkBackend.ts tests/unit/electron/codexSdkBackend.test.ts tests/unit/components/TitleBar.test.tsx
git commit -m "fix(codex): register active SDK workspaces"
```

---

### Task 7: Remove SAI's legacy Codex CLI backend and selector plumbing

**Files:**
- Modify: `electron/services/codexBackend/index.ts`
- Modify: `electron/services/codexBackend/types.ts`
- Modify: `electron/services/codex.ts`
- Delete: `electron/services/codexBackend/cliBackend.ts`
- Delete: `tests/unit/services/codex.test.ts`
- Modify: `tests/unit/electron/codexBackendDispatch.test.ts`

- [ ] **Step 1: Rewrite selection tests to specify one SDK backend**

Remove `fs`, `app.getPath`, `CliCodexBackend`, and backend-setting mocks from `codexBackendDispatch.test.ts`. Keep IPC delegation tests and add:

```typescript
it('constructs and caches one SDK backend', () => {
  const first = getCodexBackend();
  const second = getCodexBackend();
  expect(first).toBe(second);
  expect(SdkCodexBackend).toHaveBeenCalledOnce();
});

it('registers Codex workspace hooks against the SDK singleton', () => {
  getCodexBackend();
  expect(registerWorkspaceBackendHooks).toHaveBeenCalledWith('codex', {
    suspend: expect.any(Function),
    isBusy: expect.any(Function),
  });
});
```

Add a source regression assertion that `electron/services/codexBackend/index.ts` contains neither `codexBackend` setting reads nor `CliCodexBackend` imports.

- [ ] **Step 2: Run dispatch tests before cleanup**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexBackendDispatch.test.ts
```

Expected: FAIL because production still imports and selects the CLI backend.

- [ ] **Step 3: Simplify the singleton to SDK-only**

Rewrite `electron/services/codexBackend/index.ts` around this construction path:

```typescript
import { emitChatMessage } from '../claude';
import { registerWorkspaceBackendHooks } from '../workspace';
import { fetchBundledCodexModels } from './bundledModels';
import { SdkCodexBackend } from './sdkBackend';
import type { CodexBackend } from './types';

export * from './types';

let active: CodexBackend | null = null;

export function getCodexBackend(): CodexBackend {
  if (active) return active;
  active = new SdkCodexBackend({ emit: emitChatMessage, getModels: fetchBundledCodexModels });
  registerWorkspaceBackendHooks('codex', {
    suspend: (projectPath) => active?.suspendWorkspace(projectPath),
    isBusy: (projectPath) => active?.isWorkspaceBusy(projectPath) ?? false,
  });
  return active;
}

export function destroyCodexBackendIfActive(): void {
  const backend = active;
  active = null;
  backend?.destroy();
}

export function __setCodexBackendForTests(backend: CodexBackend | null): void {
  if (active === backend) return;
  destroyCodexBackendIfActive();
  active = backend;
}
```

Remove `configureCodexBackendWindow(win)` from `registerCodexHandlers`. Remove `CodexBackendKind`, `CodexCapability`, and the currently unused `CodexCapabilityError` class; the repository has no production constructor or reader for that rollback-era error type.

- [ ] **Step 4: Delete the direct transport and rollback-only suite**

Delete `electron/services/codexBackend/cliBackend.ts` and `tests/unit/services/codex.test.ts`. Do not remove `@openai/codex-sdk`, `resolveBundledCodex`, optional platform packages, or `asarUnpack`; the SDK still requires the bundled executable.

- [ ] **Step 5: Verify no production transport references remain**

Run:

```bash
rg -n "CliCodexBackend|CodexBackendKind|getCodexBackendSetting|configureCodexBackendWindow|codexBackend.*cli" electron src
```

Expected: no matches.

- [ ] **Step 6: Run the complete backend test slice**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexBackendDispatch.test.ts tests/unit/electron/codexSdkBackend.test.ts tests/unit/electron/codexSdkOptions.test.ts tests/unit/electron/codexSdkEventMap.test.ts tests/unit/electron/codexBundledModels.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit SDK-only cleanup**

```bash
git add electron/services/codexBackend electron/services/codex.ts tests/unit/electron/codexBackendDispatch.test.ts tests/unit/services/codex.test.ts
git commit -m "refactor(codex): remove legacy CLI backend"
```

---

### Task 8: Remove the Codex backend setting UI and synchronization

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `tests/unit/components/SettingsModal.test.tsx`

- [ ] **Step 1: Replace selector tests with a failing absence test**

Delete the tests that load, change, remotely apply, or race `codexBackend`. Add:

```typescript
it('does not expose or synchronize a Codex transport setting', async () => {
  render(<SettingsModal {...defaultProps} initialSection="ai" />);
  await screen.findByText(/Codex/i);
  expect(screen.queryByText(/Codex backend/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /CLI/i })).not.toBeInTheDocument();
  expect(mock.settingsGet).not.toHaveBeenCalledWith('codexBackend', expect.anything());
  expect(mock.settingsSet).not.toHaveBeenCalledWith('codexBackend', expect.anything());
});
```

- [ ] **Step 2: Run the focused test and see the selector still render/read**

Run:

```bash
npx vitest run --project unit tests/unit/components/SettingsModal.test.tsx
```

Expected: FAIL on the old `codexBackend` setting access or selector.

- [ ] **Step 3: Remove all setting state and UI**

From `SettingsModal.tsx`, remove:

```typescript
const [codexBackend, setCodexBackend] = useState<'sdk' | 'cli'>('sdk');
const codexBackendRevision = useRef(0);
```

Also remove the initial `settingsGet('codexBackend', 'sdk')`, remote-settings branch, change handler, and selector block. Keep the Codex provider/model/reasoning settings around it unchanged. Old persisted values require no migration because nothing reads them.

- [ ] **Step 4: Run Settings tests and scan the renderer**

Run:

```bash
npx vitest run --project unit tests/unit/components/SettingsModal.test.tsx
rg -n "codexBackend|Codex backend" src tests/unit/components/SettingsModal.test.tsx
```

Expected: tests PASS and the scan returns no matches.

- [ ] **Step 5: Commit settings cleanup**

```bash
git add src/components/SettingsModal.tsx tests/unit/components/SettingsModal.test.tsx
git commit -m "refactor(codex): remove backend selector"
```

---

### Task 9: Make the composer presentation provider-neutral

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`
- Modify: `tests/unit/components/Chat/ChatInput.test.tsx`

- [ ] **Step 1: Add failing context-ring behavior tests**

Add tests rendering `ChatInput` with `contextUsage` and provider values:

```typescript
it('renders a read-only Codex context ring only when a total is known', async () => {
  const onSend = vi.fn();
  const { rerender } = render(<ChatInput {...baseProps()} aiProvider="codex" onSend={onSend}
    contextUsage={{ used: 2_000, total: 10_000, inputTokens: 1_700, cachedInputTokens: 500, cacheCreationTokens: 0, outputTokens: 300, reasoningOutputTokens: 100 }} />);
  const ring = screen.getByRole('button', { name: /Context 20%/i });
  expect(ring).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(ring);
  expect(onSend).not.toHaveBeenCalledWith('/compact');

  rerender(<ChatInput {...baseProps()} aiProvider="codex" onSend={onSend}
    contextUsage={{ used: 2_000, total: null, inputTokens: 1_700, cachedInputTokens: 500, cacheCreationTokens: 0, outputTokens: 300 }} />);
  expect(screen.queryByRole('button', { name: /Context \d+%/i })).not.toBeInTheDocument();
});

it('keeps the Claude ring clickable', async () => {
  const onSend = vi.fn();
  render(<ChatInput {...baseProps()} aiProvider="claude" onSend={onSend}
    contextUsage={{ used: 20, total: 100, inputTokens: 10, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 10 }} />);
  await userEvent.click(screen.getByRole('button', { name: /Click to compact/i }));
  expect(onSend).toHaveBeenCalledWith('/compact');
});
```

- [ ] **Step 2: Add failing shared usage-popover tests**

Pass `usageLimits` with primary 42% and secondary 73%. Assert Codex inline text is `73% used`, the popover shows `Current session`, `All models`, both resets, context totals, cached/new input, output, reasoning output, and session totals. Add a stale limit and assert `Data may be stale`. Confirm no `0% used` label renders for an empty list.

- [ ] **Step 3: Run ChatInput tests before changing provider gates**

Run:

```bash
npx vitest run --project unit tests/unit/components/Chat/ChatInput.test.tsx
```

Expected: FAIL because context and usage are Claude-gated and the shared prop does not exist.

- [ ] **Step 4: Render context by valid data and provider capability**

Change `ChatInput` props to use `ContextUsageView` and `UsageLimitView[]`. Render `ContextRing` when `contextUsage.total` is non-null and positive, regardless of provider. Change its API to:

```typescript
function ContextRing({ used, total, compactable }: {
  used: number;
  total: number;
  compactable: boolean;
})
```

For Claude, set `compactable` and call `onSend('/compact')`; title/aria-label remains `Context N% — Click to compact`. For Codex, set `aria-disabled="true"`, omit `onClick`, and title/aria-label is `Context N% — used / total tokens`. Do not use the native `disabled` attribute because the hover tooltip must remain available.

- [ ] **Step 5: Render the existing usage UI from shared limit views**

Replace the `aiProvider === 'claude'` usage guard with an availability guard:

```typescript
const hasUsageContent = usageLimits.length > 0 || !!sessionUsage || !!contextUsage;
```

Split by `limit.group`, choose the highest `usedPercent` for inline subscription text, render `limit.label`, and use `limit.stale` for opacity/help text. Preserve Claude overage and API-cost branches via the optional fields on `UsageLimitView`. Use provider-correct input detail:

```typescript
const totalInput = aiProvider === 'codex'
  ? contextUsage.inputTokens
  : contextUsage.inputTokens + contextUsage.cachedInputTokens + contextUsage.cacheCreationTokens;
const newInputTokens = aiProvider === 'codex'
  ? Math.max(0, contextUsage.inputTokens - contextUsage.cachedInputTokens)
  : contextUsage.inputTokens + contextUsage.cacheCreationTokens;
const cacheHitPct = totalInput > 0
  ? Math.round(contextUsage.cachedInputTokens / totalInput * 100)
  : 0;
```

Render `cachedInputTokens`, `newInputTokens`, `outputTokens`, and a reasoning-output row only when `reasoningOutputTokens > 0`. When `contextUsage.total` is null, omit the percentage bar but retain these token details and session totals in the popover. Rename every old `cacheReadTokens` read to `cachedInputTokens`.

- [ ] **Step 6: Run ChatInput and TodoProgress tests**

Run:

```bash
npx vitest run --project unit tests/unit/components/Chat/ChatInput.test.tsx tests/unit/components/Chat/TodoProgress.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the provider-neutral composer view**

```bash
git add src/components/Chat/ChatInput.tsx tests/unit/components/Chat/ChatInput.test.tsx
git commit -m "feat(codex): render composer telemetry"
```

---

### Task 10: Integrate Codex context and rate limits in ChatPanel

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Add failing provider-correct context accounting tests**

In `ChatPanel.test.tsx`, capture the props passed to the mocked `ChatInput`. For a Codex `result` event with:

```typescript
usage: {
  input_tokens: 1_000,
  cached_input_tokens: 600,
  output_tokens: 200,
  reasoning_output_tokens: 80,
}
```

and a selected model `{ id: 'gpt-5-codex', effectiveContextWindow: 10_000 }`, assert `contextUsage.used === 1_200`, `total === 10_000`, `cachedInputTokens === 600`, and `reasoningOutputTokens === 80`. Add a model without metadata and assert `total === null` rather than `1_000_000`. Add a compatibility fixture with `msg.modelUsage[model].contextWindow === 8_000` and assert the explicit smaller runtime value wins.

- [ ] **Step 2: Add failing polling and state-isolation tests**

Use fake timers and mock `window.sai.codexUsageFetch`. Assert:

```typescript
expect(codexUsageFetch).toHaveBeenCalledWith(false); // initial Codex mount
await vi.advanceTimersByTimeAsync(60_000);
expect(codexUsageFetch).toHaveBeenCalledTimes(2);    // mounted interval
emitCodexResult();
expect(codexUsageFetch).toHaveBeenLastCalledWith(true); // completed turn
```

Assert Claude never calls `codexUsageFetch`, Codex does not subscribe to Claude `onUsageUpdate`, and a response with a non-Codex provider tag is ignored. Rerender from Claude to Codex and assert Claude limits disappear. Change `sessionId` and assert context/session token totals reset while Codex account limits remain.

- [ ] **Step 3: Run the ChatPanel tests and verify current accounting/polling failures**

Run:

```bash
npx vitest run --project unit tests/unit/components/Chat/ChatPanel.test.tsx
```

Expected: FAIL because cached input is additive, total defaults to 1M, and Codex telemetry is not fetched.

- [ ] **Step 4: Replace the fake initial context state**

Initialize provider-neutral state as:

```typescript
const [contextUsage, setContextUsage] = useState<ContextUsageView | null>(null);
const [sessionUsage, setSessionUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
const [claudeRateLimits, setClaudeRateLimits] = useState<Map<string, ClaudeRateLimitRecord>>(new Map());
const [codexUsageLimits, setCodexUsageLimits] = useState<UsageLimitView[]>([]);
const usageLimits = useMemo(
  () => aiProvider === 'claude' ? claudeRateLimitsToViews(claudeRateLimits) : codexUsageLimits,
  [aiProvider, claudeRateLimits, codexUsageLimits],
);
```

Keep the existing Claude raw-map reconciliation under the renamed `claudeRateLimits` state and adapt it with `claudeRateLimitsToViews()` before passing it to `ChatInput`. Store Codex views only in `codexUsageLimits`; never share one raw limits map between providers.

- [ ] **Step 5: Process result usage by provider**

In the `msg.type === 'result'` branch:

```typescript
if (msg.usage && aiProvider === 'codex') {
  const catalogWindow = codexModels.find((model) => model.id === codexModel)?.effectiveContextWindow;
  const runtimeWindow = Object.values(msg.modelUsage ?? {})
    .map((value: any) => value?.contextWindow)
    .find((value): value is number => typeof value === 'number' && value > 0);
  const view = contextUsageFromCodex(
    msg.usage,
    resolveEffectiveContextWindow(catalogWindow, runtimeWindow),
  );
  setContextUsage(view);
  setSessionUsage((previous) => ({
    inputTokens: (previous?.inputTokens ?? 0) + view.inputTokens,
    outputTokens: (previous?.outputTokens ?? 0) + view.outputTokens,
  }));
  void window.sai.codexUsageFetch?.(true).then(applyCodexLimits);
} else if (msg.usage) {
  // preserve Claude's current cache-read/cache-creation accounting and modelUsage handling
}
```

The Codex session counter adds `inputTokens` once and `outputTokens` once. Claude's current semantics remain unchanged.

- [ ] **Step 6: Add provider-scoped Codex telemetry polling**

Add an effect keyed by `aiProvider`, active workspace state, and session identity:

```typescript
useEffect(() => {
  if (aiProvider !== 'codex' || !isActive) return;
  let cancelled = false;
  const refresh = (force = false) => window.sai.codexUsageFetch?.(force).then((snapshot) => {
    if (!cancelled && snapshot?.provider === 'codex') {
      setCodexUsageLimits(codexRateLimitsToViews(snapshot));
    }
  });
  void refresh(false);
  const timer = window.setInterval(() => void refresh(false), 60_000);
  return () => { cancelled = true; window.clearInterval(timer); };
}, [aiProvider, isActive]);
```

Keep Claude's `usageFetch`, `usageMode`, and `onUsageUpdate` effects gated to `aiProvider === 'claude'` and update only `claudeRateLimits`. Provider switching selects the isolated provider state synchronously, so neither provider's limits can leak into the other. On `sessionId` change, clear context and session tokens but leave Codex account limits intact.

- [ ] **Step 7: Pass shared telemetry to ChatInput**

Pass `contextUsage={contextUsage ?? undefined}`, `usageLimits={usageLimits}`, and `billingMode={aiProvider === 'codex' ? 'subscription' : billingMode}`. Claude continues to use `usageMode()`. Do not render account controls when telemetry is absent.

- [ ] **Step 8: Run focused renderer tests**

Run:

```bash
npx vitest run --project unit tests/unit/components/Chat/ChatPanel.test.tsx tests/unit/components/Chat/ChatInput.test.tsx tests/unit/components/Chat/ChatPanelFinalMessage.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit renderer integration**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(codex): connect composer telemetry"
```

---

### Task 11: Full regression verification and desktop dogfood

**Files:**
- Modify only if a verification failure exposes an in-scope regression

- [ ] **Step 1: Scan for removed backend and fake-context remnants**

Run:

```bash
rg -n "CliCodexBackend|CodexBackendKind|getCodexBackendSetting|configureCodexBackendWindow|codexBackend.*cli|total: 1000000" electron src tests
```

Expected: no production matches. Test fixtures may mention `1_000_000` only when explicitly testing rejection of the old fallback.

- [ ] **Step 2: Run the complete targeted suite**

Run:

```bash
npx vitest run --project unit tests/unit/lib/composerTelemetry.test.ts tests/unit/electron/codexTelemetry.test.ts tests/unit/electron/codexBundledModels.test.ts tests/unit/electron/codexSdkEventMap.test.ts tests/unit/electron/codexSdkBackend.test.ts tests/unit/electron/codexBackendDispatch.test.ts tests/unit/preload.test.ts tests/unit/components/SettingsModal.test.tsx tests/unit/components/Chat/ChatInput.test.tsx tests/unit/components/Chat/ChatPanel.test.tsx tests/unit/components/Chat/TodoProgress.test.tsx tests/unit/components/TitleBar.test.tsx tests/unit/services/workspace.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run all automated gates**

Run:

```bash
npm run test:unit
npm run test:integration
npm run build
```

Expected: every command exits 0 with no failed tests or TypeScript/build errors.

- [ ] **Step 4: Perform a desktop Codex dogfood pass**

Run `npm run dev`, open an authenticated Codex workspace, and verify all of the following:

1. Before the first turn, available plan limits appear without blocking chat if unavailable.
2. A completed turn shows a context ring only when the selected model has a valid effective window.
3. The Codex ring tooltip has token counts and clicking it does not send `/compact`.
4. Primary and secondary plan windows show percentages and reset times; the highest utilization is inline.
5. A Codex todo plan shows named tasks, advances the first incomplete task, and hides when all complete.
6. The open project appears under Active in the title-bar picker.
7. Suspending it moves it to Suspended and aborts only that project's Codex scopes.
8. Sending again reactivates it under Active; a history-only project remains under Recent.
9. Switching to Claude preserves clickable compaction, Claude usage, and Claude task behavior.
10. Closing the app leaves no `codex app-server` telemetry child running.

- [ ] **Step 5: Commit any verification-only corrections**

If no corrections were needed, do not create an empty commit. If corrections were required, stage only those files and run:

```bash
git commit -m "fix(codex): close telemetry regressions"
```
