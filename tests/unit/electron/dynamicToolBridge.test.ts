// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dynamicToolResponse, validateSaiSwarmDynamicToolCall } from '../../../electron/services/codexBackend/dynamicToolBridge';

describe('dynamicToolBridge', () => {
  it('accepts only the fixed Swarm catalogue with schema-valid inputs', () => {
    expect(validateSaiSwarmDynamicToolCall({ tool: 'sai_swarm_spawn_task', arguments: { prompt: 'Audit the bridge' } }))
      .toEqual({ tool: 'spawn_task', input: { prompt: 'Audit the bridge' } });
    expect(validateSaiSwarmDynamicToolCall({ tool: 'sai_swarm_spawn_task', arguments: { prompt: 'x', shell: 'rm -rf /' } })).toBeUndefined();
    expect(validateSaiSwarmDynamicToolCall({ tool: 'bash', arguments: {} })).toBeUndefined();
  });

  it('bounds results and errors to JSON-safe App Server content without leaking secrets', () => {
    const large = 'x'.repeat(20_000);
    expect(dynamicToolResponse({ token: 'secret', output: large })).toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: expect.stringContaining('truncated') }],
    });
    expect(dynamicToolResponse(new Error('secret-value'), true)).toEqual({
      success: false,
      contentItems: [{ type: 'inputText', text: 'Dynamic tool failed' }],
    });
  });
});
