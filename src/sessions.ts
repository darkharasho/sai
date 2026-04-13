import type { ChatSession, ChatMessage } from './types';

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
    messageCount: 0,
  };
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

export function exportSessionAsMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${roleLabel}`, '', msg.content, '');
  }
  return lines.join('\n');
}
