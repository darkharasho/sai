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

test('render_chart card renders an inline SVG chart in the live iframe', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'chart', w: '420' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();

  const iframe = card.locator('iframe');
  await expect(iframe).toHaveCount(1);
  // The chart builds five bars; assert the SVG painted inside the sandboxed frame.
  const rects = card.frameLocator('iframe').locator('svg rect');
  await expect.poll(async () => rects.count(), { timeout: 4000 }).toBe(5);
});

test('render_diff card renders both variants side-by-side', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'diff', w: '460' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();

  const frame = card.frameLocator('iframe');
  await expect(frame.getByText('Current')).toBeVisible();
  await expect(frame.getByText('Proposed')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Save' })).toHaveCount(2);
});

test('render_mermaid card renders the diagram as inline SVG', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'mermaid', w: '420' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();
  // mermaid renders an <svg> once the dynamic import resolves.
  // Use .flowchart to target the diagram SVG (not the icon SVG in the header).
  const diagram = card.locator('svg.flowchart');
  await expect(diagram).toBeVisible({ timeout: 8000 });
  await expect(diagram).toContainText('Start');
});

test('render_theme card mounts the themed component', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'theme', w: '420' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();
  // ThemedComponents wraps the registered component with the CSS vars applied.
  await expect(card.locator('[data-themed-wrap]')).toBeVisible();
  await expect(card.locator('.ws-sq')).toBeVisible();
});
