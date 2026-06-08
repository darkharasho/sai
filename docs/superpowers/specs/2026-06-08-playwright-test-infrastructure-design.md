# Playwright Test Infrastructure Design

**Date:** 2026-06-08
**Status:** Approved

## Problem

UI changes are verified manually: a change is made, someone navigates to the right state, and describes what they see. This is slow and misses regressions. The existing Playwright suite can fire IPC events but cannot drive the app into a known state deterministically — making it impractical to write targeted UI behavior tests.

## Goals

- Enable targeted Playwright tests that assert DOM structure and behavior for specific app states
- Enable isolated component tests (render one component in a known prop state, assert its structure and appearance)
- Establish a canonical pattern all future Playwright tests follow
- Validate the whole stack with a first deliverable: the workspace squircle busy-done scenario

## Architecture

Two complementary layers:

**1. `window.__saiTest` bridge** — drives full-app state from Playwright
**2. `/test-harness` route** — renders components in isolation for component-level tests

Both are gated on `import.meta.env.DEV` and never ship in production builds.

---

## Layer 1: `window.__saiTest` Bridge

### Purpose

Allows Playwright tests to put the full app into a specific state without chaining IPC event sequences. Exposes semantic scenario methods rather than raw setState callbacks.

### Interface

Exposed via a `useEffect` in `src/App.tsx`, gated on `import.meta.env.DEV`:

```ts
interface SaiTestBridge {
  // Workspace state
  addWorkspace(id: string, path: string): void;
  setWorkspaceBusy(id: string): void;    // marks session as streaming/running
  setWorkspaceDone(id: string): void;    // marks session as completed/unread
  setWorkspaceIdle(id: string): void;    // clears busy and done flags
  clearWorkspaces(): void;

  // Read-back for assertions
  getOverallStatus(): 'approval' | 'done' | 'busy' | 'busy-done' | null;
  getState(): {
    busyWorkspaces: string[];
    completedWorkspaces: string[];
  };
}

declare global {
  interface Window {
    __saiTest?: SaiTestBridge;
  }
}
```

### State mapping

The bridge reads/writes the same state variables that compute `overallStatus` in App.tsx: `busyWorkspaces: Set<string>` and `completedWorkspaces: Set<string>`. No parallel state introduced.

`setWorkspaceBusy(id)` adds `id` to `busyWorkspaces` and removes it from `completedWorkspaces`.
`setWorkspaceDone(id)` adds `id` to `completedWorkspaces` and removes it from `busyWorkspaces`.
`setWorkspaceIdle(id)` removes `id` from both sets.

---

## Layer 2: `/test-harness` Route

### Purpose

Renders individual UI components in isolation with URL-controlled props. Allows fast, deterministic component-level tests without spinning up the full app.

### Route

`http://localhost:5173/test-harness?story=<name>&<prop>=<value>`

Mounted as a separate React entry point in `src/test-harness/index.tsx`. Vite dev server adds this route in dev mode only.

### Story registry

`src/test-harness/stories.ts` maps story names to components and prop factories:

```ts
export type Story = {
  component: React.ComponentType<any>;
  parseProps: (params: URLSearchParams) => Record<string, unknown>;
};

export const stories: Record<string, Story> = {
  'workspace-squircle': {
    component: WorkspaceSquircle,
    parseProps: (p) => ({ state: p.get('state') ?? 'inactive' }),
  },
  'navbar': {
    component: NavBar,
    parseProps: (p) => ({
      overallStatus: p.get('overallStatus') ?? null,
      activeSidebar: p.get('activeSidebar') ?? null,
    }),
  },
};
```

Adding a story for a new component is ~5 lines. Stories live in `src/test-harness/stories/` and are imported into the registry.

### Rendered output

The harness wraps the component in a `data-testid="harness-root"` container with neutral styling (transparent background, centered). Playwright tests locate components via this root.

---

## Layer 3: Playwright Fixtures

### `test.ts` — canonical import

`tests/e2e/test.ts` re-exports everything from `@playwright/test` plus the new fixtures. All test files import from here instead of directly from `@playwright/test`.

```ts
export { expect } from '@playwright/test';
export const test = base.extend<{ appState: AppStateFixture; harness: HarnessFixture }>({
  appState: ...,
  harness: ...,
});
```

Existing tests remain compatible — they can swap `@playwright/test` for `../test` without any other changes.

### `appState` fixture

Wraps `window.__saiTest` with typed async methods. Each call uses `page.evaluate()` and waits for the bridge to be available:

```ts
// Usage in tests:
await appState.addWorkspace('ws1', '/projects/alpha');
await appState.setWorkspaceBusy('ws1');
await appState.setWorkspaceDone('ws1');
const status = await appState.getOverallStatus(); // 'done'
```

### `harness` fixture

Navigates to the test harness route and returns a scoped locator for the rendered component:

```ts
// Usage in tests:
const el = await harness.render('workspace-squircle', { state: 'busy-done' });
await expect(el.locator('.ws-sq-busy')).toBeVisible();
await expect(el.locator('.ws-sq-inner')).toBeVisible();
await expect(el).toHaveScreenshot('squircle-busy-done.png');
```

`harness.render()` navigates, waits for `[data-testid="harness-root"]` to appear, then returns the locator for that element.

---

## Directory Structure

```
src/
  test-harness/
    index.tsx             # harness app entry, reads URL params, renders story
    stories.ts            # story registry
    stories/
      workspace-squircle.tsx
      navbar.tsx
      title-bar.tsx

tests/e2e/
  test.ts                 # canonical import: re-exports base + appState + harness
  fixtures/
    app-state.ts          # appState fixture implementation
    harness.ts            # harness fixture implementation
  screenshots/            # Playwright screenshot baselines (committed to git)
```

App.tsx changes: one `useEffect` block (~30 lines) for the bridge, gated on `import.meta.env.DEV`.

Vite config changes: one additional route entry for `/test-harness` in dev mode.

---

## First Deliverable

Validate the full stack with the workspace squircle scenario:

**Component test** (`tests/e2e/workspace-squircle.spec.ts`):
- Renders each of the 6 squircle states via the harness
- Asserts DOM structure (classes, element count)
- Takes a screenshot baseline for each state

**Integration test** (`tests/e2e/workspace-indicator.spec.ts`):
- Creates two workspaces via `appState`
- Sets both busy → asserts overall status is `busy`
- Sets one done → asserts overall status is `busy-done`
- Asserts NavBar renders `.ws-sq-busy-done-wrap` with `.ws-sq-busy` and `.ws-sq-inner` children
- Sets other done → asserts overall status is `done`

---

## Migration Path

Existing tests do not break. The new `test.ts` re-exports everything from `@playwright/test` so it is a drop-in replacement. Migration is opportunistic: when touching an existing test, swap the import and adopt the new fixtures where relevant. No big-bang rewrite required.

---

## What This Does Not Cover

- Unit tests (vitest/jsdom): the existing `renderWithProviders` + `installMockSai` pattern remains unchanged for unit tests; this design is Playwright-only
- Backend/IPC testing: integration tests in `tests/integration/` are unaffected
- Visual regression CI gates: screenshot baselines are committed but CI enforcement of diffs is a separate decision
