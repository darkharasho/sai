// Load-guard chat events ("Stopped to save your PC" / "System load:" cards) for chats
// with no mounted ChatPanel. A mounted panel renders them live; for the others App
// buffers the card into the same per-session buffer it keeps for background assistant
// content (chatFrameGate.scopeMessageBuffer), so it is merged on select, drained by the
// panel on mount and persisted by the background done flush, all deduped by id.

import type { ChatMessage, ChatSession, LoadGuardChatEvent } from '../types';
import { hasChatListener, scopeMessageBuffer } from './chatFrameGate';

interface WorkspaceSessions {
  activeSession: Pick<ChatSession, 'id' | 'aiProvider'>;
  sessions: Pick<ChatSession, 'id' | 'aiProvider'>[];
}

let fallbackSeq = 0;

/** The chat card for a `load_guard` envelope; null for anything else or an unknown kind. */
export function loadGuardCard(msg: any, now: number = Date.now()): ChatMessage | null {
  if (!msg || msg.type !== 'load_guard') return null;
  const ev = msg.loadGuard as LoadGuardChatEvent | undefined;
  if (ev?.kind !== 'note' && ev?.kind !== 'killed') return null;
  // main stamps the id, so App's buffered copy and a live panel's copy dedupe
  const id = typeof msg.id === 'string' && msg.id ? msg.id : `load-guard-${now}-${++fallbackSeq}`;
  return { id, role: 'system', content: '', timestamp: now, loadGuard: ev };
}

/**
 * Session ids a load-guard event is for. Tags may carry '*' for project and scope
 * (Ruling R5): a '*' scope fans out to every session of the provider (sessions with no
 * provider are claude). The legacy 'chat' scope isn't backed by a session.
 */
export function loadGuardTargetSessions(msg: any, workspaces: ReadonlyMap<string, WorkspaceSessions>): string[] {
  const out = new Set<string>();
  if (msg?.scope === 'chat') return [];
  for (const [wsPath, ws] of workspaces) {
    if (msg.projectPath !== '*' && msg.projectPath !== wsPath) continue;
    const sessions = [ws.activeSession, ...ws.sessions];
    for (const s of sessions) {
      if (!s?.id) continue;
      if (msg.scope === '*' ? (s.aiProvider ?? 'claude') === msg.provider : s.id === msg.scope) out.add(s.id);
    }
  }
  return [...out];
}

/** Buffers a load-guard card for every target session no panel is listening for. */
export function bufferLoadGuardEvent(
  msg: any,
  workspaces: ReadonlyMap<string, WorkspaceSessions>,
  now: number = Date.now(),
): void {
  const card = loadGuardCard(msg, now);
  if (!card) return;
  for (const id of loadGuardTargetSessions(msg, workspaces)) {
    if (hasChatListener(id)) continue;
    const prev = scopeMessageBuffer.get(id) ?? [];
    if (prev.some(m => m.id === card.id)) continue;
    scopeMessageBuffer.set(id, [...prev, card]);
  }
}
