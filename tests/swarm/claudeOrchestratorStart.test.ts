import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-test') },
  BrowserWindow: vi.fn(),
}));

const { buildArgs } = await import('../../electron/services/claude');
const { buildSwarmMcpConfig, writeSwarmMcpConfig } = await import('../../electron/services/swarmMcpConfig');

const fakeHandle = { socketPath: '/tmp/sai-test.sock', secret: 'deadbeef' };

const baseStubs = {
  getMcpHandle: () => fakeHandle,
  resolveMcpServerScriptPath: () => '/fake/dist-electron/swarm-mcp-server.js',
  resolveElectronExecPath: () => '/fake/electron',
  // capture-style mock: write into a fake path & return it without touching fs
  writeMcpConfig: (input: any) => `/tmp/fake-mcp-${input.workspace || 'none'}.json`,
  readSetting: (_k: string) => undefined,
};

describe('buildArgs (orchestrator vs chat kinds)', () => {
  it('orchestrator kind appends MCP-strict args and --tools ""', () => {
    const args = buildArgs({
      kind: 'orchestrator',
      workspace: '/some/project',
      ...baseStubs,
    });

    // Sanity: still has the base stream-json setup
    expect(args).toContain('-p');
    expect(args).toContain('--input-format');

    // Orchestrator-specific
    expect(args).toContain('--strict-mcp-config');
    const mcpIdx = args.indexOf('--mcp-config');
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(args[mcpIdx + 1]).toBe('/tmp/fake-mcp-/some/project.json');

    const toolsIdx = args.indexOf('--tools');
    expect(toolsIdx).toBeGreaterThan(-1);
    // The literal empty string disables all built-in tools.
    expect(args[toolsIdx + 1]).toBe('');
  });

  it('chat kind does NOT include --strict-mcp-config or --tools ""', () => {
    const args = buildArgs({ kind: 'chat', ...baseStubs });
    expect(args).not.toContain('--strict-mcp-config');
    expect(args).not.toContain('--tools');
  });

  it('chat kind passes through user mcpConfigPath setting', () => {
    const args = buildArgs({
      kind: 'chat',
      ...baseStubs,
      readSetting: (k: string) => (k === 'mcpConfigPath' ? '/user/mcp.json' : undefined),
    });
    const idx = args.indexOf('--mcp-config');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/user/mcp.json');
    expect(args).not.toContain('--strict-mcp-config');
  });

  it('default kind (no kind given) behaves like chat', () => {
    const args = buildArgs({ ...baseStubs });
    expect(args).not.toContain('--strict-mcp-config');
  });

  it('orchestrator kind passes workspace into the MCP config writer', () => {
    let captured: any = null;
    buildArgs({
      kind: 'orchestrator',
      workspace: '/repos/foo',
      ...baseStubs,
      writeMcpConfig: (input: any) => {
        captured = input;
        return '/tmp/x.json';
      },
    });
    expect(captured).toMatchObject({
      socketPath: fakeHandle.socketPath,
      secret: fakeHandle.secret,
      workspace: '/repos/foo',
      mcpServerScriptPath: '/fake/dist-electron/swarm-mcp-server.js',
      electronExecPath: '/fake/electron',
    });
  });
});

describe('swarmMcpConfig', () => {
  it('builds the expected MCP server descriptor', () => {
    const cfg = buildSwarmMcpConfig({
      socketPath: '/tmp/s.sock',
      secret: 'sek',
      workspace: '/ws',
      mcpServerScriptPath: '/script.js',
      electronExecPath: '/electron',
    });
    expect(cfg).toEqual({
      mcpServers: {
        swarm: {
          command: '/electron',
          args: ['/script.js'],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            SAI_SWARM_SOCKET_PATH: '/tmp/s.sock',
            SAI_SWARM_SECRET: 'sek',
            SAI_SWARM_WORKSPACE: '/ws',
          },
        },
      },
    });
  });

  it('writeSwarmMcpConfig writes a JSON file we can read back', () => {
    const filepath = writeSwarmMcpConfig({
      socketPath: '/tmp/s2.sock',
      secret: 'sek2',
      workspace: '/ws2',
      mcpServerScriptPath: '/script2.js',
      electronExecPath: '/electron2',
    });
    try {
      expect(fs.existsSync(filepath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      expect(parsed.mcpServers.swarm.command).toBe('/electron2');
      expect(parsed.mcpServers.swarm.args).toEqual(['/script2.js']);
      expect(parsed.mcpServers.swarm.env.SAI_SWARM_SECRET).toBe('sek2');
      expect(parsed.mcpServers.swarm.env.ELECTRON_RUN_AS_NODE).toBe('1');
    } finally {
      try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    }
  });
});
