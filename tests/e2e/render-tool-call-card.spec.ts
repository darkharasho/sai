import { test, expect } from './test';

test('inline render card shows the live mock and toggles code', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card');
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();

  // Live render present (sandboxed iframe), auto-grown past the 150px default.
  const iframe = card.locator('iframe');
  await expect(iframe).toHaveCount(1);
  await expect.poll(async () => (await iframe.boundingBox())?.height ?? 0, { timeout: 4000 }).toBeGreaterThan(250);

  // Code pane is always in the DOM but hidden (width:0) when collapsed.
  await expect(card.locator('[data-testid="render-code"]')).not.toBeVisible();

  // Toggle reveals the code pane.
  await card.getByTestId('render-code-toggle').click();
  const code = card.locator('[data-testid="render-code"]');
  await expect(code).toBeVisible();
  await expect(code).toContainText('linear-gradient');

  // Toggle hides it again.
  await card.getByTestId('render-code-toggle').click();
  await expect(card.locator('[data-testid="render-code"]')).not.toBeVisible();
});
