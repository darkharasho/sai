import { test, expect } from './test';

test('html mock renders as a sandboxed iframe and mirrors in the panel', async ({ harness }) => {
  const el = await harness.render('sai-render', { kind: 'html' });
  const card = el.locator('[data-testid="render-tool-card"]');
  await expect(card).toBeVisible();

  const iframe = card.locator('iframe');
  await expect(iframe).toHaveCount(1);
  // Isolated by default (no allow-same-origin) → assert the srcDoc attribute, not frame contents.
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const srcdoc = await iframe.getAttribute('srcdoc');
  expect(srcdoc ?? '').toContain('hello mock');
  expect(srcdoc ?? '').toContain('Content-Security-Policy');

  // Auto-grow: the iframe sizes to the (360px) mock instead of clipping at the
  // 150px HTML default, so tall mocks aren't cut off / shown as a blank slice.
  await expect.poll(async () => (await iframe.boundingBox())?.height ?? 0, { timeout: 4000 })
    .toBeGreaterThan(300);

  // Panel mirrors the active render.
  await expect(el.locator('[data-testid="render-preview-panel"]')).toBeVisible();
});

test('component mock mounts WorkspaceSquircle busy-done in the card', async ({ harness }) => {
  const el = await harness.render('sai-render', { kind: 'component' });
  await expect(el.locator('[data-testid="render-tool-card"] .ws-sq-busy-done')).toBeVisible();
});

test('file-mode render loads via an iframe src with a same-origin sandbox', async ({ harness }) => {
  const el = await harness.render('sai-render', { kind: 'file' });
  const card = el.locator('[data-testid="render-tool-card"]');
  await expect(card).toBeVisible();

  const iframe = card.locator('iframe');
  await expect(iframe).toHaveCount(1);
  // File mode loads via src (not srcdoc) and needs allow-same-origin so the page
  // can fetch its own assets. The opaque origin means the app DOM stays isolated.
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await expect.poll(async () => (await iframe.getAttribute('src')) ?? '', { timeout: 4000 })
    .toContain('data:text/html');
  expect(await iframe.getAttribute('srcdoc')).toBeNull();
});
