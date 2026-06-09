import { test, expect } from './test';

test('html mock renders as a sandboxed iframe and mirrors in the panel', async ({ harness }) => {
  const el = await harness.render('sai-render', { kind: 'html' });
  const card = el.locator('[data-testid="render-tool-card"]');
  await expect(card).toBeVisible();

  const iframe = card.locator('iframe');
  await expect(iframe).toHaveCount(1);
  // Sandboxed (no allow-same-origin) → assert the srcDoc attribute, not frame contents.
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const srcdoc = await iframe.getAttribute('srcdoc');
  expect(srcdoc ?? '').toContain('hello mock');
  expect(srcdoc ?? '').toContain('Content-Security-Policy');

  // Panel mirrors the active render.
  await expect(el.locator('[data-testid="render-preview-panel"]')).toBeVisible();
});

test('component mock mounts WorkspaceSquircle busy-done in the card', async ({ harness }) => {
  const el = await harness.render('sai-render', { kind: 'component' });
  await expect(el.locator('[data-testid="render-tool-card"] .ws-sq-busy-done-wrap')).toBeVisible();
});
