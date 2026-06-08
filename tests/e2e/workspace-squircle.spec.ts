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
