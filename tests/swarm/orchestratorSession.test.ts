import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { ensureOrchestratorSession } from '@/lib/swarmOrchestratorSession';
import { dbGetSessions, dbGetMessages, dbSaveSession } from '@/chatDb';
import type { ChatMessage } from '@/types';

describe('ensureOrchestratorSession', () => {
  it('creates exactly one orchestrator session per workspace', async () => {
    const s1 = await ensureOrchestratorSession('/p', 'claude');
    const s2 = await ensureOrchestratorSession('/p', 'claude');
    expect(s1.id).toBe(s2.id);
    const all = await dbGetSessions('/p');
    expect(all.filter(s => s.kind === 'orchestrator')).toHaveLength(1);
  });

  it('persists orchestrator messages across navigate-away-and-back cycles', async () => {
    // Repro for the bug: user chats with orchestrator → opens a focused task
    // (unmounting the orchestrator ChatPanel) → returns to overview. The
    // ChatPanel must remount with the prior messages, which are stored in the
    // separate `messages` IndexedDB store (dbGetSessions returns sessions
    // WITHOUT messages).
    const session = await ensureOrchestratorSession('/p2', 'claude');
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'hello orchestrator', timestamp: Date.now() } as ChatMessage,
      { id: 'm2', role: 'assistant', content: 'hi user', timestamp: Date.now() } as ChatMessage,
    ];

    // Simulate the debounced onMessagesChange persist (full overwrite, fromIdx=0).
    await dbSaveSession('/p2', { ...session, messages, messageCount: messages.length }, 0);

    // Simulate ChatPanel remount: read sessions (messageless) AND fetch messages.
    const sessions = await dbGetSessions('/p2');
    const orch = sessions.find(s => s.kind === 'orchestrator');
    expect(orch).toBeTruthy();
    // Sanity: dbGetSessions strips messages — this is why the orchestrator
    // can't read messages straight off ws.sessions.
    expect(orch!.messages).toEqual([]);

    const persisted = await dbGetMessages(orch!.id);
    expect(persisted).toHaveLength(2);
    expect(persisted[0].content).toBe('hello orchestrator');
    expect(persisted[1].content).toBe('hi user');
  });
});
