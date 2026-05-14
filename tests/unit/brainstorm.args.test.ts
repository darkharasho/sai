import { describe, it, expect } from 'vitest';
import {
  buildClaudeArgs,
  BRAINSTORM_SYSTEM_PROMPT,
  composeTurnPrompt,
} from '../../electron/services/brainstorm';

describe('buildClaudeArgs', () => {
  it('builds a stateless one-shot invocation with the system prompt', () => {
    const args = buildClaudeArgs({ prompt: 'hello' });
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('1');
    expect(args).toContain('--verbose');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(BRAINSTORM_SYSTEM_PROMPT);
    expect(args).not.toContain('--resume');
  });
});

describe('composeTurnPrompt', () => {
  it('returns the user message unchanged when transcript is empty', () => {
    expect(composeTurnPrompt([], 'first message')).toBe('first message');
  });

  it('embeds prior transcript with role tags before the new message', () => {
    const out = composeTurnPrompt([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello — what are we building?' },
    ], 'a CLI tool');
    expect(out).toContain('Conversation so far:');
    expect(out).toContain('User: hi');
    expect(out).toContain('You: hello — what are we building?');
    expect(out).toContain("User's next message: a CLI tool");
  });
});
