import { test, expect } from './test';

test('no indicator shown when no workspaces are active', async ({ window }) => {
  await expect(window.locator('.nav-status-indicator')).toHaveCount(0);
});

test('busy indicator shown when one workspace is busy', async ({ window, appState }) => {
  await appState.setWorkspaceBusy('/projects/ws1');
  await expect(window.locator('.nav-status-indicator')).toBeVisible();
  await expect(window.locator('.nav-status-indicator .ws-sq-busy')).toBeVisible();
});

test('done indicator shown when workspace completes', async ({ window, appState }) => {
  await appState.setWorkspaceDone('/projects/ws1');
  await expect(window.locator('.nav-status-indicator .ws-sq-done')).toBeVisible();
});

test('busy-done indicator shown with mixed workspace states', async ({ window, appState }) => {
  await appState.setWorkspaceBusy('/projects/ws1');
  await appState.setWorkspaceDone('/projects/ws2');
  const wrapper = window.locator('.nav-status-indicator .ws-sq-busy-done-wrap');
  await expect(wrapper).toBeVisible();
  await expect(wrapper.locator('.ws-sq-busy')).toBeVisible();
  await expect(wrapper.locator('.ws-sq-inner')).toBeVisible();
});

test('overall status transitions: nothing → busy → busy-done → done → nothing', async ({ window, appState }) => {
  // nothing
  await expect(window.locator('.nav-status-indicator')).toHaveCount(0);

  // both busy
  await appState.setWorkspaceBusy('/projects/ws1');
  await appState.setWorkspaceBusy('/projects/ws2');
  expect(await appState.getOverallStatus()).toBe('busy');
  await expect(window.locator('.nav-status-indicator .ws-sq-busy')).toBeVisible();

  // one done → busy-done
  await appState.setWorkspaceDone('/projects/ws1');
  expect(await appState.getOverallStatus()).toBe('busy-done');
  await expect(window.locator('.nav-status-indicator .ws-sq-busy-done-wrap')).toBeVisible();

  // other done → done
  await appState.setWorkspaceDone('/projects/ws2');
  expect(await appState.getOverallStatus()).toBe('done');
  await expect(window.locator('.nav-status-indicator .ws-sq-done')).toBeVisible();

  // clear → nothing
  await appState.clearWorkspaces();
  expect(await appState.getOverallStatus()).toBeNull();
  await expect(window.locator('.nav-status-indicator')).toHaveCount(0);
});
