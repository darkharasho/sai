# Context Management Parity with CLI/VS Code Extension

**Date:** 2026-03-29
**Goal:** Close the gaps between SAI and the Claude CLI/VS Code extension for context and token management, so SAI is no worse in terms of token burn rate and usage visibility.

## Problem

SAI wraps the Claude CLI but has three gaps compared to using the CLI directly:

1. **No manual compaction** — The CLI supports `/compact` natively. SAI has no way to trigger it, so users watch context grow until the CLI auto-compacts at its own threshold.
2. **Inaccurate context meter after compaction** — SAI guesses post-compaction usage as 30% of previous (`prev.used * 0.3`). This is a hardcoded estimate that misleads users about actual context state.
3. **No cache efficiency visibility** — SAI lumps all token types together. Users can't see whether prompt caching is working, making it impossible to know if they're paying full price for tokens unnecessarily.

## Design

### 1. Manual `/compact` Command

**Mechanism:** The CLI already handles `/compact` as a built-in command. SAI passes it through.

- When the user types `/compact` in the chat input, SAI sends it to the CLI's stdin as a normal user message: `{"type": "user", "message": {"role": "user", "content": "/compact"}}`
- The CLI performs compaction and emits a `system` message with `subtype: 'context_compacted'` (or `'auto_compact'` / `'compact'`)
- SAI surfaces the compaction notification in chat (already implemented)
- Context meter updates on the next `result` message with real usage data

**Already partially wired up.** The `ContextRing` component in ChatInput.tsx already calls `onSend('/compact')` on click, and `handleSend` in ChatPanel.tsx passes it through to the CLI (only `/clear` and `/help` are intercepted locally). Typing `/compact` in the input also works. The remaining work is just ensuring the context meter updates correctly afterward (see section 2).

### 2. Accurate Context Meter After Compaction

**Current behavior (broken):**
```typescript
// ChatPanel.tsx — hardcoded guess
setContextUsage(prev => ({ used: Math.round(prev.used * 0.3), total: prev.total }));
```

**New behavior:**
- On compaction event: do NOT update the context usage with a guess
- Instead, leave the meter as-is (or optionally show a "compacting..." state)
- The next `result` message from the CLI contains accurate `msg.usage` data, which already updates the meter
- If the compaction system message itself contains usage data, use it directly

**Change:** Remove the `prev.used * 0.3` line. The meter may briefly show stale data between compaction and the next turn, which is acceptable and better than showing wrong data.

### 3. Cache Efficiency Visibility

**Current behavior:** Context bar shows a single `used / total` number that sums all token types.

**New behavior:** Store token types individually and show a breakdown in the usage tooltip beneath the Context bar:

```
Context
411.1K / 1.0M                        41% used

  Cache hit   380.2K  (92%)
  New input    22.8K
  Output        8.1K
```

**Data flow:**
- `msg.usage` already provides: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`
- Expand `contextUsage` state from `{ used, total }` to include the individual token counts
- The main bar continues to show the total (`used / total`)
- Below it, render a small breakdown:
  - **Cache hit** = `cache_read_input_tokens` — tokens served from cache (cheap, 90% rate limit discount)
  - **New input** = `input_tokens + cache_creation_input_tokens` — full price tokens
  - **Output** = `output_tokens`
- Show cache hit percentage: `cache_read / (cache_read + input + cache_creation) * 100`

**Styling:** Use muted text (`var(--text-muted)`) and smaller font for the breakdown lines. Keep it subtle — informational, not prominent.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/Chat/ChatPanel.tsx` | Expand `contextUsage` state to include per-type token counts. Remove `prev.used * 0.3` hack from compaction handler. |
| `src/components/Chat/ChatInput.tsx` | Update `contextUsage` prop type. Render cache breakdown in tooltip below Context bar. |

## Out of Scope

- Proactive compaction thresholds (Approach B from brainstorming)
- Token budget dashboards or burn rate analytics (Approach C)
- Superpowers skill token overhead — this is a CLI-level concern, not controllable by SAI
- Process respawn optimization — user confirmed config changes are rare
