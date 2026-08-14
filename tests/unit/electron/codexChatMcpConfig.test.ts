// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CHAT_GITHUB_WATCH_NUDGE, CHAT_RENDER_NUDGE, CHAT_TASKS_NUDGE } from '@electron/services/chatNudges';
import { buildCodexChatMcpConfig, CODEX_SAI_MCP_SERVER_NAME } from '@electron/services/codexBackend/chatMcpConfig';

describe('buildCodexChatMcpConfig', () => {
  it('exposes SAI chat tools through the authenticated private stdio bridge', () => {
    const config = buildCodexChatMcpConfig({
      socketPath: '/tmp/sai.sock',
      secret: 'secret',
      workspace: '/repo',
      mcpServerScriptPath: '/app/swarm-mcp-server.js',
      electronExecPath: '/Applications/SAI.app/Contents/MacOS/SAI',
    });

    expect(config).toMatchObject({
      mcp_servers: {
        [CODEX_SAI_MCP_SERVER_NAME]: {
          command: '/Applications/SAI.app/Contents/MacOS/SAI',
          args: ['/app/swarm-mcp-server.js'],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            SAI_SWARM_SOCKET_PATH: '/tmp/sai.sock',
            SAI_SWARM_SECRET: 'secret',
            SAI_SWARM_WORKSPACE: '/repo',
            SAI_MCP_TOOLSET: 'chat',
          },
        },
      },
    });
    expect(config.developer_instructions).toContain(CHAT_RENDER_NUDGE);
    expect(config.developer_instructions).toContain(CHAT_GITHUB_WATCH_NUDGE);
    expect(config.developer_instructions).toContain(CHAT_TASKS_NUDGE);
  });
});
