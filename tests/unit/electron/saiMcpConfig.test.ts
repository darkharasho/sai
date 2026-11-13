import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import {
  buildSaiMcpConfig, writeSaiMcpConfig, cleanupSaiMcpConfigs, SAI_MCP_SERVER_NAME,
} from '../../../electron/services/saiMcpConfig';

const input = {
  socketPath: '/tmp/s.sock', secret: 'sec', workspace: '/w',
  mcpServerScriptPath: '/app/sai-mcp-server.js', electronExecPath: '/elec',
};

describe('buildSaiMcpConfig', () => {
  it('registers the chat-tools server under "sai" (model sees mcp__sai__sai_*)', () => {
    expect(SAI_MCP_SERVER_NAME).toBe('sai');
    const cfg = buildSaiMcpConfig(input);
    expect(Object.keys(cfg.mcpServers)).toEqual(['sai']);
    expect(cfg.mcpServers.sai).toEqual({
      command: '/elec',
      args: ['/app/sai-mcp-server.js'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SAI_MCP_SOCKET_PATH: '/tmp/s.sock',
        SAI_MCP_SECRET: 'sec',
        SAI_MCP_WORKSPACE: '/w',
      },
    });
  });
});

describe('writeSaiMcpConfig hygiene', () => {
  it('writes the tmp file owner-only (it carries the auth secret)', () => {
    const p = writeSaiMcpConfig(input);
    try {
      if (process.platform !== 'win32') {
        expect(fs.statSync(p).mode & 0o777).toBe(0o600);
      }
      expect(JSON.parse(fs.readFileSync(p, 'utf8')).mcpServers.sai.env.SAI_MCP_SECRET).toBe('sec');
    } finally {
      cleanupSaiMcpConfigs();
    }
  });

  it('cleanupSaiMcpConfigs removes every file written this session', () => {
    const a = writeSaiMcpConfig(input);
    const b = writeSaiMcpConfig(input);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    cleanupSaiMcpConfigs();
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
    // Idempotent — a second sweep is a no-op.
    cleanupSaiMcpConfigs();
  });
});
