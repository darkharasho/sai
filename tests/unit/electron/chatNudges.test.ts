// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// Mock electron and other node modules that claude.ts imports transitively
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-test-userdata') },
  BrowserWindow: vi.fn(),
}));

vi.mock('@electron/services/workspace', () => ({
  getOrCreate: vi.fn(),
  get: vi.fn(),
  getClaude: vi.fn(),
  touchActivity: vi.fn(),
  listAllWorkspaces: vi.fn().mockReturnValue([]),
}));

vi.mock('@electron/services/notify', () => ({
  notifyCompletion: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyPlanReview: vi.fn(),
}));

vi.mock('@electron/services/gemini', () => ({
  ensureGeminiTransport: vi.fn(),
  ensureGeminiCommitSession: vi.fn(),
  promptGeminiText: vi.fn(),
}));

vi.mock('@electron/services/swarmMcpHost', () => ({
  start: vi.fn(),
}));

vi.mock('@electron/services/idleScopeSweep', () => ({
  sweepIdleScopes: vi.fn(),
  IDLE_SCOPE_MS: 300_000,
  SWEEP_INTERVAL_MS: 60_000,
}));

vi.mock('@electron/services/claudeBackend', () => ({
  getClaudeBackend: vi.fn(),
}));

vi.mock('@electron/services/swarmMcpConfig', () => ({
  writeSwarmMcpConfig: vi.fn(),
}));

import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from '../../../electron/services/chatNudges';
import * as claude from '../../../electron/services/claude';

describe('chatNudges', () => {
  it('exposes the render + github nudges as non-empty strings', () => {
    expect(CHAT_RENDER_NUDGE).toContain('render_html');
    expect(CHAT_GITHUB_WATCH_NUDGE).toContain('sai_watch_github_run');
  });

  it('claude.ts re-exports the same constants (back-compat)', () => {
    expect(claude.CHAT_RENDER_NUDGE).toBe(CHAT_RENDER_NUDGE);
    expect(claude.CHAT_GITHUB_WATCH_NUDGE).toBe(CHAT_GITHUB_WATCH_NUDGE);
  });
});
