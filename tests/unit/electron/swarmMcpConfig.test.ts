import { describe, it, expect } from 'vitest';
import { buildSwarmMcpConfig } from '../../../electron/services/swarmMcpConfig';

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
