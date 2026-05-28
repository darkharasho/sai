# PWA Workspace Picker Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the PWA workspace picker (`WorkspaceHeader.tsx`) to visual parity with the desktop `TitleBar` picker — squircle status dots, the same animations, approval/completed badges, and a Projects/Meta tab split.

**Architecture:** Single-file refactor of `src/renderer-remote/chat/WorkspaceHeader.tsx`. The component owns its `<style>` block (renderer-remote is a separate bundle), so dot/animation CSS is lifted verbatim from `TitleBar.tsx`. `DOT_MASK_URL` from `src/lib/assets.ts` is imported directly. The merged `busy` priority (`busy || streaming || awaitingQuestion`) is computed locally; the shared `workspaceStatusStore` priority resolver is **not** touched.

**Tech Stack:** React + TypeScript, lucide-react icons, inline `<style>` CSS, CSS mask via data-URI SVG.

**Reference files:**
- Spec: `docs/superpowers/specs/2026-05-26-pwa-workspace-picker-redesign-design.md`
- Source of CSS to lift: `src/components/TitleBar.tsx` (lines 848–1244 for the relevant classes)
- Mask asset: `src/lib/assets.ts`
- Status store types: `src/renderer-remote/lib/workspaceStatusStore.ts`
- Wire types (workspace shape): `electron/services/remote/renderer-proxy.ts` (`RemoteWorkspace`)

---

## File Structure

**Modified:**
- `src/renderer-remote/chat/WorkspaceHeader.tsx` — rewrite `StatusDot`, add tabs, badges, and scoped CSS.

**Not modified (but referenced):**
- `src/lib/assets.ts` — `DOT_MASK_URL` import.
- `src/renderer-remote/lib/workspaceStatusStore.ts` — `WorkspaceStatus` shape (read fields directly for merged-busy detection).

---

## Task 1: Wire up imports and merged-busy helper

**Files:**
- Modify: `src/renderer-remote/chat/WorkspaceHeader.tsx` (top of file)

- [ ] **Step 1: Add the `DOT_MASK_URL` import**

At the top of the file, after the existing `import type { WorkspaceStatus, WorkspaceStatusStore } from '../lib/workspaceStatusStore';` line, add:

```tsx
import { DOT_MASK_URL } from '../../lib/assets';
```

- [ ] **Step 2: Add a local priority helper that merges `streaming` + `awaitingQuestion` into `busy`**

Replace the existing `StatusDot` function (lines ~21–40) entirely. For now, just stub it so the file still compiles — the full implementation comes in Task 2. Insert above the existing `StatusDot`:

```tsx
type DisplayPriority = 'idle' | 'busy' | 'completed' | 'approval';

function displayPriority(status: WorkspaceStatus | undefined): DisplayPriority {
  if (!status) return 'idle';
  if (status.approval) return 'approval';
  if (status.busy || status.streaming || status.awaitingQuestion) return 'busy';
  if (status.completed) return 'completed';
  return 'idle';
}
```

- [ ] **Step 3: Verify the file still type-checks**

Run: `npx tsc --noEmit -p tsconfig.json` from the repo root.
Expected: no new errors related to `WorkspaceHeader.tsx`. (Pre-existing errors elsewhere are fine — only check this file.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer-remote/chat/WorkspaceHeader.tsx
git commit -m "refactor(pwa): add merged-busy priority helper for workspace picker"
```

---

## Task 2: Rewrite `StatusDot` to use squircle mask + animations

**Files:**
- Modify: `src/renderer-remote/chat/WorkspaceHeader.tsx`

- [ ] **Step 1: Replace the `StatusDot` body**

Delete the existing `StatusDot` function entirely. In its place, insert:

```tsx
interface StatusDotProps {
  status: WorkspaceStatus | undefined;
  /** When true, render a green squircle even if priority is 'idle' (used for current/active workspace rows). */
  activeIdle?: boolean;
  /** When true, render a gold squircle in idle state (used for suspended rows). */
  suspendedIdle?: boolean;
}

function StatusDot({ status, activeIdle, suspendedIdle }: StatusDotProps) {
  const p = displayPriority(status);

  if (p === 'approval') {
    return <span className="ws-dot ws-dot-approval" title="approval needed" />;
  }
  if (p === 'busy') {
    return <span className="ws-dot ws-dot-busy" title="working" />;
  }
  if (p === 'completed') {
    return <span className="ws-dot ws-dot-completed" title="completed" />;
  }
  if (activeIdle) {
    return <span className="ws-dot ws-dot-active" title="active" />;
  }
  if (suspendedIdle) {
    return <span className="ws-dot ws-dot-suspended" title="suspended" />;
  }
  return null;
}
```

- [ ] **Step 2: Add the matching CSS block at the bottom of the component**

The component currently has no `<style>` block. Add one just before the closing `</div>` of the outer container — i.e. between the `{open && (...)}` block and the closing `</div>` of `containerRef`. Use:

```tsx
<style>{`
  .ws-dot {
    display: inline-block;
    flex-shrink: 0;
    width: 9px;
    height: 9px;
  }
  .ws-dot-active {
    background: #4ade80;
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
  }
  .ws-dot-busy {
    background: var(--accent);
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    animation: ws-spinner-pulse 2.2s ease-in-out infinite;
  }
  .ws-dot-completed {
    background: #4ade80;
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    animation: ws-done-pulse 2s ease-in-out infinite;
  }
  .ws-dot-suspended {
    background: #d4a72c;
    -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
    mask: url("${DOT_MASK_URL}") center / contain no-repeat;
  }
  .ws-dot-approval {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #f59e0b;
    animation: ws-approval-blink 1s ease-in-out infinite;
  }
  @keyframes ws-spinner-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.35; transform: scale(0.75); }
  }
  @keyframes ws-done-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  @keyframes ws-approval-blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.2; }
  }
`}</style>
```

(Class names are prefixed `ws-` to avoid colliding with desktop's identically-named globals in any shared CSS scope.)

- [ ] **Step 3: Update both call sites to pass the new props**

There are two `<StatusDot ... />` call sites in the file: the trigger button (~line 136 in current file) and the row renderer (~line 269). Update them as follows.

**Trigger button** (the call inside the header `<button>`):

Replace:
```tsx
<StatusDot status={current ? statusStore.get(current.projectPath) : undefined} store={statusStore} />
```
with:
```tsx
<StatusDot
  status={current ? statusStore.get(current.projectPath) : undefined}
  activeIdle={!!current}
/>
```

**Row renderer** (inside the `row` function in the dropdown):

Replace:
```tsx
<StatusDot status={statusStore.get(w.projectPath)} store={statusStore} />
```
with:
```tsx
<StatusDot
  status={statusStore.get(w.projectPath)}
  activeIdle={isActive}
  suspendedIdle={w.state === 'suspended'}
/>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `WorkspaceHeader.tsx`.

- [ ] **Step 5: Visual smoke-check**

Run the PWA. Open the workspace dropdown. Confirm:
- Current workspace shows a green squircle dot.
- A workspace with an in-flight turn shows the accent-colored squircle pulsing (scale + opacity).
- A workspace pending approval shows a small orange round dot blinking.
- A completed workspace shows a green squircle slow-pulsing.

If you cannot launch the PWA in your environment, note "manual visual check deferred" in the commit body and proceed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer-remote/chat/WorkspaceHeader.tsx
git commit -m "feat(pwa): squircle workspace status dots with desktop animations"
```

---

## Task 3: Add approval and completed badges to rows + trigger

**Files:**
- Modify: `src/renderer-remote/chat/WorkspaceHeader.tsx`

- [ ] **Step 1: Add badge CSS to the `<style>` block**

Inside the existing `<style>{...}</style>` block from Task 2, append (before the closing backtick):

```css
.ws-approval-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f59e0b;
  color: #000;
  font-size: 10px;
  font-weight: 800;
  flex-shrink: 0;
  animation: ws-approval-blink 1s ease-in-out infinite;
}
.ws-completed-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #4ade80;
  color: #000;
  font-size: 10px;
  font-weight: 800;
  flex-shrink: 0;
  animation: ws-done-pulse 2s ease-in-out infinite;
}
.ws-approval-label {
  font-size: 11px;
  color: #f59e0b;
  margin-left: 4px;
}
```

- [ ] **Step 2: Render badges in the row**

Inside the `row` function in the dropdown body (currently builds the per-workspace `<button>`), the structure is:

```tsx
<RowIcon ... />
<div style={{ flex: 1, minWidth: 0 }}>
  <div style={{ fontSize: 13, ... }}>{w.name}{w.kind === 'meta' && (<span>meta</span>)}</div>
  {w.kind === 'meta' && w.members ? <div>members...</div> : <div>path</div>}
</div>
<StatusDot ... />
```

Insert the badges **between** the name `<div>` (the one containing `{w.name}`) and the `<StatusDot ... />` at the end of the row. Replace the trailing `<StatusDot ... />` with:

```tsx
{(() => {
  const p = displayPriority(statusStore.get(w.projectPath));
  if (p === 'approval') {
    return (
      <>
        <span className="ws-approval-icon" title="Approval needed">!</span>
        <span className="ws-approval-label">Approval needed</span>
      </>
    );
  }
  if (p === 'completed') {
    return <span className="ws-completed-icon" title="Response complete">!</span>;
  }
  return (
    <StatusDot
      status={statusStore.get(w.projectPath)}
      activeIdle={isActive}
      suspendedIdle={w.state === 'suspended'}
    />
  );
})()}
```

This makes approval/completed render as a labeled badge instead of just a dot; busy/idle/suspended/active still render the dot.

- [ ] **Step 3: Apply the same treatment to the trigger button**

In the trigger button JSX, the current order near the end is:

```tsx
<StatusDot ... />
<ChevronDown ... />
```

Replace the `<StatusDot ... />` line with:

```tsx
{(() => {
  const p = displayPriority(current ? statusStore.get(current.projectPath) : undefined);
  if (p === 'approval') {
    return <span className="ws-approval-icon" title="Approval needed">!</span>;
  }
  if (p === 'completed') {
    return <span className="ws-completed-icon" title="Response complete">!</span>;
  }
  return (
    <StatusDot
      status={current ? statusStore.get(current.projectPath) : undefined}
      activeIdle={!!current}
    />
  );
})()}
```

(No label text in the trigger — space is tight.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `WorkspaceHeader.tsx`.

- [ ] **Step 5: Visual smoke-check**

Trigger an approval on a workspace from the desktop side; confirm the PWA dropdown row shows an orange `!` badge and the label "Approval needed". The header button also shows the orange `!` badge when the *current* workspace has approval pending. Trigger a completed state; confirm green `!` badge.

- [ ] **Step 6: Commit**

```bash
git add src/renderer-remote/chat/WorkspaceHeader.tsx
git commit -m "feat(pwa): approval and completed badges in workspace picker"
```

---

## Task 4: Add Projects / Meta tabs to the dropdown

**Files:**
- Modify: `src/renderer-remote/chat/WorkspaceHeader.tsx`

- [ ] **Step 1: Add `pickerTab` state**

In the component body, near the other `useState` calls (just below `const [open, setOpen] = useState(false);`), add:

```tsx
const [pickerTab, setPickerTab] = useState<'projects' | 'meta'>('projects');
```

- [ ] **Step 2: Add tab CSS**

Inside the existing `<style>` block, before the closing backtick, append:

```css
.ws-picker-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 4px 8px 0;
  gap: 2px;
}
.ws-picker-tabs button {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 12px;
  padding: 6px 8px;
  cursor: pointer;
  margin-bottom: -1px;
  border-radius: 4px 4px 0 0;
  transition: color 0.12s, background 0.12s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
}
.ws-picker-tabs button:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.ws-picker-tabs button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.ws-tab-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.ws-tab-indicator-approval { background: #f59e0b; animation: ws-approval-blink 1s ease-in-out infinite; }
.ws-tab-indicator-completed { background: #4ade80; }
.ws-tab-indicator-busy {
  width: 9px;
  height: 9px;
  background: var(--accent);
  -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
  mask: url("${DOT_MASK_URL}") center / contain no-repeat;
  display: inline-block;
  flex-shrink: 0;
  animation: ws-spinner-pulse 2.2s ease-in-out infinite;
}
```

- [ ] **Step 3: Add a tab-indicator helper above the JSX return**

Just before `const current = workspaces.find(...)`, insert:

```tsx
const tabIndicator = (kind: 'project' | 'meta'): JSX.Element | null => {
  const summary = workspaces
    .filter((w) => w.kind === kind)
    .map((w) => displayPriority(statusStore.get(w.projectPath)));
  if (summary.includes('approval')) {
    return <span className="ws-tab-indicator-dot ws-tab-indicator-approval" title="Approval needed" />;
  }
  if (summary.includes('completed')) {
    return <span className="ws-tab-indicator-dot ws-tab-indicator-completed" title="Response complete" />;
  }
  if (summary.includes('busy')) {
    return <span className="ws-tab-indicator-busy" title="Working..." />;
  }
  return null;
};
```

- [ ] **Step 4: Render the tab strip inside the dropdown**

Inside the `{open && (<div ...dropdown...>)}` block, immediately after the opening `<div ...>` (i.e. before the existing `loading`/`err`/`workspaces.length === 0` checks), insert:

```tsx
<div className="ws-picker-tabs">
  <button
    className={pickerTab === 'projects' ? 'active' : ''}
    onClick={() => setPickerTab('projects')}
  >
    Projects{tabIndicator('project')}
  </button>
  <button
    className={pickerTab === 'meta' ? 'active' : ''}
    onClick={() => setPickerTab('meta')}
  >
    Meta{tabIndicator('meta')}
  </button>
</div>
```

- [ ] **Step 5: Filter the listed workspaces by `pickerTab`**

The dropdown body currently does (paraphrased):

```tsx
const active = workspaces.filter((w) => w.state === 'active' || (!w.state && w.projectPath === currentProjectPath));
const open = workspaces.filter((w) => w.state === 'open');
const suspended = workspaces.filter((w) => w.state === 'suspended');
const recent = workspaces.filter((w) => w.state === 'recent');
```

Replace those four lines with:

```tsx
const wantKind: 'project' | 'meta' = pickerTab === 'meta' ? 'meta' : 'project';
const visible = workspaces.filter((w) => w.kind === wantKind);
const active = visible.filter((w) => w.state === 'active' || (!w.state && w.projectPath === currentProjectPath));
const open = visible.filter((w) => w.state === 'open');
const suspended = visible.filter((w) => w.state === 'suspended');
const recent = visible.filter((w) => w.state === 'recent');
```

- [ ] **Step 6: Empty-state for Meta tab**

After the four `filter` lines above, insert (still inside the same IIFE):

```tsx
const isEmptyMeta = pickerTab === 'meta' && visible.length === 0 && !loading && !err;
```

Then, in the JSX return at the end of the IIFE (currently `return (<>...sections...</>);`), wrap with an empty-state branch:

```tsx
return (
  <>
    {isEmptyMeta && (
      <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
        No meta workspaces open on desktop.
      </div>
    )}
    {!isEmptyMeta && active.length > 0 && (<>{sectionLabel('Active')}{active.map(row)}</>)}
    {!isEmptyMeta && open.length > 0 && (<>{sectionLabel('Open')}{open.map(row)}</>)}
    {!isEmptyMeta && suspended.length > 0 && (<>{sectionLabel('Suspended')}{suspended.map(row)}</>)}
    {!isEmptyMeta && recent.length > 0 && (<>{sectionLabel('Recent')}{recent.map(row)}</>)}
  </>
);
```

- [ ] **Step 7: Hide the global "No workspaces open on desktop" message when on Meta tab**

The dropdown body has, before the IIFE, a fallback:

```tsx
{!loading && !err && workspaces.length === 0 && (
  <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
    No workspaces open on desktop.
  </div>
)}
```

Leave this alone — it correctly fires only when the desktop has reported zero workspaces of any kind. The meta-specific empty state from Step 6 fires when desktop has projects but no metas.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `WorkspaceHeader.tsx`.

- [ ] **Step 9: Visual smoke-check**

Open the dropdown. Confirm:
- Two tabs at the top: Projects (default active) and Meta.
- Switching to Meta shows only meta workspaces; switching back shows only projects.
- If a meta workspace is busy while Projects is selected, a pulsing accent squircle appears next to the "Meta" tab label (and vice versa for project activity).
- With no meta workspaces open on desktop, selecting Meta shows the empty-state message.

- [ ] **Step 10: Commit**

```bash
git add src/renderer-remote/chat/WorkspaceHeader.tsx
git commit -m "feat(pwa): Projects/Meta tab split in workspace picker"
```

---

## Task 5: Verification pass

**Files:** none (validation only)

- [ ] **Step 1: Run the existing unit tests that touch workspace status**

Run:
```bash
npx vitest run tests/unit/remote/workspace-status-store.test.ts tests/unit/remote/bridge-server-workspace-status.test.ts
```
Expected: all pass (these don't depend on the UI changes, but confirm we haven't broken the shape they rely on).

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Manual checklist**

In a running app (desktop + PWA paired):
- [ ] Trigger button on the PWA shows a green squircle when current workspace is idle.
- [ ] Sending a chat turn from the PWA makes the trigger dot pulse (accent squircle, scale + opacity).
- [ ] When the turn completes, dot turns green and slow-pulses; opening the workspace, badge clears (per existing logic in status store).
- [ ] Triggering an approval from the desktop makes the trigger show an orange round `!` badge, blinking. Same workspace's row in the dropdown shows badge + "Approval needed" label.
- [ ] Suspended workspaces in the dropdown show a gold squircle.
- [ ] Recent workspaces show no dot.
- [ ] Meta tab indicator dot appears on the non-selected tab when activity happens there.
- [ ] Empty Meta tab message renders when desktop has no metas.

- [ ] **Step 4: No commit required** (verification only)

---

## Self-Review

**Spec coverage:**
- Visual mapping table → Task 2 (StatusDot) + Task 3 (badges).
- Trigger button treatment → Task 2 Step 3 + Task 3 Step 3.
- Dropdown structure (tabs, sections, empty Meta) → Task 4.
- Out-of-scope items (overflow menu, "+ New Meta") → correctly omitted.
- Inline `<style>` self-contained, `DOT_MASK_URL` imported from `../../lib/assets` → Task 1 Step 1 + Task 2 Step 2.
- `busy` merged via local helper, store untouched → Task 1 Step 2.

**Placeholder scan:** no TBD/TODO/etc. All code shown inline; all class names defined in the same plan; all behaviors specified concretely.

**Type consistency:** `displayPriority` returns `DisplayPriority` (`'idle' | 'busy' | 'completed' | 'approval'`); all four are handled at every call site. `StatusDotProps` defined once, used twice with the documented prop set. CSS class names (`ws-dot`, `ws-dot-busy`, etc.) defined in Task 2 and reused — no drift.
