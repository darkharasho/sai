import { test, expect } from './test';

const STATES = ['inactive', 'alive', 'busy', 'done', 'approval', 'busy-done'] as const;

for (const state of STATES) {
  test(`squircle state=${state} is visible`, async ({ harness }) => {
    const el = await harness.render('workspace-squircle', { state });
    await expect(el).toBeVisible();
  });
}

test('busy-done squircle is a single diagonal two-tone span', async ({ harness }) => {
  const el = await harness.render('workspace-squircle', { state: 'busy-done' });
  const sq = el.locator('.ws-sq-busy-done');
  await expect(sq).toBeVisible();
  await expect(sq).toHaveCount(1);
  // The old nested two-child structure is gone.
  await expect(el.locator('.ws-sq-busy-done-wrap')).toHaveCount(0);
  await expect(el.locator('.ws-sq-inner')).toHaveCount(0);
  // Diagonal gold→grey gradient fill.
  await expect(sq).toHaveCSS('background-image', /linear-gradient/);
});

test('every squircle state is a single span', async ({ harness }) => {
  for (const state of STATES) {
    const el = await harness.render('workspace-squircle', { state });
    await expect(el.locator('.ws-sq')).toHaveCount(1);
  }
});
