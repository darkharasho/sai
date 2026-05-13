import { dbGetSessions, dbSaveSession } from '../chatDb';
import type { AIProvider, ChatSession } from '../types';

export async function ensureOrchestratorSession(projectPath: string, provider: AIProvider): Promise<ChatSession> {
  const all = await dbGetSessions(projectPath);
  const existing = all.find((s: ChatSession) => s.kind === 'orchestrator');
  if (existing) return existing;
  const now = Date.now();
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title: 'Swarm Orchestrator',
    messages: [],
    createdAt: now,
    updatedAt: now,
    aiProvider: provider,
    projectPath,
    pinned: true,
    messageCount: 0,
    kind: 'orchestrator',
  };
  await dbSaveSession(projectPath, session);
  return session;
}
