import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import {
  buildSwarmMcpConfig, writeSwarmMcpConfig, cleanupSwarmMcpConfigs,
} from '../../../electron/services/swarmMcpConfig';

describe('buildSwarmMcpConfig toolset', () => {
  it('writes SAI_MCP_TOOLSET into the server env', () => {
    const cfg = buildSwarmMcpConfig({
      socketPath: '/tmp/s.sock', secret: 'sec', workspace: '/w',
      mcpServerScriptPath: '/app/swarm-mcp-server.js', electronExecPath: '/elec',
      toolset: 'chat',
    });
    expect(cfg.mcpServers.swarm.env.SAI_MCP_TOOLSET).toBe('chat');
  });

  it('defaults SAI_MCP_TOOLSET to orchestrator when toolset omitted', () => {
    const cfg = buildSwarmMcpConfig({
      socketPath: '/tmp/s.sock', secret: 'sec', workspace: '/w',
      mcpServerScriptPath: '/app/swarm-mcp-server.js', electronExecPath: '/elec',
    });
    expect(cfg.mcpServers.swarm.env.SAI_MCP_TOOLSET).toBe('orchestrator');
  });
});

describe('writeSwarmMcpConfig hygiene', () => {
  const input = {
    socketPath: '/tmp/s.sock', secret: 'sec', workspace: '/w',
    mcpServerScriptPath: '/app/swarm-mcp-server.js', electronExecPath: '/elec',
  };

  it('writes the tmp file owner-only (it carries the auth secret)', () => {
    const p = writeSwarmMcpConfig(input);
    try {
      if (process.platform !== 'win32') {
        expect(fs.statSync(p).mode & 0o777).toBe(0o600);
      }
      expect(JSON.parse(fs.readFileSync(p, 'utf8')).mcpServers.swarm.env.SAI_SWARM_SECRET).toBe('sec');
    } finally {
      cleanupSwarmMcpConfigs();
    }
  });

  it('cleanupSwarmMcpConfigs removes every file written this session', () => {
    const a = writeSwarmMcpConfig(input);
    const b = writeSwarmMcpConfig(input);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    cleanupSwarmMcpConfigs();
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
    // Idempotent — a second sweep is a no-op.
    cleanupSwarmMcpConfigs();
  });
});
