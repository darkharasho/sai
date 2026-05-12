import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { ensureOrchestratorSession } from '@/lib/swarmOrchestratorSession';
import { dbGetSessions } from '@/chatDb';

describe('ensureOrchestratorSession', () => {
  it('creates exactly one orchestrator session per workspace', async () => {
    const s1 = await ensureOrchestratorSession('/p', 'claude');
    const s2 = await ensureOrchestratorSession('/p', 'claude');
    expect(s1.id).toBe(s2.id);
    const all = await dbGetSessions('/p');
    expect(all.filter(s => s.kind === 'orchestrator')).toHaveLength(1);
  });
});
