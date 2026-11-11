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

import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE, CHAT_TASKS_NUDGE, CHAT_TASK_CARDS_NUDGE } from '../../../electron/services/chatNudges';
import * as claude from '../../../electron/services/claude';

describe('chatNudges', () => {
  it('exposes the render + github nudges as non-empty strings', () => {
    expect(CHAT_RENDER_NUDGE).toContain('render_html');
    expect(CHAT_GITHUB_WATCH_NUDGE).toContain('sai_watch_github_run');
  });

  // SDK chats get the sai_task task-card nudge in place of the tool-agnostic
  // CHAT_TASKS_NUDGE (CLI and Codex keep CHAT_TASKS_NUDGE).
  it('task-card nudge is the exact copy and names sai_task, agent, and the no-mention fallback', () => {
    expect(CHAT_TASK_CARDS_NUDGE).toBe(
      'When the user asks for several things in one message, or for multi-step work (3+ distinct steps, refactors, features, debugging sessions), track it with the sai_task tool: call it with action "create" BEFORE starting, with one task per distinct request and that task\'s real steps. Keep the cards honest as you go: set status "running" with the current step index when you start or advance a step, "done" with a one-line note when a task finishes, "failed" with the reason if it can\'t be finished. Updating a task also tags the work that follows onto its card — your replies and tool calls are filed under the task you last updated — so update a task right before you start on it, and update the new one as soon as you switch, even when nothing else about the card changed. When you hand a task to a background agent, pass agent = the exact description you gave the Agent call so SAI can show that agent\'s live work on the card. SAI renders these as a persistent task panel the user watches; stale or skipped updates make it lie. Use sai_task instead of TaskCreate/TodoWrite. If the tool is deferred, load it via ToolSearch first. Skip it for single-step or conversational requests, and if the tool is not registered in this session, just do the work and do not mention the tool or its absence.',
    );
    expect(CHAT_TASK_CARDS_NUDGE).toContain('sai_task');
    expect(CHAT_TASK_CARDS_NUDGE).toContain('agent');
    // The attribution rule is what gives a non-subagent card a stream of its own.
    expect(CHAT_TASK_CARDS_NUDGE).toMatch(/tags the work that follows/);
    expect(CHAT_TASK_CARDS_NUDGE).toMatch(/do not mention the tool or its absence/);
  });

  // Claude CLI 2.1.266 registers neither TaskCreate nor TodoWrite, and Codex has
  // only its own plan tool. A nudge that demands a specific tool makes the model
  // announce "task tools aren't available this session" to the user instead of
  // just working, so the wording must stay tool-agnostic and self-silencing.
  it('task nudge does not demand a specific tool and silences the not-available aside', () => {
    expect(CHAT_TASKS_NUDGE).toMatch(/whichever task\/todo tracking tool/);
    expect(CHAT_TASKS_NUDGE).toMatch(/if no such tool is registered/i);
    expect(CHAT_TASKS_NUDGE).toMatch(/do not mention the tool or its absence/i);
    // No imperative "use TaskCreate/TodoWrite" phrasing — names may appear only
    // as examples of what the session might register.
    expect(CHAT_TASKS_NUDGE).not.toMatch(/create tasks with TaskCreate/);
    expect(CHAT_TASKS_NUDGE).not.toMatch(/use TodoWrite/);
  });

  // The standalone `claude` binary stopped registering TaskCreate/TaskUpdate
  // after 2.1.196 (verified: 2.1.266 and 2.1.278 expose only Task/TaskStop
  // without the flag, and the full suite with it). SAI's progress ring is
  // driven by those calls, so every spawned CLI must get the flag.
  it('spawnEnv enables the task/todo tools in the spawned CLI', () => {
    const prev = process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS;
    delete process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS;
    try {
      expect(claude.spawnEnv().CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe('1');
      // An explicit user value wins (lets a user turn the tools back off).
      process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = '0';
      expect(claude.spawnEnv().CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe('0');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS;
      else process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = prev;
    }
  });

  it('claude.ts re-exports the same constants (back-compat)', () => {
    expect(claude.CHAT_RENDER_NUDGE).toBe(CHAT_RENDER_NUDGE);
    expect(claude.CHAT_GITHUB_WATCH_NUDGE).toBe(CHAT_GITHUB_WATCH_NUDGE);
  });
});
