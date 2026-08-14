import type { CodexOptions } from '@openai/codex-sdk';
import { CHAT_GITHUB_WATCH_NUDGE, CHAT_RENDER_NUDGE, CHAT_TASKS_NUDGE } from '../chatNudges';

export const CODEX_SAI_MCP_SERVER_NAME = 'sai';

export interface CodexChatMcpConfigInput {
  socketPath: string;
  secret: string;
  workspace: string;
  mcpServerScriptPath: string;
  electronExecPath: string;
}

/**
 * Build the SDK `--config` overrides for SAI's built-in chat MCP server.
 * This stays scoped to the Codex client process: it never changes the user's
 * global ~/.codex/config.toml, and each workspace gets its own authenticated
 * renderer bridge.
 */
export function buildCodexChatMcpConfig(
  input: CodexChatMcpConfigInput,
): NonNullable<CodexOptions['config']> {
  return {
    mcp_servers: {
      [CODEX_SAI_MCP_SERVER_NAME]: {
        command: input.electronExecPath,
        args: [input.mcpServerScriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SAI_SWARM_SOCKET_PATH: input.socketPath,
          SAI_SWARM_SECRET: input.secret,
          SAI_SWARM_WORKSPACE: input.workspace,
          SAI_MCP_TOOLSET: 'chat',
        },
      },
    },
    developer_instructions: [
      CHAT_RENDER_NUDGE,
      CHAT_GITHUB_WATCH_NUDGE,
      CHAT_TASKS_NUDGE,
    ].join('\n\n'),
  };
}
