# Overlay Tool Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay tool cards show a one-line detail of the action (command, file path, pattern…) inline after the tool name.

**Architecture:** A new pure module `src/lib/toolCallDetail.ts` derives a plain-text detail from a ToolCall's name/type/input. The overlay tail builder in App.tsx attaches it to tool tail items; OverlayView renders it inline and drops the redundant "running/done" status word.

**Tech Stack:** TypeScript, React, Vitest (worker cap 2 — do not raise).

**Spec:** `docs/superpowers/specs/2026-06-11-overlay-tool-detail-design.md`

**Setup:** fresh branch off `main`: `git checkout -b overlay-tool-detail`. Subagents: NEVER `git checkout` a commit SHA — use `git show <sha>` to inspect.

---

### Task 1: `toolCallDetail` helper

**Files:**
- Create: `src/lib/toolCallDetail.ts`
- Test: `tests/unit/lib/toolCallDetail.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/toolCallDetail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toolCallDetail, shortenPathLeft } from '@/lib/toolCallDetail';

const tc = (name: string, input: unknown, type = 'other') =>
  ({ name, type, input: typeof input === 'string' ? input : JSON.stringify(input) }) as any;

describe('shortenPathLeft', () => {
  it('keeps short paths intact', () => {
    expect(shortenPathLeft('src/App.tsx', 40)).toBe('src/App.tsx');
  });
  it('truncates from the left preserving the basename', () => {
    const p = 'src/components/Chat/GitHubWatcherCard.tsx';
    const out = shortenPathLeft(p, 30);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('GitHubWatcherCard.tsx')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30);
  });
  it('hard-cuts a basename longer than the budget', () => {
    expect(shortenPathLeft('averyveryverylongfilename.tsx', 12)).toBe('…ilename.tsx');
  });
});

describe('toolCallDetail', () => {
  it('Bash → first line of the command', () => {
    expect(toolCallDetail(tc('Bash', { command: 'npm test\necho done' }))).toBe('npm test');
  });
  it('Edit/Write/Read/NotebookEdit → left-shortened file_path', () => {
    for (const name of ['Edit', 'Write', 'Read', 'NotebookEdit']) {
      expect(toolCallDetail(tc(name, { file_path: '/var/home/m/proj/src/components/Chat/ChatPanel.tsx' })))
        .toMatch(/…?.*ChatPanel\.tsx$/);
    }
  });
  it('Grep/Glob → pattern', () => {
    expect(toolCallDetail(tc('Grep', { pattern: 'detectWatchTargets' }))).toBe('detectWatchTargets');
    expect(toolCallDetail(tc('Glob', { pattern: '**/*.test.ts' }))).toBe('**/*.test.ts');
  });
  it('WebFetch → host; WebSearch → query', () => {
    expect(toolCallDetail(tc('WebFetch', { url: 'https://docs.github.com/en/rest' }))).toBe('docs.github.com');
    expect(toolCallDetail(tc('WebSearch', { query: 'electron capturePage' }))).toBe('electron capturePage');
  });
  it('Task/Agent → description; Skill → skill name', () => {
    expect(toolCallDetail(tc('Task', { description: 'Fix flaky test' }))).toBe('Fix flaky test');
    expect(toolCallDetail(tc('Agent', { description: 'Explore repo', prompt: 'x' }))).toBe('Explore repo');
    expect(toolCallDetail(tc('Skill', { skill: 'commit', args: '' }))).toBe('commit');
  });
  it('mcp__ tools → first string-valued input property', () => {
    expect(toolCallDetail(tc('mcp__swarm__sai_render_html', { html: '<b>x</b>', width: 360 }))).toBe('<b>x</b>');
  });
  it('unknown tools → null', () => {
    expect(toolCallDetail(tc('TodoWrite', { todos: [] }))).toBeNull();
  });
  it('malformed/empty input → null', () => {
    expect(toolCallDetail(tc('Bash', '{"command": "npm'))).toBeNull();
    expect(toolCallDetail(tc('Bash', ''))).toBeNull();
    expect(toolCallDetail(tc('Bash', { other: 1 }))).toBeNull();
  });
  it('caps long details at a word boundary with ellipsis', () => {
    const long = 'echo ' + 'word '.repeat(40);
    const out = toolCallDetail(tc('Bash', { command: long }))!;
    expect(out.length).toBeLessThanOrEqual(81); // 80 + ellipsis char
    expect(out.endsWith('…')).toBe(true);
  });
  it('invalid url in WebFetch → null', () => {
    expect(toolCallDetail(tc('WebFetch', { url: 'not a url' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/lib/toolCallDetail.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Write the implementation**

Create `src/lib/toolCallDetail.ts`:

```ts
import type { ToolCall } from '../types';
import { truncateSnippet } from './overlayFeed';

const DETAIL_MAX = 80;

/** Shorten a path from the LEFT so the basename survives: …/Chat/ChatPanel.tsx */
export function shortenPathLeft(path: string, max: number): string {
  if (path.length <= max) return path;
  const tail = path.slice(-(max - 1));
  const slash = tail.indexOf('/');
  // Prefer cutting at a directory boundary; fall back to a hard cut.
  return `…${slash > 0 && slash < tail.length - 1 ? tail.slice(slash) : tail}`;
}

function parse(input: string): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const v = JSON.parse(input);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** Plain-text one-liner describing what a tool call is doing, for compact
 *  surfaces (the overlay). Returns null when there's nothing useful to say —
 *  including mid-stream, while `input` is still partial JSON. */
export function toolCallDetail(tc: Pick<ToolCall, 'name' | 'type' | 'input'>): string | null {
  const input = parse(tc.input || '');
  if (!input) return null;
  const name = tc.name || '';

  let detail: string | null = null;
  if (name === 'Bash') {
    detail = str(input.command)?.split('\n')[0] ?? null;
  } else if (name === 'Edit' || name === 'Write' || name === 'Read' || name === 'NotebookEdit') {
    const p = str(input.file_path);
    detail = p ? shortenPathLeft(p, 48) : null;
  } else if (name === 'Grep' || name === 'Glob') {
    detail = str(input.pattern);
  } else if (name === 'WebFetch') {
    const u = str(input.url);
    if (u) { try { detail = new URL(u).host; } catch { detail = null; } }
  } else if (name === 'WebSearch') {
    detail = str(input.query);
  } else if (name === 'Task' || name === 'Agent') {
    detail = str(input.description);
  } else if (name === 'Skill') {
    detail = str(input.skill);
  } else if (name.startsWith('mcp__')) {
    detail = Object.values(input).find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? null;
  }

  return detail ? truncateSnippet(detail, DETAIL_MAX) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/lib/toolCallDetail.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/toolCallDetail.ts tests/unit/lib/toolCallDetail.test.ts
git commit -m "feat(overlay): toolCallDetail — plain-text one-liner per tool call"
```

---

### Task 2: Wire detail into the tail + overlay rendering

**Files:**
- Modify: `src/lib/overlayFeed.ts:15-19` (OverlayTailItem)
- Modify: `src/App.tsx` (tail builder in `tailFor`, the `kind: 'tool'` push)
- Modify: `src/components/Overlay/OverlayView.tsx:156-161` (tool branch)
- Modify: `src/components/Overlay/OverlayView.css:149-151`

- [ ] **Step 1: Type change**

In `src/lib/overlayFeed.ts`, change the tool variant:

```ts
export type OverlayTailItem =
  | { kind: 'text'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'tool'; name: string; done: boolean; detail?: string }
  | { kind: 'elided'; count: number };
```

- [ ] **Step 2: Attach detail in App.tsx**

Add the import next to the other `./lib/` imports:

```ts
import { toolCallDetail } from './lib/toolCallDetail';
```

In the `tailFor` helper, replace:

```ts
        for (const tc of calls.slice(-TOOLS_PER_MESSAGE)) {
          tail.push({ kind: 'tool', name: tc.name, done: tc.output != null });
        }
```

with:

```ts
        for (const tc of calls.slice(-TOOLS_PER_MESSAGE)) {
          tail.push({ kind: 'tool', name: tc.name, done: tc.output != null, detail: toolCallDetail(tc) ?? undefined });
        }
```

- [ ] **Step 3: Render in OverlayView**

In `src/components/Overlay/OverlayView.tsx`, replace the tool branch (lines 156–161):

```tsx
                <div key={`c-${i}`} className={`overlay-tool-card${item.done ? ' overlay-tool-done' : ''}`}>
                  <span className="overlay-tool-dot" />
                  <span className="overlay-tool-name">{item.name}</span>
                  {item.detail && <span className="overlay-tool-detail">{item.detail}</span>}
                </div>
```

In `src/components/Overlay/OverlayView.css`, replace lines 149–150:

```css
.overlay-tool-name { flex: 0 0 auto; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.overlay-tool-detail { flex: 1; min-width: 0; color: var(--text-muted, #8b949e); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

(The `.overlay-tool-status` rule is now unused — delete it.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run --project unit`
Expected: clean, all pass (the type change is additive; no other OverlayTailItem consumers break — verify with `grep -rn "kind: 'tool'" src tests`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlayFeed.ts src/App.tsx src/components/Overlay/OverlayView.tsx src/components/Overlay/OverlayView.css
git commit -m "feat(overlay): tool cards show inline action detail"
```

---

### Task 3: Verification

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run` — all pass.
- [ ] **Step 2:** Manual (needs app restart): trigger a turn with tool calls in a background workspace; overlay tool rows read like "Bash  npm test", "Edit  …/Chat/ChatPanel.tsx" with no "running/done" word; the dot still pulses gold → green.
- [ ] **Step 3:** Commit fixups if any.
