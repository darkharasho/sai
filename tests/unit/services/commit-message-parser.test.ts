import { describe, it, expect } from 'vitest';
import { extractCodexCommitMessage } from '@electron/services/commit-message-parser';

describe('extractCodexCommitMessage', () => {
  describe('item.completed JSONL format (preferred path)', () => {
    it('extracts message from item.completed with agent_message type', () => {
      const output = [
        JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
        JSON.stringify({ type: 'turn.started', turn_id: 'def' }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'fix(git): generate commit messages with codex',
          },
        }),
        JSON.stringify({ type: 'turn.completed' }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe(
        'fix(git): generate commit messages with codex',
      );
    });

    it('returns the last item.completed message when multiple are present', () => {
      const output = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'first message' },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'second message' },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'final commit message' },
        }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('final commit message');
    });

    it('ignores item.completed lines where item.type is not agent_message', () => {
      const output = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'tool_call', text: 'should be ignored' },
        }),
        JSON.stringify({
          type: 'message',
          content: 'fallback legacy message',
        }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('fallback legacy message');
    });

    it('ignores item.completed lines where item.text is empty', () => {
      const output = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '' },
        }),
        JSON.stringify({ type: 'message', content: 'non-empty fallback' }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('non-empty fallback');
    });

    it('ignores item.completed lines where item.text is whitespace only', () => {
      const output = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '   ' },
        }),
        JSON.stringify({ type: 'message', content: 'valid message' }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('valid message');
    });

    it('ignores item.completed lines where item.text is missing', () => {
      const output = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message' },
        }),
        JSON.stringify({ type: 'message', content: 'used instead' }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('used instead');
    });
  });

  describe('legacy message format (fallback path)', () => {
    it('extracts message from legacy format with type: message', () => {
      const output = JSON.stringify({
        type: 'message',
        content: 'fix(git): preserve legacy parser compatibility',
      });

      expect(extractCodexCommitMessage(output)).toBe(
        'fix(git): preserve legacy parser compatibility',
      );
    });

    it('ignores legacy message lines where content is empty and falls back to raw output', () => {
      const line1 = JSON.stringify({ type: 'message', content: '' });
      const line2 = 'plain raw output';
      const output = [line1, line2].join('\n');

      // No valid candidates: falls back to output.trim() (entire raw output)
      expect(extractCodexCommitMessage(output)).toBe(output.trim());
    });

    it('ignores legacy message lines where content is whitespace only and falls back to raw output', () => {
      const line1 = JSON.stringify({ type: 'message', content: '   \t  ' });
      const line2 = 'raw fallback';
      const output = [line1, line2].join('\n');

      // No valid candidates: falls back to output.trim() (entire raw output)
      expect(extractCodexCommitMessage(output)).toBe(output.trim());
    });

    it('ignores legacy message lines where content is not a string and falls back to raw output', () => {
      const line1 = JSON.stringify({ type: 'message', content: 42 });
      const line2 = 'raw fallback';
      const output = [line1, line2].join('\n');

      // No valid candidates: falls back to output.trim() (entire raw output)
      expect(extractCodexCommitMessage(output)).toBe(output.trim());
    });
  });

  describe('raw output fallback', () => {
    it('returns raw output when no valid JSON lines are found', () => {
      const output = 'not json at all\njust plain text output';

      expect(extractCodexCommitMessage(output)).toBe(
        'not json at all\njust plain text output',
      );
    });

    it('returns raw output when JSON lines have no recognized type', () => {
      const output = [
        JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
        JSON.stringify({ type: 'turn.completed' }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe(output.trim());
    });

    it('handles empty output by returning empty string', () => {
      expect(extractCodexCommitMessage('')).toBe('');
    });

    it('handles whitespace-only output by returning empty string', () => {
      expect(extractCodexCommitMessage('   \n   \n   ')).toBe('');
    });
  });

  describe('malformed JSON handling', () => {
    it('skips malformed JSON lines and continues processing', () => {
      const output = [
        'not valid json {{{',
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'valid message' },
        }),
        'another bad line <<<',
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('valid message');
    });

    it('falls back to raw output when all JSON lines are malformed', () => {
      const output = ['bad json {', 'also bad json }', 'truncated: {'].join(
        '\n',
      );

      expect(extractCodexCommitMessage(output)).toBe(output.trim());
    });

    it('handles a mix of valid and malformed JSON lines', () => {
      const output = [
        JSON.stringify({ type: 'turn.started' }),
        'malformed line',
        JSON.stringify({ type: 'message', content: 'the commit message' }),
        'another bad line',
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('the commit message');
    });
  });

  describe('preference: item.completed over legacy format', () => {
    it('prefers item.completed over legacy message when both are present', () => {
      const output = [
        JSON.stringify({ type: 'message', content: 'legacy message' }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'preferred message' },
        }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('preferred message');
    });

    it('uses legacy message when item.completed appears before it', () => {
      const output = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'earlier message' },
        }),
        JSON.stringify({ type: 'message', content: 'later legacy message' }),
      ].join('\n');

      // The function returns candidates.at(-1), so the last candidate wins
      expect(extractCodexCommitMessage(output)).toBe('later legacy message');
    });
  });

  describe('whitespace trimming', () => {
    it('trims leading and trailing whitespace from item.completed text', () => {
      const output = JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '  trimmed message  ' },
      });

      expect(extractCodexCommitMessage(output)).toBe('trimmed message');
    });

    it('trims leading and trailing whitespace from legacy content', () => {
      const output = JSON.stringify({
        type: 'message',
        content: '\n  trimmed legacy content\n',
      });

      expect(extractCodexCommitMessage(output)).toBe('trimmed legacy content');
    });

    it('trims raw output fallback when no candidates match', () => {
      const output = '  plain text with surrounding whitespace  ';

      expect(extractCodexCommitMessage(output)).toBe(
        'plain text with surrounding whitespace',
      );
    });
  });

  describe('multiple content blocks', () => {
    it('returns the last valid candidate across multiple content blocks', () => {
      const output = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'block one' },
        }),
        JSON.stringify({ type: 'message', content: 'block two' }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'block three' },
        }),
        JSON.stringify({ type: 'message', content: 'block four' }),
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('block four');
    });

    it('handles interleaved noise lines between valid content blocks', () => {
      const output = [
        JSON.stringify({ type: 'thread.started' }),
        'some raw stderr output',
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'message from block' },
        }),
        JSON.stringify({ type: 'turn.completed' }),
        'more noise',
      ].join('\n');

      expect(extractCodexCommitMessage(output)).toBe('message from block');
    });
  });
});
