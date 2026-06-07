import type { AIProvider, ChatSession } from '../types';

export function inferSessionProvider(session: ChatSession): AIProvider {
  if (session.aiProvider) return session.aiProvider;
  if (session.geminiSessionId) return 'gemini';
  if (session.codexSessionId) return 'codex';
  return 'claude';
}
