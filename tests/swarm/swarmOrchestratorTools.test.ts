import { describe, it, expect } from 'vitest';
import { SWARM_TOOL_SCHEMA } from '../../src/lib/swarmOrchestratorTools';

describe('swarm tool schema', () => {
  it('declares the expected tools', () => {
    expect(SWARM_TOOL_SCHEMA.map(t => t.name)).toEqual([
      'spawn_task','spawn_tasks','query_status','pause_task','resume_task',
      'approve_tool_call','deny_tool_call','land','discard',
    ]);
  });
});
