# Playwright Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `window.__saiTest` bridge in App.tsx and a `/test-harness` component route so Playwright tests can drive full-app state and test components in isolation — validated with squircle component tests and workspace indicator integration tests.

**Architecture:** Three layers — (1) a dev-only bridge in App.tsx exposes semantic state setters via `window.__saiTest`; (2) a `/test-harness` Vite route renders components in isolation with URL-controlled props; (3) two new Playwright fixtures (`appState`, `harness`) wrap these layers, exported from a canonical `tests/e2e/test.ts` that replaces direct `@playwright/test` imports.

**Tech Stack:** React 18, Vite, Playwright, TypeScript

---

## File Map

**Created:**
- `src/test-harness/index.tsx` — harness app component, reads URL params, renders story
- `src/test-harness/stories.ts` — story registry (name → component + props factory)
- `src/test-harness/stories/workspace-squircle.tsx` — squircle story
- `tests/e2e/test.ts` — canonical test import: re-exports base fixtures + appState + harness
- `tests/e2e/fixtures/app-state.ts` — appState fixture (wraps window.__saiTest)
- `tests/e2e/fixtures/harness.ts` — harness fixture (navigates to /test-harness, returns locator)
- `tests/e2e/workspace-squircle.spec.ts` — component-level squircle tests
- `tests/e2e/workspace-indicator.spec.ts` — full-app indicator integration tests

**Modified:**
- `src/main.tsx` — mount harness app at `/test-harness` in dev mode instead of App
- `src/App.tsx` — add `window.__saiTest` bridge in a dev-only `useEffect` (~line 4347)
- `playwright.config.ts` — enable screenshot baseline storage

---

### Task 1: Add the `window.__saiTest` bridge to App.tsx

**Files:**
- Modify: `src/App.tsx` (after line 4346, before the `completedWorkspacesWithUnread` useMemo)

- [ ] **Step 1: Add the bridge useEffect**

Insert after line 4346 (after the `prevAwaitingRef` assignment line) in `src/App.tsx`:

```tsx
  // Dev-only test bridge — lets Playwright drive workspace state directly.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__saiTest = {
      setWorkspaceBusy: (id: string) => {
        setBusyWorkspaces(prev => new Set([...prev, id]));
        setCompletedWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
      },
      setWorkspaceDone: (id: string) => {
        setCompletedWorkspaces(prev => new Set([...prev, id]));
        setBusyWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
      },
      setWorkspaceIdle: (id: string) => {
        setBusyWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
        setCompletedWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
      },
      clearWorkspaces: () => {
        setBusyWorkspaces(new Set());
        setCompletedWorkspaces(new Set());
      },
      getOverallStatus: () => {
        if (busyWorkspaces.size > 0 && completedWorkspaces.size > 0) return 'busy-done';
        if (completedWorkspaces.size > 0) return 'done';
        if (busyWorkspaces.size > 0) return 'busy';
        return null;
      },
      getState: () => ({
        busyWorkspaces: [...busyWorkspaces],
        completedWorkspaces: [...completedWorkspaces],
      }),
    };
    return () => { delete window.__saiTest; };
  }, [busyWorkspaces, completedWorkspaces, setBusyWorkspaces, setCompletedWorkspaces]);
```

- [ ] **Step 2: Add the global type declaration**

At the top of `src/App.tsx`, after the existing imports, add:

```tsx
declare global {
  interface Window {
    __saiTest?: {
      setWorkspaceBusy(id: string): void;
      setWorkspaceDone(id: string): void;
      setWorkspaceIdle(id: string): void;
      clearWorkspaces(): void;
      getOverallStatus(): 'approval' | 'done' | 'busy' | 'busy-done' | null;
      getState(): { busyWorkspaces: string[]; completedWorkspaces: string[] };
    };
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx tsc --noEmit
```

Expected: no errors related to the new code.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add window.__saiTest bridge for Playwright state control"
```

---

### Task 2: Add the `/test-harness` route

**Files:**
- Create: `src/test-harness/stories/workspace-squircle.tsx`
- Create: `src/test-harness/stories.ts`
- Create: `src/test-harness/index.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create the squircle story**

Create `src/test-harness/stories/workspace-squircle.tsx`:

```tsx
import { WorkspaceSquircle } from '../../components/shared/WorkspaceSquircle';
import type { IndicatorState } from '../../lib/workspaceStatus';

export const workspaceSquircleStory = {
  component: WorkspaceSquircle,
  parseProps: (params: URLSearchParams) => ({
    state: (params.get('state') ?? 'inactive') as IndicatorState,
  }),
};
```

- [ ] **Step 2: Create the story registry**

Create `src/test-harness/stories.ts`:

```ts
import React from 'react';
import { workspaceSquircleStory } from './stories/workspace-squircle';

export type Story = {
  component: React.ComponentType<any>;
  parseProps: (params: URLSearchParams) => Record<string, unknown>;
};

export const stories: Record<string, Story> = {
  'workspace-squircle': workspaceSquircleStory,
};
```

- [ ] **Step 3: Create the harness app**

Create `src/test-harness/index.tsx`:

```tsx
import React from 'react';
import { stories } from './stories';

export function TestHarness() {
  const params = new URLSearchParams(window.location.search);
  const storyName = params.get('story');
  const story = storyName ? stories[storyName] : null;

  if (!story) {
    return (
      <div style={{ padding: 20, fontFamily: 'monospace', color: '#fff', background: '#111' }}>
        <h2>Test Harness</h2>
        <p>Available stories:</p>
        <ul>
          {Object.keys(stories).map(name => (
            <li key={name}>
              <a href={`/test-harness?story=${name}`} style={{ color: '#7cf' }}>{name}</a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const props = story.parseProps(params);
  const Component = story.component;

  return (
    <div
      data-testid="harness-root"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: '#1a1a1a',
      }}
    >
      <Component {...props} />
    </div>
  );
}
```

- [ ] **Step 4: Mount the harness in main.tsx**

Replace `src/main.tsx` with:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/fonts';
import './styles/globals.css';

const root = document.getElementById('root')!;

if (import.meta.env.DEV && window.location.pathname.startsWith('/test-harness')) {
  import('./test-harness').then(({ TestHarness }) => {
    ReactDOM.createRoot(root).render(<TestHarness />);
  });
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
```

- [ ] **Step 5: Verify the harness loads in the browser**

Start the dev server:
```bash
PLAYWRIGHT=1 npx vite
```

Navigate to `http://localhost:5173/test-harness?story=workspace-squircle&state=busy-done` in a browser. Expected: a dark background with a yellow squircle containing a white inner squircle.

Navigate to `http://localhost:5173/test-harness?story=workspace-squircle&state=busy`. Expected: a plain yellow squircle.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/test-harness/ src/main.tsx
git commit -m "feat: add /test-harness route for isolated component testing"
```

---

### Task 3: Create the Playwright fixtures

**Files:**
- Create: `tests/e2e/fixtures/app-state.ts`
- Create: `tests/e2e/fixtures/harness.ts`
- Create: `tests/e2e/test.ts`

- [ ] **Step 1: Create the appState fixture**

Create `tests/e2e/fixtures/app-state.ts`:

```ts
import type { Page } from '@playwright/test';

export interface AppStateFixture {
  setWorkspaceBusy(id: string): Promise<void>;
  setWorkspaceDone(id: string): Promise<void>;
  setWorkspaceIdle(id: string): Promise<void>;
  clearWorkspaces(): Promise<void>;
  getOverallStatus(): Promise<'approval' | 'done' | 'busy' | 'busy-done' | null>;
  getState(): Promise<{ busyWorkspaces: string[]; completedWorkspaces: string[] }>;
}

async function bridgeCall(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  await page.waitForFunction(() => typeof (window as any).__saiTest !== 'undefined', { timeout: 5000 });
  return page.evaluate(
    ([m, a]) => (window as any).__saiTest[m as string](...(a as unknown[])),
    [method, args] as const,
  );
}

export function createAppState(page: Page): AppStateFixture {
  return {
    setWorkspaceBusy:   (id) => bridgeCall(page, 'setWorkspaceBusy', id)   as Promise<void>,
    setWorkspaceDone:   (id) => bridgeCall(page, 'setWorkspaceDone', id)   as Promise<void>,
    setWorkspaceIdle:   (id) => bridgeCall(page, 'setWorkspaceIdle', id)   as Promise<void>,
    clearWorkspaces:    ()   => bridgeCall(page, 'clearWorkspaces')         as Promise<void>,
    getOverallStatus:   ()   => bridgeCall(page, 'getOverallStatus')        as Promise<'approval' | 'done' | 'busy' | 'busy-done' | null>,
    getState:           ()   => bridgeCall(page, 'getState')                as Promise<{ busyWorkspaces: string[]; completedWorkspaces: string[] }>,
  };
}
```

- [ ] **Step 2: Create the harness fixture**

Create `tests/e2e/fixtures/harness.ts`:

```ts
import type { Locator, Page } from '@playwright/test';

export interface HarnessFixture {
  render(story: string, props?: Record<string, string>): Promise<Locator>;
}

export function createHarness(page: Page): HarnessFixture {
  return {
    render: async (story, props = {}) => {
      const params = new URLSearchParams({ story, ...props });
      await page.goto(`http://localhost:5173/test-harness?${params}`);
      await page.waitForSelector('[data-testid="harness-root"]', { timeout: 10000 });
      return page.locator('[data-testid="harness-root"]');
    },
  };
}
```

- [ ] **Step 3: Create the canonical test export**

Create `tests/e2e/test.ts`:

```ts
import { test as electronTest, expect, type SaiMockOverrides } from './electron.setup';
import { createAppState, type AppStateFixture } from './fixtures/app-state';
import { createHarness, type HarnessFixture } from './fixtures/harness';

export { expect };
export type { SaiMockOverrides };

export const test = electronTest.extend<{
  appState: AppStateFixture;
  harness: HarnessFixture;
}>({
  // appState depends on `window` (full app with sai mock already loaded)
  appState: async ({ window }, use) => {
    await use(createAppState(window));
  },
  // harness uses `page` directly — navigates to /test-harness, no sai mock needed
  harness: async ({ page }, use) => {
    await use(createHarness(page));
  },
});
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/ tests/e2e/test.ts
git commit -m "feat: add appState and harness Playwright fixtures"
```

---

### Task 4: Configure Playwright screenshot baselines

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Enable screenshot storage**

Replace `playwright.config.ts` with:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  webServer: {
    command: 'PLAYWRIGHT=1 npx vite',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  snapshotDir: 'tests/e2e/screenshots',
});
```

- [ ] **Step 2: Create the screenshots directory**

```bash
mkdir -p tests/e2e/screenshots
echo '# Playwright screenshot baselines — committed to git' > tests/e2e/screenshots/README.md
```

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts tests/e2e/screenshots/
git commit -m "chore: configure Playwright screenshot baselines"
```

---

### Task 5: Write and baseline the squircle component tests

**Files:**
- Create: `tests/e2e/workspace-squircle.spec.ts`

- [ ] **Step 1: Write the component tests**

Create `tests/e2e/workspace-squircle.spec.ts`:

```ts
import { test, expect } from './test';

const STATES = ['inactive', 'alive', 'busy', 'done', 'approval', 'busy-done'] as const;

for (const state of STATES) {
  test(`squircle state=${state} is visible`, async ({ harness }) => {
    const el = await harness.render('workspace-squircle', { state });
    await expect(el).toBeVisible();
  });
}

test('busy-done squircle has wrapper class', async ({ harness }) => {
  const el = await harness.render('workspace-squircle', { state: 'busy-done' });
  const wrapper = el.locator('.ws-sq-busy-done-wrap');
  await expect(wrapper).toBeVisible();
});

test('busy-done squircle contains outer yellow span', async ({ harness }) => {
  const el = await harness.render('workspace-squircle', { state: 'busy-done' });
  const outer = el.locator('.ws-sq-busy-done-wrap .ws-sq-busy');
  await expect(outer).toBeVisible();
  await expect(outer).toHaveCount(1);
});

test('busy-done squircle contains inner white span', async ({ harness }) => {
  const el = await harness.render('workspace-squircle', { state: 'busy-done' });
  const inner = el.locator('.ws-sq-busy-done-wrap .ws-sq-inner');
  await expect(inner).toBeVisible();
  await expect(inner).toHaveCount(1);
});

test('non-busy-done squircles are a single span (no wrapper)', async ({ harness }) => {
  for (const state of ['inactive', 'alive', 'busy', 'done'] as const) {
    const el = await harness.render('workspace-squircle', { state });
    await expect(el.locator('.ws-sq-busy-done-wrap')).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Run the tests and create baselines**

```bash
npx playwright test tests/e2e/workspace-squircle.spec.ts --update-snapshots
```

Expected: all tests pass. Screenshot baselines written to `tests/e2e/screenshots/`.

- [ ] **Step 3: Run again without --update-snapshots to confirm baselines are stable**

```bash
npx playwright test tests/e2e/workspace-squircle.spec.ts
```

Expected: all tests pass with no diffs.

- [ ] **Step 4: Commit tests and baselines**

```bash
git add tests/e2e/workspace-squircle.spec.ts tests/e2e/screenshots/
git commit -m "test: add squircle component tests with screenshot baselines"
```

---

### Task 6: Write the workspace indicator integration tests

**Files:**
- Create: `tests/e2e/workspace-indicator.spec.ts`

- [ ] **Step 1: Write the integration tests**

Create `tests/e2e/workspace-indicator.spec.ts`:

```ts
import { test, expect } from './test';

test('no indicator shown when no workspaces are active', async ({ window }) => {
  await expect(window.locator('.nav-status-indicator')).toHaveCount(0);
});

test('busy indicator shown when one workspace is busy', async ({ window, appState }) => {
  await appState.setWorkspaceBusy('/projects/ws1');
  await expect(window.locator('.nav-status-indicator')).toBeVisible();
  await expect(window.locator('.nav-status-indicator .ws-sq-busy')).toBeVisible();
});

test('done indicator shown when workspace completes', async ({ window, appState }) => {
  await appState.setWorkspaceDone('/projects/ws1');
  await expect(window.locator('.nav-status-indicator .ws-sq-done')).toBeVisible();
});

test('busy-done indicator shown with mixed workspace states', async ({ window, appState }) => {
  await appState.setWorkspaceBusy('/projects/ws1');
  await appState.setWorkspaceDone('/projects/ws2');
  const wrapper = window.locator('.nav-status-indicator .ws-sq-busy-done-wrap');
  await expect(wrapper).toBeVisible();
  await expect(wrapper.locator('.ws-sq-busy')).toBeVisible();
  await expect(wrapper.locator('.ws-sq-inner')).toBeVisible();
});

test('overall status transitions: nothing → busy → busy-done → done → nothing', async ({ window, appState }) => {
  // nothing
  await expect(window.locator('.nav-status-indicator')).toHaveCount(0);

  // both busy
  await appState.setWorkspaceBusy('/projects/ws1');
  await appState.setWorkspaceBusy('/projects/ws2');
  expect(await appState.getOverallStatus()).toBe('busy');
  await expect(window.locator('.nav-status-indicator .ws-sq-busy')).toBeVisible();

  // one done → busy-done
  await appState.setWorkspaceDone('/projects/ws1');
  expect(await appState.getOverallStatus()).toBe('busy-done');
  await expect(window.locator('.nav-status-indicator .ws-sq-busy-done-wrap')).toBeVisible();

  // other done → done
  await appState.setWorkspaceDone('/projects/ws2');
  expect(await appState.getOverallStatus()).toBe('done');
  await expect(window.locator('.nav-status-indicator .ws-sq-done')).toBeVisible();

  // clear → nothing
  await appState.clearWorkspaces();
  expect(await appState.getOverallStatus()).toBeNull();
  await expect(window.locator('.nav-status-indicator')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the integration tests**

```bash
npx playwright test tests/e2e/workspace-indicator.spec.ts
```

Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/workspace-indicator.spec.ts
git commit -m "test: add workspace indicator integration tests"
```

---

### Task 7: Run the full Playwright suite to check for regressions

- [ ] **Step 1: Run all e2e tests**

```bash
npx playwright test
```

Expected: all existing tests continue to pass. New tests pass. No snapshot diffs.

- [ ] **Step 2: If any existing test imports directly from `@playwright/test`, note it**

```bash
grep -r "from '@playwright/test'" tests/e2e/ --include="*.ts" -l
```

These files can optionally be migrated to import from `./test` instead. This is not required now — migration is opportunistic.

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: verify Playwright suite passes after test infrastructure addition"
```
