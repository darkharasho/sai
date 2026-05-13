import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export interface SwarmMcpConfigInput {
  socketPath: string;
  secret: string;
  workspace: string;
  mcpServerScriptPath: string;
  /** process.execPath at call time (Electron itself, run via ELECTRON_RUN_AS_NODE) */
  electronExecPath: string;
}

/**
 * Build the MCP config object that points the orchestrator's Claude CLI at
 * SAI's bundled swarm MCP server. The server is run with Electron-as-node and
 * given the swarm-host socket path + auth secret + workspace via env vars.
 */
export function buildSwarmMcpConfig(input: SwarmMcpConfigInput) {
  return {
    mcpServers: {
      swarm: {
        command: input.electronExecPath,
        args: [input.mcpServerScriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SAI_SWARM_SOCKET_PATH: input.socketPath,
          SAI_SWARM_SECRET: input.secret,
          SAI_SWARM_WORKSPACE: input.workspace,
        },
      },
    },
  };
}

/**
 * Write the MCP config JSON to a tmp file and return the path.
 * The Claude CLI reads this via `--mcp-config <path>`.
 */
export function writeSwarmMcpConfig(input: SwarmMcpConfigInput): string {
  const config = buildSwarmMcpConfig(input);
  const filename = `sai-swarm-mcp-${crypto.randomBytes(8).toString('hex')}.json`;
  const filepath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filepath, JSON.stringify(config, null, 2));
  return filepath;
}
