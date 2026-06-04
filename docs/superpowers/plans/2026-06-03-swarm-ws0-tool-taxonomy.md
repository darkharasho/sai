# Swarm WS0 — Canonical Tool Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three divergent swarm tool-name vocabularies with one canonical taxonomy that matches the *actual* provider tool names, fixing the bug where `auto-read` silently degrades to `always-ask` and `materializeIfNeeded` mis-classifies real write tools.

**Architecture:** Add one pure module `src/lib/swarmToolTaxonomy.ts` that classifies provider tool names case-insensitively as `read`/`write`/`other`, accepting both the real capitalized names (`Read`, `Edit`, `Bash`, …) and the legacy snake_case aliases already in the codebase. Rewire `swarmApprovalPolicy.ts`, `swarmScheduler.ts`, and `ApprovalTray.tsx` to consume it. This is WS0 of the swarm hardening spec (`docs/superpowers/specs/2026-06-03-swarm-hardening-design.md`) and unblocks WS3/WS4.

**Tech Stack:** TypeScript, Vitest (run with `--maxWorkers=2`), React + Testing Library (jsdom) for the tray test. Path alias `@/` → `src/`.

---

## Background the engineer needs

The Claude provider emits tool names in `approval_needed` events as the raw capitalized
names: `Read`, `Grep`, `Glob`, `LS`, `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `Bash`,
`WebFetch`, `WebSearch` (see `electron/services/claude.ts:341,345,799`). Three places try to
classify tools but use mismatched, mostly snake_case vocabularies:

- `src/lib/swarmApprovalPolicy.ts:3` — `READ_TOOLS = {read_file, list_files, grep, glob, search}`
- `src/lib/swarmScheduler.ts:3` — `WRITE_TOOLS = {edit_file, write_file, apply_patch, str_replace, create_file, bash}`
- `src/components/Swarm/ApprovalTray.tsx:20` — `READ_TOOLS = {read, Read, view, View, cat}`

Because none match `Read`/`Edit`/etc., `shouldRequireApproval('auto-read','Read')` returns
`true` (reads are NOT auto-approved → `auto-read` behaves like `always-ask`), and
`isWriteTool('Edit')` returns `false` (a real edit doesn't trigger worktree materialization).

The fix: one case-insensitive taxonomy that knows the real names *and* keeps the legacy
aliases so existing behavior (and any snake_case providers) still classifies correctly.

## File Structure

- **Create** `src/lib/swarmToolTaxonomy.ts` — single source of truth for read/write classification.
- **Create** `tests/swarm/swarmToolTaxonomy.test.ts` — unit tests for the taxonomy.
- **Modify** `src/lib/swarmApprovalPolicy.ts` — `shouldRequireApproval` delegates to taxonomy; drop the local `READ_TOOLS`.
- **Modify** `tests/swarm/swarmApprovalPolicy.test.ts` — fix the test that pinned the wrong vocabulary; assert real names.
- **Modify** `src/lib/swarmScheduler.ts` — `isWriteTool` delegates to taxonomy; drop the local `WRITE_TOOLS`.
- **Modify** `tests/swarm/swarmScheduler.test.ts` — add a real-`Edit` materialization assertion (if the file lacks one).
- **Modify** `src/components/Swarm/ApprovalTray.tsx` — use `isReadTool` from taxonomy; drop the local `READ_TOOLS`.
- **Modify** `tests/swarm/ApprovalTray.test.tsx` — assert "approve all reads" shows for a real `Read` row.

---

## Task 1: Create the canonical tool taxonomy module

**Files:**
- Create: `src/lib/swarmToolTaxonomy.ts`
- Test: `tests/swarm/swarmToolTaxonomy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/swarm/swarmToolTaxonomy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyTool, isReadTool, isWriteTool } from '@/lib/swarmToolTaxonomy';

describe('swarmToolTaxonomy', () => {
  it('classifies real provider read tools', () => {
    for (const t of ['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead']) {
      expect(classifyTool(t)).toBe('read');
      expect(isReadTool(t)).toBe(true);
      expect(isWriteTool(t)).toBe(false);
    }
  });

  it('classifies real provider write tools', () => {
    for (const t of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash']) {
      expect(classifyTool(t)).toBe('write');
      expect(isWriteTool(t)).toBe(true);
      expect(isReadTool(t)).toBe(false);
    }
  });

  it('still classifies legacy snake_case aliases', () => {
    expect(classifyTool('read_file')).toBe('read');
    expect(classifyTool('list_files')).toBe('read');
    expect(classifyTool('search')).toBe('read');
    expect(classifyTool('edit_file')).toBe('write');
    expect(classifyTool('write_file')).toBe('write');
    expect(classifyTool('apply_patch')).toBe('write');
    expect(classifyTool('str_replace')).toBe('write');
    expect(classifyTool('create_file')).toBe('write');
    expect(classifyTool('bash')).toBe('write');
  });

  it('is case-insensitive', () => {
    expect(classifyTool('read')).toBe('read');
    expect(classifyTool('EDIT')).toBe('write');
    expect(classifyTool('bAsH')).toBe('write');
  });

  it('returns "other" for unknown tools and falsy input', () => {
    expect(classifyTool('AskUserQuestion')).toBe('other');
    expect(classifyTool('')).toBe('other');
    expect(classifyTool(undefined as unknown as string)).toBe('other');
    expect(isReadTool('AskUserQuestion')).toBe(false);
    expect(isWriteTool('AskUserQuestion')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/swarmToolTaxonomy.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve module `@/lib/swarmToolTaxonomy`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/swarmToolTaxonomy.ts`:

```typescript
/**
 * Single source of truth for classifying provider tool-call names as read-only
 * vs writing. Matches the real capitalized names the Claude provider emits in
 * `approval_needed` events (Read, Edit, Bash, …) AND the legacy snake_case
 * aliases that older code/providers used. Matching is case-insensitive.
 *
 * Consumed by:
 *  - swarmApprovalPolicy.shouldRequireApproval (auto-read auto-approves reads)
 *  - swarmScheduler.isWriteTool (materialize a worktree before the first write)
 *  - ApprovalTray (the "approve all reads" affordance)
 */
export type ToolClass = 'read' | 'write' | 'other';

// All entries are lowercase; lookups lowercase the input.
const READ_NAMES = new Set<string>([
  // real provider names
  'read', 'grep', 'glob', 'ls', 'webfetch', 'websearch', 'notebookread', 'todoread',
  // legacy aliases
  'read_file', 'list_files', 'search', 'view', 'cat',
]);

const WRITE_NAMES = new Set<string>([
  // real provider names
  'edit', 'multiedit', 'write', 'notebookedit', 'bash',
  // legacy aliases
  'edit_file', 'write_file', 'apply_patch', 'str_replace', 'create_file',
]);

export function classifyTool(name: string): ToolClass {
  if (!name || typeof name !== 'string') return 'other';
  const n = name.toLowerCase();
  if (READ_NAMES.has(n)) return 'read';
  if (WRITE_NAMES.has(n)) return 'write';
  return 'other';
}

export function isReadTool(name: string): boolean {
  return classifyTool(name) === 'read';
}

export function isWriteTool(name: string): boolean {
  return classifyTool(name) === 'write';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/swarmToolTaxonomy.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmToolTaxonomy.ts tests/swarm/swarmToolTaxonomy.test.ts
git commit -m "feat(swarm): canonical tool taxonomy matching real provider names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewire approval policy to the taxonomy

**Files:**
- Modify: `src/lib/swarmApprovalPolicy.ts`
- Test: `tests/swarm/swarmApprovalPolicy.test.ts`

- [ ] **Step 1: Update the test to pin correct behavior**

Replace the entire contents of `tests/swarm/swarmApprovalPolicy.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { shouldRequireApproval } from '@/lib/swarmApprovalPolicy';

describe('shouldRequireApproval', () => {
  it('auto-read auto-approves real read tools', () => {
    expect(shouldRequireApproval('auto-read', 'Read')).toBe(false);
    expect(shouldRequireApproval('auto-read', 'Grep')).toBe(false);
    expect(shouldRequireApproval('auto-read', 'Glob')).toBe(false);
  });

  it('auto-read pauses on real write tools', () => {
    expect(shouldRequireApproval('auto-read', 'Edit')).toBe(true);
    expect(shouldRequireApproval('auto-read', 'Write')).toBe(true);
    expect(shouldRequireApproval('auto-read', 'Bash')).toBe(true);
  });

  it('auto-read still handles legacy snake_case names', () => {
    expect(shouldRequireApproval('auto-read', 'read_file')).toBe(false);
    expect(shouldRequireApproval('auto-read', 'bash')).toBe(true);
  });

  it('always-ask pauses on everything, including reads', () => {
    expect(shouldRequireApproval('always-ask', 'Read')).toBe(true);
  });

  it('auto never pauses', () => {
    expect(shouldRequireApproval('auto', 'Bash')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/swarmApprovalPolicy.test.ts --maxWorkers=2`
Expected: FAIL — `shouldRequireApproval('auto-read','Read')` returns `true` (current `READ_TOOLS` doesn't contain `Read`).

- [ ] **Step 3: Update the implementation**

Replace the entire contents of `src/lib/swarmApprovalPolicy.ts` with:

```typescript
import type { ApprovalPolicy } from '../types';
import { isReadTool } from './swarmToolTaxonomy';

export function shouldRequireApproval(policy: ApprovalPolicy, toolName: string): boolean {
  if (policy === 'auto') return false;
  if (policy === 'always-ask') return true;
  // auto-read: auto-approve reads, pause on anything that isn't a known read.
  return !isReadTool(toolName);
}
```

Note: the local `READ_TOOLS` export is removed. Step 4 confirms no other module imports it.

- [ ] **Step 4: Verify no remaining importers of the removed `READ_TOOLS`**

Run: `grep -rn "READ_TOOLS" src/lib/swarmApprovalPolicy.ts; grep -rn "from '@/lib/swarmApprovalPolicy'\|from '../lib/swarmApprovalPolicy'\|swarmApprovalPolicy" src tests --include="*.ts" --include="*.tsx"`
Expected: only `shouldRequireApproval` imports remain; no import of `READ_TOOLS` from `swarmApprovalPolicy`. If any are found, that file imports `isReadTool` from `@/lib/swarmToolTaxonomy` instead.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/swarmApprovalPolicy.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/swarmApprovalPolicy.ts tests/swarm/swarmApprovalPolicy.test.ts
git commit -m "fix(swarm): auto-read auto-approves real provider read tools

shouldRequireApproval now delegates to the canonical taxonomy, so auto-read
no longer degrades to always-ask for Read/Grep/Glob.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Rewire scheduler write-classification to the taxonomy

**Files:**
- Modify: `src/lib/swarmScheduler.ts:3-6`
- Test: `tests/swarm/swarmScheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/swarm/swarmScheduler.test.ts` (append inside the file, after the existing imports/tests). It asserts a real `Edit` triggers worktree materialization:

```typescript
import { materializeIfNeeded } from '@/lib/swarmScheduler';

describe('materializeIfNeeded — real provider tool names', () => {
  const baseTask = {
    id: 't1', workspaceId: '/ws', sessionId: 's1', title: 't', prompt: 'p',
    provider: 'claude' as const, model: 'm', approvalPolicy: 'auto-read' as const,
    status: 'streaming' as const, branch: 'swarm/t1', baseBranch: 'main',
    worktreePath: null, projectPath: '/ws', createdAt: 0, lastActivityAt: 0,
    costEstimate: 0, toolCallCount: 0,
  };

  it('materializes a worktree for a real Edit tool', async () => {
    const worktreeAdd = vi.fn().mockResolvedValue('/ws/.sai-swarm/t1');
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const wt = await materializeIfNeeded(baseTask, 'Edit', { worktreeAdd, updateTask });
    expect(worktreeAdd).toHaveBeenCalledTimes(1);
    expect(wt).toBe('/ws/.sai-swarm/t1');
  });

  it('does NOT materialize for a real Read tool', async () => {
    const worktreeAdd = vi.fn().mockResolvedValue('/ws/.sai-swarm/t1');
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const wt = await materializeIfNeeded(baseTask, 'Read', { worktreeAdd, updateTask });
    expect(worktreeAdd).not.toHaveBeenCalled();
    expect(wt).toBeNull();
  });
});
```

Note: ensure `vi` is imported at the top of the test file (`import { describe, it, expect, vi } from 'vitest';`). If the existing file imports only `describe, it, expect`, add `vi`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/swarmScheduler.test.ts --maxWorkers=2`
Expected: FAIL — the `Edit` case calls `worktreeAdd` 0 times (current `WRITE_TOOLS` has `edit_file`, not `Edit`).

- [ ] **Step 3: Update the implementation**

In `src/lib/swarmScheduler.ts`, replace lines 1-6 (the import, `WRITE_TOOLS` set, and `isWriteTool` function):

```typescript
import type { SwarmTask } from '../types';
import { isWriteTool } from './swarmToolTaxonomy';

export { isWriteTool };
```

Leave the rest of the file (`isLikelyReadOnlyPrompt`, `materializeIfNeeded`, `SwarmScheduler`) unchanged — `materializeIfNeeded` already calls `isWriteTool(toolName)`, which now resolves to the taxonomy version.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/swarmScheduler.test.ts --maxWorkers=2`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmScheduler.ts tests/swarm/swarmScheduler.test.ts
git commit -m "fix(swarm): worktree materialization keys off canonical write tools

isWriteTool now recognizes real provider names (Edit, Write, Bash), so a real
Edit triggers lazy worktree creation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Rewire ApprovalTray to the taxonomy

**Files:**
- Modify: `src/components/Swarm/ApprovalTray.tsx:20,78`
- Test: `tests/swarm/ApprovalTray.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/swarm/ApprovalTray.test.tsx` inside the `describe('ApprovalTray', …)` block:

```typescript
  it('shows "approve all reads" for a real Read tool row', () => {
    const reads = [{
      id: 'r1', taskId: 't1', taskTitle: 'inspect config',
      toolName: 'Read', command: 'cat config.json', createdAt: 1,
    }];
    const onApproveAllReads = vi.fn();
    render(
      <ApprovalTray
        approvals={reads}
        onApprove={() => {}}
        onDeny={() => {}}
        onApproveAllReads={onApproveAllReads}
        onDenyAll={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /approve all reads/i });
    fireEvent.click(btn);
    expect(onApproveAllReads).toHaveBeenCalled();
  });
```

Note: this assumes the "approve all reads" control renders with accessible text matching
`/approve all reads/i`. Before relying on the exact matcher, open `src/components/Swarm/ApprovalTray.tsx`
(the JSX after line 90) and confirm the button's label; adjust the `name` regex to the actual
text if it differs (e.g. `/approve reads/i`). The behavioral assertion (button present + fires
`onApproveAllReads` when a `Read` row exists) is what matters.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/ApprovalTray.test.tsx --maxWorkers=2`
Expected: FAIL — `hasReads` is `false` for `toolName: 'Read'`? Note current local set DOES contain `'Read'`, so this specific case may already pass. The real gap is `Grep`/`Glob`. If the `Read` case passes, change `toolName` to `'Grep'` in this test — the current local set lacks `Grep`, so it will fail until rewired.

- [ ] **Step 3: Update the implementation**

In `src/components/Swarm/ApprovalTray.tsx`:

Add to the imports at the top (after `import React from 'react';`):

```typescript
import { isReadTool } from '../../lib/swarmToolTaxonomy';
```

Delete line 20 (`const READ_TOOLS = new Set(['read', 'Read', 'view', 'View', 'cat']);`).

Change line 78 from:

```typescript
  const hasReads = approvals.some(a => READ_TOOLS.has(a.toolName));
```

to:

```typescript
  const hasReads = approvals.some(a => isReadTool(a.toolName));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/ApprovalTray.test.tsx --maxWorkers=2`
Expected: PASS (existing 2 tests + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/Swarm/ApprovalTray.tsx tests/swarm/ApprovalTray.test.tsx
git commit -m "fix(swarm): ApprovalTray read detection uses canonical taxonomy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full swarm suite green + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full swarm test suite**

Run: `npx vitest run tests/swarm --maxWorkers=2`
Expected: PASS — all swarm tests, including the three rewired files and the new taxonomy file.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `tsc` is not the project's check command, use the script in `package.json`, e.g. `npm run typecheck` or `npm run build` — check `package.json` scripts first.)

- [ ] **Step 3: Confirm no orphaned vocabularies remain**

Run: `grep -rn "new Set(\['read\|new Set(\['edit_file\|WRITE_TOOLS\|READ_TOOLS" src --include="*.ts" --include="*.tsx"`
Expected: no swarm tool-name vocabulary sets remain outside `src/lib/swarmToolTaxonomy.ts`. (`READ_TOOLS`/`WRITE_TOOLS` should no longer be defined in `swarmApprovalPolicy.ts`, `swarmScheduler.ts`, or `ApprovalTray.tsx`.)

- [ ] **Step 4: Commit (only if Step 2/3 required follow-up edits)**

```bash
git add -A
git commit -m "chore(swarm): WS0 cleanup — single tool taxonomy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** This plan implements WS0 in full (canonical taxonomy + rewire of all three
  vocabularies + the documented WS0 tests). WS1–WS6 are separate plans (one per workstream, per
  the spec's independent-workstream structure).
- **Type consistency:** `classifyTool` / `isReadTool` / `isWriteTool` signatures are used
  identically across Tasks 1–4. `swarmScheduler.ts` re-exports `isWriteTool` so its existing
  `materializeIfNeeded` caller and the `WRITE_TOOLS`→taxonomy swap stay source-compatible.
- **No placeholders:** every code step shows complete code; Task 4 Step 1/2 flags the one
  label-dependent matcher to verify against the live JSX.
