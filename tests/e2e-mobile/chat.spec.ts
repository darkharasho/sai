// The phone app against a fake desktop (real bridge + chat log, scripted
// provider). Runs at the iPhone 15 viewport (playwright.mobile.config.ts).
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const CONTROL = 'http://127.0.0.1:17898';
const SHOTS = path.resolve('.superpowers/sdd/2026-11-19-sai-ios-app-part2');

async function control<T>(p: string): Promise<T> {
  const res = await fetch(`${CONTROL}${p}`);
  return res.json() as Promise<T>;
}

/** Pairs by pasting the desktop's pairing link (no camera). */
async function pair(page: Page): Promise<void> {
  const { url } = await control<{ url: string }>('/pair-url');
  await page.goto('/');
  await page.getByLabel('Pairing link').fill(url);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
}

/** Opens the drawer, picks the demo workspace and starts a new chat; returns its id. */
async function newChat(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('navigation', { name: 'Chats and workspaces' });
  await expect(drawer).toBeVisible();
  await drawer.getByTestId('workspace-row').filter({ hasText: 'demo' }).click();
  await drawer.getByRole('button', { name: '+ New chat' }).click();
  await expect(drawer).toBeHidden();
  const host = page.getByTestId('chat-host');
  await expect(host).toBeVisible();
  return (await host.getAttribute('data-chat-id'))!;
}

async function send(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox');
  await expect(box).toBeEnabled();
  await box.fill(text);
  // Phone: Enter is a newline; the Send button sends.
  await page.getByTitle('Send').click();
}

test('pair, open workspace, send, stream, stop', async ({ page }) => {
  await pair(page);
  await newChat(page);
  await expect(page.getByTestId('header-title')).toContainText('demo');

  await send(page, 'hello there');
  await expect(page.locator('.chat-msg').getByText('hello there', { exact: true })).toBeVisible();
  // Streams in word by word.
  await expect(page.getByText(/Echo: hello there\./)).toBeVisible();
  await expect(page.getByText(/word4/)).toBeVisible();
  await expect(page.getByTestId('status-dot')).toHaveAttribute('data-status', 'streaming');
  await page.screenshot({ path: path.join(SHOTS, 'task-9-chat.png'), animations: 'disabled' });

  // Stop ends the turn on the desktop; the reply stops short.
  await page.getByTitle('Stop').click();
  await expect(page.getByTitle('Stop')).toBeHidden();
  await expect(page.getByTestId('status-dot')).toHaveAttribute('data-status', 'done');
  await page.waitForTimeout(600);
  await expect(page.getByText('All done.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Chats and workspaces' })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'task-9-drawer.png'), animations: 'disabled' });
});

test('phone-created chat appears in the list', async ({ page }) => {
  await pair(page);
  const chatId = await newChat(page);
  await send(page, 'remember this chat');
  await expect(page.getByText(/Echo: remember this chat\./)).toBeVisible();

  // The desktop's log has it under the workspace...
  await expect.poll(async () => (await control<{ chats: Array<{ chatId: string }> }>('/chats')).chats.map((c) => c.chatId))
    .toContain(chatId);
  // ...and the drawer lists it from chats.subscribe.
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('navigation', { name: 'Chats and workspaces' });
  await expect(drawer.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"]`)).toBeVisible();
});

test('composer stays above the keyboard', async ({ page }) => {
  await pair(page);
  await newChat(page);
  const box = page.getByRole('textbox');
  await expect(box).toBeVisible();

  // The software keyboard takes the bottom of the screen: the visual viewport shrinks.
  const keyboardTop = 420;
  await page.evaluate((h) => {
    const vv = window.visualViewport!;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event('resize'));
  }, keyboardTop);

  await expect.poll(async () => {
    const b = await box.boundingBox();
    return b ? b.y + b.height : Infinity;
  }).toBeLessThanOrEqual(keyboardTop);
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeInViewport();
});

test('follows the reply to the bottom through tool cards', async ({ page }) => {
  await pair(page);
  await newChat(page);
  await send(page, 'run some tools please');
  await expect(page.locator('.tool-call-card').first()).toBeVisible();
  // Several tool calls land and grow while the reply streams; the view stays pinned.
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(400);
    // A sample can land in the frame where a card grew but the follow hasn't
    // scrolled yet; pinned means it catches up right away, not never.
    await expect.poll(
      () => page.locator('.chat-messages').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
      { timeout: 500, intervals: [16, 32, 50] },
    ).toBeLessThan(4);
  }
});

test('mid-reply: Send sits beside Stop and sends the message into the running turn', async ({ page }) => {
  await pair(page);
  await newChat(page);
  await send(page, 'hello there');
  await expect(page.getByTitle('Stop')).toBeVisible();
  await page.getByRole('textbox').fill('and a follow-up');
  const midTurn = page.locator('.send-btn:not(.stop-btn)');
  await expect(midTurn).toHaveAttribute('title', 'Send');
  await midTurn.click();
  // Claude takes it mid-turn: the bubble shows at once and the reply answers it; nothing queues.
  await expect(page.getByText('Echo: and a follow-up')).toBeVisible();
  await expect(page.getByTestId('queue-badge')).toHaveCount(0);
  // The composer toolbar never runs off the screen.
  const vw = page.viewportSize()!.width;
  for (const b of await page.locator('.input-wrapper button').all()) {
    const box = await b.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(vw);
  }
});

test('composer text is 16px (iOS zooms smaller focused inputs)', async ({ page }) => {
  await pair(page);
  await newChat(page);
  const fs = await page.getByRole('textbox').evaluate((el) => getComputedStyle(el).fontSize);
  expect(fs).toBe('16px');
  await expect(page.getByTitle('Send')).toHaveCSS('height', '44px');
});
