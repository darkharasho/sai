import { test, expect } from './test';

test('image preview renders from a data URL', async ({ harness }) => {
  const el = await harness.render('tool-result-image', { variant: 'dataurl' });
  await expect(el.locator('[data-testid="tool-result-image-thumb"]')).toBeVisible();
});

test('clicking the thumbnail opens and Escape closes the lightbox', async ({ harness }) => {
  const el = await harness.render('tool-result-image', { variant: 'dataurl' });
  await el.locator('[data-testid="tool-result-image-thumb"]').click();
  await expect(el.page().locator('[data-testid="tool-result-image-lightbox"]')).toBeVisible();
  await el.page().keyboard.press('Escape');
  await expect(el.page().locator('[data-testid="tool-result-image-lightbox"]')).toHaveCount(0);
});

test('missing file shows the unavailable fallback', async ({ harness }) => {
  const el = await harness.render('tool-result-image', { variant: 'missing' });
  await expect(el.locator('.tool-result-image-missing')).toBeVisible();
});
