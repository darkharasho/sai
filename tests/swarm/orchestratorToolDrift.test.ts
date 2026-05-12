import { describe, it, expect } from 'vitest';
import { isOrchestratorToolDrift, describeToolDrift } from '../../src/lib/orchestratorToolDrift';

describe('isOrchestratorToolDrift', () => {
  it('returns false for swarm MCP tools', () => {
    expect(isOrchestratorToolDrift('mcp__swarm__spawn_task')).toBe(false);
  });

  it('returns true for built-in Read tool', () => {
    expect(isOrchestratorToolDrift('Read')).toBe(true);
  });

  it('returns true for built-in Bash tool', () => {
    expect(isOrchestratorToolDrift('Bash')).toBe(true);
  });

  it('returns true for other MCP servers (only swarm is allowed)', () => {
    expect(isOrchestratorToolDrift('mcp__other__foo')).toBe(true);
  });

  it('returns false for empty string (defensive)', () => {
    expect(isOrchestratorToolDrift('')).toBe(false);
  });
});

describe('describeToolDrift', () => {
  it('includes the tool name and a hint about flag regression', () => {
    const msg = describeToolDrift('Read');
    expect(msg).toContain('Read');
    expect(msg).toMatch(/flag regression/i);
  });
});
