# Codex Composer Telemetry and SDK-Only Cleanup Design

**Date:** 2026-07-21  
**Status:** Approved in conversation; awaiting written-spec review  
**Parent program:** `2026-07-21-codex-first-class-parity-design.md`

## Goal

Give Codex the same under-composer visibility SAI already provides for Claude:

- current context-window usage;
- ChatGPT plan-limit usage and reset times; and
- live task progress.

At the same time, make `SdkCodexBackend` SAI's only Codex conversation backend, remove the legacy direct CLI transport and its settings surface, and repair Codex workspace classification in the desktop title-bar picker.

The official `@openai/codex-sdk` remains. That package still launches SAI's bundled Codex executable internally; "remove the CLI backend" means removing SAI's separate `CliCodexBackend` implementation and transport selector, not replacing the SDK's runtime architecture.

## Scope

### In scope

- Reuse the existing Claude `ContextRing`, usage popover, and `TodoProgress` presentation for Codex.
- Normalize Codex SDK usage and todo-list events into renderer-facing view models.
- Read ChatGPT Codex rate-limit windows through a narrow, read-only app-server telemetry request.
- Enrich Codex model metadata with the effective context-window size reported by Codex's local model catalog.
- Remove the legacy direct CLI backend, backend-selection setting, and CLI-specific tests.
- Register and reactivate SDK-owned Codex workspaces in the shared main-process workspace registry.
- Preserve Claude and Gemini behavior.

### Out of scope

- Replacing `@openai/codex-sdk` with app-server for conversations.
- Codex context compaction or making the Codex context ring clickable.
- Account lifetime-token and daily-activity history from `account/usage/read`.
- Earned rate-limit reset redemption.
- Redesigning the composer or changing Claude's controls.
- Mobile/remote workspace-picker changes.
- Broad provider-event-model or tool-card refactors from the parent parity program.

## Current State and Root Causes

### Composer telemetry is present but Claude-gated

`ChatPanel` already receives Codex `turn.completed` usage through the SDK event mapper and accumulates session tokens. `ChatInput` receives that state, but both the context ring and usage popover are guarded by `aiProvider === 'claude'`.

The existing context calculation is unsafe for Codex:

- it defaults the context window to 1M when the provider does not report one;
- it treats cached input as additive, although Codex reports cached input as a detail of input usage; and
- it does not retain Codex reasoning-output usage in the composer view model.

The percentage must therefore remain hidden until both a valid Codex usage snapshot and an effective context-window size are known.

### Codex todo payloads do not match SAI's task contract

The SDK exposes todo-list entries as `{ text, completed }`. The mapper currently forwards those values under `TodoWrite`, while `TodoProgress` expects `{ id, content, status }`. The mapper also ignores `item.updated`, so a plan can render with missing labels and never advance.

### Account limits are unavailable from the TypeScript SDK

The installed SDK reports per-turn input, cached-input, output, and reasoning-output tokens, but it does not expose account rate-limit windows. The bundled Codex app-server has a stable `account/rateLimits/read` request whose response contains primary and secondary windows with used percentage, duration, and reset time.

SAI will use app-server only as a short-lived read-only telemetry sidecar. It will not start, resume, or modify chat threads.

### The legacy backend is now redundant

Phase 1 introduced `SdkCodexBackend` with `CliCodexBackend` as a rollback path. The user has now chosen the SDK path exclusively and explicitly ended that rollback requirement. Keeping both paths would expand settings, tests, capability branches, and lifecycle behavior without a product requirement.

### Codex SDK workspaces bypass the authoritative registry

The desktop title-bar picker classifies projects using `workspace:getAll`, which reads the main-process workspace registry. Claude's SDK backend calls `getOrCreateWorkspace(projectPath)` from both `start()` and `send()`. Codex's SDK backend does neither.

Consequently, a live Codex SDK scope can exist while the title bar still sees its project as recent/inactive or suspended. Busy/suspend hooks cannot repair the classification because they do not create or reactivate registry entries.

## Architecture

### 1. One Codex conversation backend

`getCodexBackend()` constructs `SdkCodexBackend` directly. It no longer reads `settings.json` to choose a transport and no longer requires a `BrowserWindow` for a legacy backend.

Remove:

- `CliCodexBackend` and its direct `codex exec --json` event translation;
- `CodexBackendKind` and backend-selection helpers;
- the Codex transport selector in Settings;
- synchronized-setting handling for `codexBackend`; and
- rollback-only tests and mocks.

Keep:

- `@openai/codex-sdk`;
- bundled platform-specific Codex packages;
- `resolveBundledCodex()`;
- SDK model discovery through the bundled app-server; and
- the `CodexBackend` interface where it remains a useful test seam.

An old persisted `codexBackend: "cli"` value is ignored. No migration write is needed because the setting no longer has a reader or UI.

### 2. Provider-neutral composer telemetry view models

Extract the UI-facing shapes now embedded in `ChatInput` into small shared types:

```ts
interface ContextUsageView {
  used: number;
  total: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens?: number;
}

interface UsageLimitView {
  id: string;
  label: string;
  group: 'session' | 'weekly';
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
  updatedAt: number;
}
```

Claude's current rate-limit data is adapted into this view without changing its appearance or behavior. Codex telemetry maps into the same view. `ChatInput` renders data based on availability rather than provider-name checks.

### 3. Codex context accounting

For a completed Codex turn:

- `input_tokens` is the current request's total input usage;
- `cached_input_tokens` is displayed as a subset/detail of input and is not added again;
- `output_tokens` is added to input for the current context footprint;
- `reasoning_output_tokens` is displayed as output detail when present; and
- the session counter continues accumulating each completed turn separately.

The context footprint is therefore:

```text
used = input_tokens + output_tokens
```

Codex's local model catalog supplies `context_window` and `effective_context_window_percent`. Model discovery enriches `CodexModelOption` with:

```text
effectiveContextWindow = floor(context_window * effective_context_window_percent / 100)
```

If the runtime has an explicit smaller configured context window, use the smaller valid value. If no valid effective window can be resolved, preserve token totals but omit the context percentage and ring. Never substitute 1M.

The context ring is read-only for Codex. Its title reports percentage and token counts but does not advertise compaction. Claude retains click-to-compact.

### 4. Codex account-rate-limit telemetry

Add a main-process `CodexTelemetryService` with one public operation: `readRateLimits()`.

For an uncached refresh, the service:

1. resolves the bundled Codex executable and environment;
2. spawns `codex app-server` over stdio;
3. sends `initialize` and the required initialized notification;
4. sends `account/rateLimits/read`;
5. validates and normalizes the response; and
6. terminates the child process in `finally`.

The service prefers `rateLimitsByLimitId.codex` when present, then falls back to the compatibility `rateLimits` snapshot. It maps:

- primary window to the session group, normally labeled `Current session`;
- secondary window to the weekly group, normally labeled `All models`; and
- reset timestamps and durations without inventing missing values.

The service does not request lifetime/daily token activity and does not consume reset credits.

Refresh policy:

- initial fetch when Codex becomes the active provider;
- refresh after a completed Codex turn;
- refresh every 60 seconds while a Codex chat is mounted and visible; and
- immediate reuse of a successful result younger than 30 seconds.

Concurrent callers share one in-flight promise. Failures use bounded backoff. The latest successful snapshot remains available but is marked stale after two minutes.

IPC messages include the provider so Claude and Codex responses cannot overwrite one another. A Codex refresh failure never mutates Claude usage state.

### 5. Codex task normalization

Normalize every Codex todo-list snapshot before emitting it to the renderer:

```ts
{
  id: `${todoListItemId}:${index}`,
  content: item.text,
  status: item.completed
    ? 'completed'
    : index === firstIncompleteIndex
      ? 'in_progress'
      : 'pending'
}
```

Emit the normalized `TodoWrite` tool-use snapshot for both `item.started` and `item.updated`. Updating the existing tool call by its Codex item ID avoids duplicate transcript cards and lets `TodoProgress` animate in place.

`item.completed` settles the tool result but does not erase the last normalized snapshot. `TodoProgress` hides the ring once every task is complete, matching Claude.

### 6. Workspace registry lifecycle

`SdkCodexBackend.start()` calls `getOrCreateWorkspace(projectPath)` before emitting ready. `send()` calls it again before beginning a turn.

This mirrors Claude's SDK lifecycle contract and provides two guarantees:

- mounting a Codex workspace moves it from Recent/inactive to Active; and
- sending from a suspended workspace reactivates it and refreshes its inactivity clock.

The shared workspace service remains authoritative for suspension:

- `suspend()` invokes Codex's registered lifecycle hook;
- `SdkCodexBackend.suspendWorkspace()` aborts and removes only the target project's scopes;
- the workspace service sets registry status to `suspended`; and
- the existing `workspace:suspended` renderer event updates local workspace state.

No Codex-specific classification logic is added to `TitleBar`.

## UI Behavior

### Toolbar

When Codex has valid data, the composer shows:

- the context ring in the same left-toolbar position used by Claude;
- the existing green task ring beside it during an active incomplete plan; and
- plan usage text in the same right-toolbar position used by Claude.

The inline usage label shows the plan window with the greatest utilization. Missing data renders `Usage` only when there is another useful popover section; it never renders a misleading `0% used`.

### Usage popover

The existing popover renders:

- session/primary plan limit and reset;
- weekly/secondary plan limit and reset;
- context usage and token counts;
- cached input, new input, output, and reasoning-output breakdown when nonzero; and
- session token totals.

It preserves Claude's layout, colors, warning thresholds, stale-data treatment, and hover behavior. Provider-specific adapters supply labels and grouping.

### Task popover

The task popover preserves existing visibility and dismissal behavior. The first incomplete Codex task is active because the SDK has no separate in-progress flag. Later incomplete tasks are pending.

### Workspace picker

The desktop title-bar picker continues to show its existing sections:

- Active for registered open workspaces;
- Suspended for explicitly or automatically suspended workspaces; and
- Recent for history-only projects.

The fix changes registry lifecycle, not picker rendering.

## Failure Handling

- App-server spawn, initialization, authentication, protocol, parse, and timeout failures are nonfatal.
- A failed rate-limit refresh leaves a prior snapshot intact and stale-marked; without a prior snapshot, plan-limit controls remain hidden.
- An unavailable model catalog hides context percentage rather than guessing a window.
- Malformed todo entries are ignored individually. A malformed snapshot cannot crash event mapping.
- Duplicate todo updates are idempotent by tool/item ID.
- Telemetry subprocesses are terminated on success, error, timeout, app shutdown, and test cleanup.
- Workspace registry failures are caught at the SDK boundary so isolated backend tests can inject no registry, matching the existing Claude test seam.
- Removing the legacy backend must not remove the bundled executable required by the SDK.

## Testing Strategy

### Event and model normalization

- `item.started` normalizes Codex todos into SAI task fields.
- `item.updated` replaces the existing snapshot and advances completion.
- the first incomplete item becomes active; completed and later items map correctly.
- malformed todo items are ignored safely.
- Codex usage does not double-count cached input.
- reasoning-output tokens remain available to the composer.
- effective context windows use runtime metadata and explicit smaller limits.
- missing model metadata produces no percentage or fake 1M fallback.

### Telemetry service

- performs initialize then `account/rateLimits/read` in order;
- prefers the `codex` limit-id snapshot and supports the compatibility snapshot;
- maps primary/secondary percentages, durations, and reset timestamps;
- coalesces concurrent refreshes and honors the cache TTL;
- preserves last-known data through failures and marks it stale;
- times out and terminates the child process;
- redacts diagnostics and never exposes auth material to the renderer.

### Renderer

- Codex renders the context ring only with valid usage and window data.
- the Codex ring is read-only and has provider-correct help text.
- Claude's ring remains clickable and still sends `/compact`.
- Codex plan usage renders in the existing inline label and popover.
- provider switching does not leak Claude limits into Codex or vice versa.
- session switching keeps account limits but resets session-scoped token totals.
- Codex task progress updates in place and hides when complete.

### Backend and settings cleanup

- `getCodexBackend()` always returns the SDK backend.
- a stale `codexBackend: "cli"` setting has no effect.
- Settings no longer renders or syncs a Codex transport selector.
- no production import references `CliCodexBackend` or `CodexBackendKind`.
- SDK model discovery, send, resume, stop, suspend, and destroy tests remain green.

### Workspace lifecycle

- `start()` registers a Codex project as active.
- suspending a Codex project aborts its scopes and classifies it as suspended.
- starting or sending again reactivates the same registry entry.
- one project's suspend does not disturb another project's SDK runtime.
- a busy Codex workspace is not auto-suspended.
- the title-bar picker renders Active, Suspended, and Recent rows from those registry states.

### Verification commands

The implementation plan will identify exact targeted test commands. Completion requires, at minimum:

- targeted Codex backend, mapper, telemetry, `ChatInput`, `ChatPanel`, Settings, TitleBar, and workspace lifecycle tests;
- `npm run test:unit`;
- `npm run test:integration`;
- `npm run build`; and
- a desktop dogfood pass covering a live Codex plan, context/usage popover, suspend, and reactivate flow.

## Success Criteria

1. Codex shows context, plan usage, and live task progress under the composer with the same visual system as Claude.
2. Codex plan-limit data comes from the authenticated runtime and displays primary/secondary reset information accurately.
3. Context usage never assumes a 1M window or double-counts cached input.
4. Codex task updates animate and settle correctly.
5. SAI contains one Codex conversation backend: `SdkCodexBackend`.
6. The desktop workspace picker correctly distinguishes Active, Suspended, and Recent Codex workspaces.
7. Claude and Gemini composer and workspace behavior remain unchanged.
8. Telemetry failure never blocks a Codex chat.

## References

- [Codex app-server protocol: account rate limits](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#7-rate-limits-chatgpt)
- [Codex app-server protocol: thread token usage](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#turn-events)
- Installed `@openai/codex-sdk` and bundled Codex runtime version: `0.144.6` at design time.
