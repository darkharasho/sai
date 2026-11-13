import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

/** MCP server key for SAI's chat tools: the model sees `mcp__sai__sai_*`. */
export const SAI_MCP_SERVER_NAME = 'sai';

export interface SaiMcpConfigInput {
  socketPath: string;
  secret: string;
  workspace: string;
  mcpServerScriptPath: string;
  /** process.execPath at call time (Electron itself, run via ELECTRON_RUN_AS_NODE) */
  electronExecPath: string;
}

/**
 * Build the MCP config object that points a chat's Claude CLI at SAI's
 * bundled chat-tools MCP server. The server is run with Electron-as-node and
 * given the SAI host socket path + auth secret + workspace via env vars.
 */
export function buildSaiMcpConfig(input: SaiMcpConfigInput) {
  return {
    mcpServers: {
      [SAI_MCP_SERVER_NAME]: {
        command: input.electronExecPath,
        args: [input.mcpServerScriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SAI_MCP_SOCKET_PATH: input.socketPath,
          SAI_MCP_SECRET: input.secret,
          SAI_MCP_WORKSPACE: input.workspace,
        },
      },
    },
  };
}

// Every config file written this process, so quit can sweep them. The file
// carries the SAI host auth secret, hence 0o600 + best-effort cleanup.
const writtenConfigPaths = new Set<string>();

/**
 * Write the MCP config JSON to a tmp file and return the path.
 * The Claude CLI reads this via `--mcp-config <path>`.
 */
export function writeSaiMcpConfig(input: SaiMcpConfigInput): string {
  const config = buildSaiMcpConfig(input);
  const filename = `sai-mcp-${crypto.randomBytes(8).toString('hex')}.json`;
  const filepath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filepath, JSON.stringify(config, null, 2), { mode: 0o600 });
  writtenConfigPaths.add(filepath);
  return filepath;
}

/** Delete every config file written this session. Call on app quit. */
export function cleanupSaiMcpConfigs(): void {
  for (const p of writtenConfigPaths) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }
  writtenConfigPaths.clear();
}
