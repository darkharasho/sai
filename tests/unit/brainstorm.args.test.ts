import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, BRAINSTORM_SYSTEM_PROMPT } from '../../electron/services/brainstorm';

describe('buildClaudeArgs', () => {
  it('includes -p prompt, output-format stream-json, max-turns 1, append-system-prompt on first turn', () => {
    const args = buildClaudeArgs({ userMessage: 'hello', claudeSessionId: undefined });
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('1');
    expect(args).toContain('--verbose');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(BRAINSTORM_SYSTEM_PROMPT);
    expect(args).not.toContain('--resume');
  });

  it('uses --resume on subsequent turns and omits --append-system-prompt', () => {
    const args = buildClaudeArgs({ userMessage: 'follow-up', claudeSessionId: 'abc-123' });
    expect(args[args.indexOf('--resume') + 1]).toBe('abc-123');
    expect(args).not.toContain('--append-system-prompt');
  });
});
