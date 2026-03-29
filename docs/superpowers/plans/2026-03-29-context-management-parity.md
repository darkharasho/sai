# Context Management Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the context management gaps between SAI and the Claude CLI/VS Code extension — fix the post-compaction meter hack, add cache efficiency visibility to the usage tooltip.

**Architecture:** Two changes to the existing ChatPanel/ChatInput component pair. Expand the `contextUsage` state to carry per-type token counts. Remove the hardcoded 30% compaction estimate. Add a cache breakdown below the Context bar in the tooltip.

**Tech Stack:** React, TypeScript, inline CSS (`<style>` tag in ChatInput.tsx)

---

### Task 1: Expand `contextUsage` state to include per-type token counts

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx:119` (state declaration)
- Modify: `src/components/Chat/ChatPanel.tsx:288-304` (result handler)
- Modify: `src/components/Chat/ChatPanel.tsx:464-475` (prop passing)
- Modify: `src/components/Chat/ChatInput.tsx:23` (prop type)

- [ ] **Step 1: Update the `contextUsage` state type in ChatPanel.tsx**

Change line 119 from:
```typescript
const [contextUsage, setContextUsage] = useState<{ used: number; total: number }>({ used: 0, total: 1000000 });
```
To:
```typescript
const [contextUsage, setContextUsage] = useState<{ used: number; total: number; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number }>({ used: 0, total: 1000000, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 });
```

- [ ] **Step 2: Update the result handler to store per-type counts**

Change the `msg.type === 'result'` context usage block (lines 288-304) from:
```typescript
if (msg.usage) {
  const used = (msg.usage.input_tokens || 0) +
    (msg.usage.cache_read_input_tokens || 0) +
    (msg.usage.cache_creation_input_tokens || 0) +
    (msg.usage.output_tokens || 0);
  const modelUsage = msg.modelUsage || {};
  const modelKey = Object.keys(modelUsage)[0];
  let total = modelKey ? modelUsage[modelKey].contextWindow || 0 : 0;
  if (!total || used > total) {
    total = 1000000;
  }
  setContextUsage({ used, total });
}
```
To:
```typescript
if (msg.usage) {
  const inputTokens = msg.usage.input_tokens || 0;
  const cacheReadTokens = msg.usage.cache_read_input_tokens || 0;
  const cacheCreationTokens = msg.usage.cache_creation_input_tokens || 0;
  const outputTokens = msg.usage.output_tokens || 0;
  const used = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;
  const modelUsage = msg.modelUsage || {};
  const modelKey = Object.keys(modelUsage)[0];
  let total = modelKey ? modelUsage[modelKey].contextWindow || 0 : 0;
  if (!total || used > total) {
    total = 1000000;
  }
  setContextUsage({ used, total, inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens });
}
```

- [ ] **Step 3: Update the ChatInput prop type**

Change line 23 in ChatInput.tsx from:
```typescript
contextUsage?: { used: number; total: number };
```
To:
```typescript
contextUsage?: { used: number; total: number; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number };
```

- [ ] **Step 4: Run type check**

Run: `PATH="/var/home/mstephens/.nvm/versions/node/v22.22.1/bin:$PATH" node_modules/.bin/tsc --noEmit`
Expected: no errors (the prop is already passed through and the extra fields are just additional data)

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx src/components/Chat/ChatInput.tsx
git commit -m "feat: expand contextUsage state with per-type token counts"
```

---

### Task 2: Remove the hardcoded 30% compaction estimate

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx:195-206` (compaction handler)

- [ ] **Step 1: Update the compaction handler**

Change lines 195-206 from:
```typescript
if (msg.type === 'system' && (msg.subtype === 'context_compacted' || msg.subtype === 'auto_compact' || msg.subtype === 'compact')) {
  const summary = msg.summary ? ` Summary: ${msg.summary.slice(0, 100)}` : '';
  setMessages(prev => [...prev, {
    id: `compact-${Date.now()}`,
    role: 'system',
    content: `Context auto-compacted.${summary}`,
    timestamp: Date.now(),
  }]);
  // Reset context meter — the next result message will have accurate numbers
  setContextUsage(prev => ({ used: Math.round(prev.used * 0.3), total: prev.total }));
  return;
}
```
To:
```typescript
if (msg.type === 'system' && (msg.subtype === 'context_compacted' || msg.subtype === 'auto_compact' || msg.subtype === 'compact')) {
  const summary = msg.summary ? ` Summary: ${msg.summary.slice(0, 100)}` : '';
  setMessages(prev => [...prev, {
    id: `compact-${Date.now()}`,
    role: 'system',
    content: `Context auto-compacted.${summary}`,
    timestamp: Date.now(),
  }]);
  // Don't guess post-compaction size — the next result message will have accurate numbers
  return;
}
```

- [ ] **Step 2: Run type check**

Run: `PATH="/var/home/mstephens/.nvm/versions/node/v22.22.1/bin:$PATH" node_modules/.bin/tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "fix: remove hardcoded 30% context estimate after compaction"
```

---

### Task 3: Add cache efficiency breakdown to the usage tooltip

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx:548-558` (Context section in tooltip)
- Modify: `src/components/Chat/ChatInput.tsx:924-973` (CSS styles)

- [ ] **Step 1: Add the cache breakdown below the Context UsageBar**

Change lines 548-558 from:
```tsx
{/* Context */}
{contextUsage && (
  <div className="usage-tooltip-section">
    <UsageBar
      pct={Math.min((contextUsage.used / contextUsage.total) * 100, 100)}
      color={getBarColor(Math.min((contextUsage.used / contextUsage.total) * 100, 100), false)}
      label="Context"
      sublabel={`${formatTokens(contextUsage.used)} / ${formatTokens(contextUsage.total)}`}
    />
  </div>
)}
```
To:
```tsx
{/* Context */}
{contextUsage && (
  <div className="usage-tooltip-section">
    <UsageBar
      pct={Math.min((contextUsage.used / contextUsage.total) * 100, 100)}
      color={getBarColor(Math.min((contextUsage.used / contextUsage.total) * 100, 100), false)}
      label="Context"
      sublabel={`${formatTokens(contextUsage.used)} / ${formatTokens(contextUsage.total)}`}
    />
    {contextUsage.used > 0 && (() => {
      const totalInput = contextUsage.inputTokens + contextUsage.cacheReadTokens + contextUsage.cacheCreationTokens;
      const cacheHitPct = totalInput > 0 ? Math.round((contextUsage.cacheReadTokens / totalInput) * 100) : 0;
      return (
        <div className="context-breakdown">
          <div className="context-breakdown-row">
            <span className="context-breakdown-label">Cache hit</span>
            <span className="context-breakdown-value">{formatTokens(contextUsage.cacheReadTokens)}</span>
            <span className="context-breakdown-pct">({cacheHitPct}%)</span>
          </div>
          <div className="context-breakdown-row">
            <span className="context-breakdown-label">New input</span>
            <span className="context-breakdown-value">{formatTokens(contextUsage.inputTokens + contextUsage.cacheCreationTokens)}</span>
          </div>
          <div className="context-breakdown-row">
            <span className="context-breakdown-label">Output</span>
            <span className="context-breakdown-value">{formatTokens(contextUsage.outputTokens)}</span>
          </div>
        </div>
      );
    })()}
  </div>
)}
```

- [ ] **Step 2: Add CSS for the cache breakdown**

Add the following CSS after the `.usage-bar-pct` rule (after line 973):
```css
.context-breakdown {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.context-breakdown-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
.context-breakdown-label {
  width: 70px;
  flex-shrink: 0;
}
.context-breakdown-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
}
.context-breakdown-pct {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--text-muted);
}
```

- [ ] **Step 3: Run type check**

Run: `PATH="/var/home/mstephens/.nvm/versions/node/v22.22.1/bin:$PATH" node_modules/.bin/tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat: add cache efficiency breakdown to context usage tooltip"
```
