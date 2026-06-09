import { test, expect } from './test';

test('render overlay shows the active render and can be dismissed', async ({ harness }) => {
  const el = await harness.render('render-overlay');
  const overlay = el.locator('[data-testid="render-overlay"]');
  await expect(overlay).toBeVisible();
  // html mock is in a sandboxed iframe (opaque origin) — assert via srcdoc attribute.
  const iframe = overlay.locator('iframe');
  await expect(iframe).toHaveCount(1);
  const srcdoc = await iframe.getAttribute('srcdoc');
  expect(srcdoc ?? '').toContain('hello overlay');
  // Close button hides it.
  await overlay.getByRole('button', { name: 'Close render preview' }).click();
  await expect(overlay).toHaveCount(0);
});
