// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { buildSdkOptions, type SdkOptionInputs } from '@electron/services/claudeBackend/sdkOptions';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';

const BASE: SdkOptionInputs = {
  kind: 'chat',
  cwd: '/some/project',
};

describe('buildSdkOptions', () => {
  it('(a) chat default → acceptEdits, includePartialMessages, preset systemPrompt', () => {
    const opts = buildSdkOptions(BASE);
    expect(opts.permissionMode).toBe('acceptEdits');
    expect(opts.includePartialMessages).toBe(true);
    expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(opts.cwd).toBe('/some/project');
  });

  it('(b) permMode bypass → bypassPermissions', () => {
    const opts = buildSdkOptions({ ...BASE, permMode: 'bypass' });
    expect(opts.permissionMode).toBe('bypassPermissions');
  });

  it('(c) kind orchestrator → bypassPermissions', () => {
    const opts = buildSdkOptions({ ...BASE, kind: 'orchestrator' });
    expect(opts.permissionMode).toBe('bypassPermissions');
  });

  it('(d) sessionId set → resume equals it', () => {
    const opts = buildSdkOptions({ ...BASE, sessionId: 'abc-123' });
    expect(opts.resume).toBe('abc-123');
  });

  it('(e) appendSystemPrompt set → systemPrompt.append equals it', () => {
    const opts = buildSdkOptions({ ...BASE, appendSystemPrompt: 'My extra instructions' });
    expect(opts.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'My extra instructions',
    });
  });

  it('(f) claudeExecutablePath set → pathToClaudeCodeExecutable equals it', () => {
    const opts = buildSdkOptions({ ...BASE, claudeExecutablePath: '/usr/local/bin/claude' });
    expect(opts.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude');
  });

  it('(g) no MCP/canUseTool keys present', () => {
    const opts = buildSdkOptions(BASE) as Record<string, unknown>;
    expect(opts).not.toHaveProperty('mcpServers');
    expect(opts).not.toHaveProperty('canUseTool');
    expect(opts).not.toHaveProperty('strictMcpConfig');
    expect(opts).not.toHaveProperty('tools');
  });

  it('effort only set when valid value', () => {
    const withLow = buildSdkOptions({ ...BASE, effort: 'low' });
    expect(withLow.effort).toBe('low');
    const withInvalid = buildSdkOptions({ ...BASE, effort: 'extreme' });
    expect(withInvalid.effort).toBeUndefined();
  });

  it('model only set when provided', () => {
    const withModel = buildSdkOptions({ ...BASE, model: 'claude-opus-4' });
    expect(withModel.model).toBe('claude-opus-4');
    const without = buildSdkOptions(BASE);
    expect(without.model).toBeUndefined();
  });

  it('resume not set when sessionId is absent', () => {
    const opts = buildSdkOptions(BASE);
    expect(opts.resume).toBeUndefined();
  });

  it('pathToClaudeCodeExecutable not set when claudeExecutablePath is absent', () => {
    const opts = buildSdkOptions(BASE);
    expect(opts.pathToClaudeCodeExecutable).toBeUndefined();
  });

  // ── canUseTool tests ──────────────────────────────────────────────────────

  it('(h) canUseTool provided + non-bypass permMode → options.canUseTool is set', () => {
    const canUseTool: CanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const opts = buildSdkOptions({ ...BASE, canUseTool, permMode: 'default' });
    expect(opts.canUseTool).toBe(canUseTool);
  });

  it('(i) canUseTool provided + no permMode (acceptEdits) → options.canUseTool is set', () => {
    const canUseTool: CanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const opts = buildSdkOptions({ ...BASE, canUseTool });
    expect(opts.canUseTool).toBe(canUseTool);
  });

  it('(j) canUseTool provided + permMode bypass → options.canUseTool is NOT set', () => {
    const canUseTool: CanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const opts = buildSdkOptions({ ...BASE, canUseTool, permMode: 'bypass' }) as Record<string, unknown>;
    expect(opts).not.toHaveProperty('canUseTool');
  });

  it('(k) canUseTool provided + kind orchestrator → options.canUseTool is NOT set (orchestrator = bypass)', () => {
    const canUseTool: CanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const opts = buildSdkOptions({ ...BASE, canUseTool, kind: 'orchestrator' }) as Record<string, unknown>;
    expect(opts).not.toHaveProperty('canUseTool');
  });

  it('(l) canUseTool NOT provided → options.canUseTool is not set', () => {
    const opts = buildSdkOptions(BASE) as Record<string, unknown>;
    expect(opts).not.toHaveProperty('canUseTool');
  });

  // ── mcpServers tests ──────────────────────────────────────────────────────

  it('sets mcpServers when provided', () => {
    const fakeServer = { type: 'sdk', name: 'sai', instance: {} } as any;
    const opts = buildSdkOptions({
      kind: 'chat', cwd: '/ws', mcpServers: { sai: fakeServer },
    });
    expect(opts.mcpServers).toEqual({ sai: fakeServer });
  });

  it('omits mcpServers when not provided', () => {
    const opts = buildSdkOptions({ kind: 'chat', cwd: '/ws' });
    expect(opts.mcpServers).toBeUndefined();
  });

  it('omits mcpServers when given an empty object', () => {
    const opts = buildSdkOptions({ kind: 'chat', cwd: '/ws', mcpServers: {} });
    expect(opts.mcpServers).toBeUndefined();
  });
});
