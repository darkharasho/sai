import type { ChatSession, ChatMessage } from './types';

const LEGACY_KEY = 'sai-chat-sessions';
const MAX_SESSIONS = 200;

function indexKey(projectPath: string): string {
  return `sai-sessions-index-${projectPath}`;
}

function messagesKey(sessionId: string): string {
  return `sai-session-msgs-${sessionId}`;
}

// Strip messages for index storage
function toIndexEntry(session: ChatSession): ChatSession {
  return { ...session, messages: [] };
}

export function loadSessions(projectPath: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(indexKey(projectPath));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function loadSessionMessages(sessionId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(messagesKey(sessionId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSessionMessages(sessionId: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(messagesKey(sessionId), JSON.stringify(messages));
  } catch {
    // localStorage quota exceeded
  }
}

function saveIndex(projectPath: string, sessions: ChatSession[]): void {
  try {
    localStorage.setItem(indexKey(projectPath), JSON.stringify(sessions.map(toIndexEntry)));
  } catch {
    // localStorage quota exceeded
  }
}

export function saveSessions(projectPath: string, sessions: ChatSession[]): void {
  saveIndex(projectPath, sessions);
}

export function migrateLegacySessions(projectPath: string): void {
  try {
    // Migrate from legacy single-key format
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const existing = loadSessions(projectPath);
      if (existing.length === 0) {
        const parsed: ChatSession[] = JSON.parse(legacy);
        // Save messages separately, then store index
        for (const s of parsed) {
          if (s.messages.length > 0) {
            saveSessionMessages(s.id, s.messages);
          }
        }
        saveIndex(projectPath, parsed);
      }
      localStorage.removeItem(LEGACY_KEY);
    }

    // Migrate from old combined format (sai-chat-sessions-<path>)
    const oldKey = `sai-chat-sessions-${projectPath}`;
    const oldData = localStorage.getItem(oldKey);
    if (oldData) {
      const existing = loadSessions(projectPath);
      if (existing.length === 0) {
        const parsed: ChatSession[] = JSON.parse(oldData);
        for (const s of parsed) {
          if (s.messages.length > 0) {
            saveSessionMessages(s.id, s.messages);
          }
        }
        saveIndex(projectPath, parsed);
      }
      localStorage.removeItem(oldKey);
    }
  } catch {
    // Migration failed - not critical
  }
}

const FILLER_PREFIXES = [
  'can you ', 'could you ', 'would you ',
  'please ', 'help me ', 'i need to ', 'i want to ',
  "let's ", 'let me ', 'we need to ', 'we should ',
];

export function generateSmartTitle(text: string): string {
  let result = text.trim();
  if (!result) return '';

  let changed = true;
  while (changed) {
    changed = false;
    const lower = result.toLowerCase();
    for (const prefix of FILLER_PREFIXES) {
      if (lower.startsWith(prefix)) {
        result = result.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }

  if (!result) return '';
  result = result.charAt(0).toUpperCase() + result.slice(1);
  if (result.length > 40) {
    result = result.slice(0, 40);
  }
  return result;
}

export function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  // Skip empty sessions — don't add or update, but never remove existing entries
  if (session.messages.length === 0) {
    return sessions;
  }

  // Set title from first user message if not set
  if (!session.title) {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      session.title = generateSmartTitle(firstUserMsg.content);
    }
  }

  session.updatedAt = Date.now();

  // Save messages separately
  saveSessionMessages(session.id, session.messages);

  const entry = toIndexEntry(session);
  const existing = sessions.findIndex(s => s.id === session.id);
  let updated: ChatSession[];
  if (existing >= 0) {
    updated = [...sessions];
    updated[existing] = entry;
  } else {
    updated = [entry, ...sessions];
  }

  // Sort by updatedAt descending, keep max
  updated.sort((a, b) => b.updatedAt - a.updatedAt);
  return updated.slice(0, MAX_SESSIONS);
}

export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (sessionDate.getTime() === today.getTime()) return 'Today';
  if (sessionDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatSessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function toggleSessionPin(sessions: ChatSession[], sessionId: string): ChatSession[] {
  return sessions.map(s =>
    s.id === sessionId ? { ...s, pinned: !s.pinned } : s
  );
}

export function deleteSession(sessions: ChatSession[], sessionId: string): ChatSession[] {
  try {
    localStorage.removeItem(messagesKey(sessionId));
  } catch {
    // Ignore
  }
  return sessions.filter(s => s.id !== sessionId);
}

export function exportSessionAsMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${roleLabel}`, '', msg.content, '');
  }
  return lines.join('\n');
}
