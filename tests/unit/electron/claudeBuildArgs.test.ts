// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// Mock electron and other node modules that claude.ts imports
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

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('@electron/services/swarmMcpHost', () => ({
  start: vi.fn().mockReturnValue({ socketPath: '/tmp/default.sock', secret: 'default-secret' }),
  stop: vi.fn(),
}));

vi.mock('@electron/services/idleScopeSweep', () => ({
  sweepIdleScopes: vi.fn(),
  IDLE_SCOPE_MS: 30 * 60 * 1000,
  SWEEP_INTERVAL_MS: 60 * 1000,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
    execFile: vi.fn(),
  };
});

import { buildArgs } from '../../../electron/services/claude';

describe('buildArgs — chat session MCP config', () => {
  it('includes --mcp-config when kind=chat and workspace is provided', () => {
    const args = buildArgs({
      kind: 'chat',
      workspace: '/w',
      getMcpHandle: () => ({ socketPath: 's', secret: 'x' }),
      writeMcpConfig: () => '/tmp/cfg.json',
      resolveMcpServerScriptPath: () => 'srv.js',
      resolveElectronExecPath: () => 'elec',
      readSetting: () => undefined,
    });
    expect(args).toContain('--mcp-config');
    const idx = args.indexOf('--mcp-config');
    expect(args[idx + 1]).toBe('/tmp/cfg.json');
  });

  it('does NOT include --strict-mcp-config for chat sessions', () => {
    const args = buildArgs({
      kind: 'chat',
      workspace: '/w',
      getMcpHandle: () => ({ socketPath: 's', secret: 'x' }),
      writeMcpConfig: () => '/tmp/cfg.json',
      resolveMcpServerScriptPath: () => 'srv.js',
      resolveElectronExecPath: () => 'elec',
      readSetting: () => undefined,
    });
    expect(args).not.toContain('--strict-mcp-config');
  });

  it('does NOT include --tools for chat sessions', () => {
    const args = buildArgs({
      kind: 'chat',
      workspace: '/w',
      getMcpHandle: () => ({ socketPath: 's', secret: 'x' }),
      writeMcpConfig: () => '/tmp/cfg.json',
      resolveMcpServerScriptPath: () => 'srv.js',
      resolveElectronExecPath: () => 'elec',
      readSetting: () => undefined,
    });
    expect(args).not.toContain('--tools');
  });

  it('does not add --mcp-config (SAI) when kind=chat and workspace is absent', () => {
    // When no workspace, chat falls through to the mcpConfigPath settings path
    // (and SAI's own MCP config is not added since there's no workspace to pass)
    const writeMock = vi.fn().mockReturnValue('/tmp/cfg.json');
    buildArgs({
      kind: 'chat',
      workspace: undefined,
      getMcpHandle: () => ({ socketPath: 's', secret: 'x' }),
      writeMcpConfig: writeMock,
      resolveMcpServerScriptPath: () => 'srv.js',
      resolveElectronExecPath: () => 'elec',
      readSetting: () => undefined,
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('passes toolset=chat to writeMcpConfig for chat sessions', () => {
    const writeMock = vi.fn().mockReturnValue('/tmp/cfg.json');
    buildArgs({
      kind: 'chat',
      workspace: '/w',
      getMcpHandle: () => ({ socketPath: 's', secret: 'x' }),
      writeMcpConfig: writeMock,
      resolveMcpServerScriptPath: () => 'srv.js',
      resolveElectronExecPath: () => 'elec',
      readSetting: () => undefined,
    });
    expect(writeMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolset: 'chat' }),
    );
  });

  it('orchestrator still gets --strict-mcp-config and --tools', () => {
    const args = buildArgs({
      kind: 'orchestrator',
      workspace: '/w',
      getMcpHandle: () => ({ socketPath: 's', secret: 'x' }),
      writeMcpConfig: () => '/tmp/orch.json',
      resolveMcpServerScriptPath: () => 'srv.js',
      resolveElectronExecPath: () => 'elec',
      readSetting: () => undefined,
    });
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--tools');
  });
});
