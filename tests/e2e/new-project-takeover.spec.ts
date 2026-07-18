import { test, expect } from './test';
import { triggerSaiEvent, waitForSaiSubscription } from './helpers/mock-events';

/**
 * E2E tests for the New Project takeover (brainstorm → live brief → create).
 *
 * The takeover is opened via:
 *   TitleBar project-selector (dropdown) > "New Project" button (data-testid="new-project-btn")
 *
 * Mock overrides wire up the brainstorm API so test callbacks can be fired
 * synchronously via triggerSaiEvent / waitForSaiSubscription.
 *
 * settingsGet is overridden to return a non-empty defaultProjectDir so the
 * Create button is enabled.
 */

test.use({
  saiMock: {
    // Return non-empty defaultProjectDir so "Create" is enabled.
    settingsGet: (key: string, defaultVal?: any) => {
      if (key === 'lastSeenVersion') return Promise.resolve((window as any).__APP_VERSION);
      if (key === 'defaultProjectDir') return Promise.resolve('/tmp/e2e-projects');
      return Promise.resolve(defaultVal ?? null);
    },
    brainstormStart: () => Promise.resolve({ sessionId: 'e2e-sid' }),
    brainstormSend: () => Promise.resolve({ ok: true }),
    brainstormEnd: () => Promise.resolve({ ok: true }),
    brainstormOnChunk: (sid: string, cb: any) => {
      (window as any).__saiTriggers = (window as any).__saiTriggers || {};
      (window as any).__saiTriggers['bs-chunk'] = cb;
      return () => {};
    },
    brainstormOnDone: (sid: string, cb: any) => {
      (window as any).__saiTriggers = (window as any).__saiTriggers || {};
      (window as any).__saiTriggers['bs-done'] = cb;
      return () => {};
    },
    brainstormOnError: (sid: string, cb: any) => {
      (window as any).__saiTriggers = (window as any).__saiTriggers || {};
      (window as any).__saiTriggers['bs-error'] = cb;
      return () => {};
    },
    brainstormOnBrief: (sid: string, cb: any) => {
      (window as any).__saiTriggers = (window as any).__saiTriggers || {};
      (window as any).__saiTriggers['bs-brief'] = cb;
      return () => {};
    },
    brainstormEditBrief: () => Promise.resolve({ ok: true }),
    scaffoldProject: (opts: any) => {
      (window as any).__scaffoldCall = opts;
      return Promise.resolve({ ok: true, warnings: [] });
    },
  },
});

/** Open the New Project takeover via the TitleBar dropdown. */
async function openNewProject(window: any): Promise<void> {
  const projectSelector = window.locator('.project-selector');
  await projectSelector.waitFor({ state: 'visible', timeout: 15000 });
  await projectSelector.click();

  const newProjectBtn = window.getByTestId('new-project-btn');
  await newProjectBtn.waitFor({ state: 'visible', timeout: 5000 });
  await newProjectBtn.click();
}

test('new project takeover opens and shows both panes', async ({ window: page }) => {
  await openNewProject(page);

  await expect(page.getByTestId('brief-pane')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('conversation-pane')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('brainstorm-composer')).toBeVisible({ timeout: 5000 });
});

test('brainstorm → live brief → create hands the brief to scaffold', async ({ window: page }) => {
  await openNewProject(page);

  // Brief pane should be visible
  await expect(page.getByTestId('brief-pane')).toBeVisible({ timeout: 5000 });

  // Type a message in the brainstorm composer and send it
  await page.getByTestId('brainstorm-composer').fill('a tool that sorts my downloads');
  await page.getByTestId('brainstorm-send-btn').click();

  // Wait for the subscriptions to be registered (the hook subscribes after brainstormStart)
  await waitForSaiSubscription(page, 'bs-brief');
  await waitForSaiSubscription(page, 'bs-done');

  // Fire a brief update from the "server"
  await triggerSaiEvent(page, 'bs-brief', {
    projectName: 'folder-janitor',
    summary: 'Sorts downloads by rules.',
    goals: ['Watch Downloads'],
    nonGoals: [],
    stack: [],
    openQuestions: ['Conflicts?'],
    ready: true,
  });

  // Fire the done event to end streaming
  await triggerSaiEvent(page, 'bs-done', 'The brief is ready — refine or create.');

  // Brief pane should reflect the received brief
  await expect(page.getByTestId('brief-name')).toContainText('folder-janitor', { timeout: 5000 });
  await expect(page.getByTestId('brief-ready-pill')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('brief-open-questions')).toContainText('Conflicts?', { timeout: 5000 });

  // Create button should be enabled (parentDir is set + brief has projectName + summary)
  const createBtn = page.getByTestId('create-project-btn');
  await expect(createBtn).toBeVisible({ timeout: 5000 });
  await expect(createBtn).not.toBeDisabled({ timeout: 3000 });

  await createBtn.click();

  // Verify scaffoldProject was called with the right brief
  await expect
    .poll(() => page.evaluate(() => (window as any).__scaffoldCall?.brief?.projectName), { timeout: 5000 })
    .toBe('folder-janitor');

  // Verify brainstorm transcript includes the user message
  const transcript = await page.evaluate(() => (window as any).__scaffoldCall?.brainstormTranscript);
  expect(transcript).toContain('a tool that sorts my downloads');
});
