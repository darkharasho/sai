import { describe, it, expect } from 'vitest';
import {
  createSession,
  formatSessionDate,
  formatSessionTime,
  generateSmartTitle,
  exportSessionAsMarkdown,
} from '@/sessions';
import type { ChatSession, ChatMessage } from '@/types';

// Helper to build minimal ChatMessage objects
function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

// Helper to build ChatSession objects for testing
function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Test session',
    messages: [makeMessage()],
    createdAt: now,
    updatedAt: now,
    messageCount: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('creates a session with a non-empty unique id', () => {
    const session = createSession();
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
  });

  it('creates a session with an empty messages array', () => {
    const session = createSession();
    expect(session.messages).toEqual([]);
  });

  it('creates a session with createdAt and updatedAt timestamps', () => {
    const before = Date.now();
    const session = createSession();
    const after = Date.now();

    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.createdAt).toBeLessThanOrEqual(after);
    expect(session.updatedAt).toBeGreaterThanOrEqual(before);
    expect(session.updatedAt).toBeLessThanOrEqual(after);
  });

  it('generates a different id for each call', () => {
    const ids = new Set(Array.from({ length: 10 }, () => createSession().id));
    expect(ids.size).toBe(10);
  });

  it('creates a session with messageCount: 0', () => {
    const session = createSession();
    expect(session.messageCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatSessionDate
// ---------------------------------------------------------------------------

describe('formatSessionDate', () => {
  it('formats a timestamp from today as "Today"', () => {
    const now = Date.now();
    expect(formatSessionDate(now)).toBe('Today');
  });

  it('formats a timestamp from earlier today as "Today"', () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    expect(formatSessionDate(startOfDay.getTime())).toBe('Today');
  });

  it('formats a timestamp from yesterday as "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    expect(formatSessionDate(yesterday.getTime())).toBe('Yesterday');
  });

  it('formats older dates with a short month/day format', () => {
    // A date well in the past (Jan 15, 2020)
    const old = new Date(2020, 0, 15).getTime();
    const result = formatSessionDate(old);
    // Should NOT be "Today" or "Yesterday"
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    // Should contain "Jan" and "15"
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });

  it('formats a date two days ago with month/day format', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(12, 0, 0, 0);
    const result = formatSessionDate(twoDaysAgo.getTime());
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatSessionTime
// ---------------------------------------------------------------------------

describe('formatSessionTime', () => {
  it('formats a timestamp as a localized 12-hour time string', () => {
    // Use a known timestamp: noon on an arbitrary date
    const noon = new Date(2024, 5, 15, 12, 30, 0).getTime();
    const result = formatSessionTime(noon);
    // Should include AM/PM indicator
    expect(result).toMatch(/AM|PM/i);
  });

  it('includes hour and two-digit minutes', () => {
    const time = new Date(2024, 0, 1, 9, 5, 0).getTime();
    const result = formatSessionTime(time);
    // Should include minutes with leading zero: "05"
    expect(result).toMatch(/\d+:\d{2}/);
  });

  it('returns a non-empty string for any valid timestamp', () => {
    const timestamps = [0, Date.now(), new Date(2025, 11, 31, 23, 59).getTime()];
    for (const ts of timestamps) {
      expect(formatSessionTime(ts).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// generateSmartTitle
// ---------------------------------------------------------------------------

describe('generateSmartTitle', () => {
  it('strips "can you" prefix', () => {
    expect(generateSmartTitle('Can you fix the border?')).toBe('Fix the border?');
  });
  it('strips "could you" prefix', () => {
    expect(generateSmartTitle('Could you help me debug this?')).toBe('Debug this?');
  });
  it('strips "would you" prefix', () => {
    expect(generateSmartTitle('Would you refactor this function?')).toBe('Refactor this function?');
  });
  it('strips "please" prefix', () => {
    expect(generateSmartTitle('Please update the config')).toBe('Update the config');
  });
  it('strips "help me" prefix', () => {
    expect(generateSmartTitle('help me fix the auth bug')).toBe('Fix the auth bug');
  });
  it('strips "I need to" prefix', () => {
    expect(generateSmartTitle('I need to implement a sidebar')).toBe('Implement a sidebar');
  });
  it('strips "I want to" prefix', () => {
    expect(generateSmartTitle('I want to add dark mode')).toBe('Add dark mode');
  });
  it('strips "let\'s" prefix', () => {
    expect(generateSmartTitle("let's build a command palette")).toBe('Build a command palette');
  });
  it('strips "let me" prefix', () => {
    expect(generateSmartTitle('let me see the logs')).toBe('See the logs');
  });
  it('strips "we need to" prefix', () => {
    expect(generateSmartTitle('we need to fix the tests')).toBe('Fix the tests');
  });
  it('strips "we should" prefix', () => {
    expect(generateSmartTitle('we should refactor this')).toBe('Refactor this');
  });
  it('strips multiple chained prefixes', () => {
    expect(generateSmartTitle('Can you please help me fix this?')).toBe('Fix this?');
  });
  it('capitalizes first letter after stripping', () => {
    expect(generateSmartTitle('can you fix it')).toBe('Fix it');
  });
  it('truncates to 40 characters', () => {
    const long = 'Fix ' + 'a'.repeat(50);
    expect(generateSmartTitle(long).length).toBeLessThanOrEqual(40);
  });
  it('returns original text when no prefix matches', () => {
    expect(generateSmartTitle('Fix the border on code blocks')).toBe('Fix the border on code blocks');
  });
  it('returns empty string for empty input', () => {
    expect(generateSmartTitle('')).toBe('');
  });
  it('handles whitespace-only input', () => {
    expect(generateSmartTitle('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// exportSessionAsMarkdown
// ---------------------------------------------------------------------------

describe('exportSessionAsMarkdown', () => {
  it('formats messages as markdown with role headers', () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: 'user', content: 'Hello' }),
      makeMessage({ role: 'assistant', content: 'Hi there' }),
    ];
    const md = exportSessionAsMarkdown('Test Chat', messages);
    expect(md).toContain('# Test Chat');
    expect(md).toContain('## User');
    expect(md).toContain('Hello');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hi there');
  });

  it('skips system messages', () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: 'system', content: 'System prompt' }),
      makeMessage({ role: 'user', content: 'Hello' }),
    ];
    const md = exportSessionAsMarkdown('Test', messages);
    expect(md).not.toContain('System prompt');
    expect(md).toContain('Hello');
  });

  it('handles empty messages array', () => {
    const md = exportSessionAsMarkdown('Empty', []);
    expect(md).toContain('# Empty');
  });
});
