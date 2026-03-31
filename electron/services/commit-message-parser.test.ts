import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCodexCommitMessage } from './commit-message-parser.ts';

test('extractCodexCommitMessage reads agent_message text from Codex JSONL output', () => {
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

  assert.equal(
    extractCodexCommitMessage(output),
    'fix(git): generate commit messages with codex',
  );
});

test('extractCodexCommitMessage preserves legacy message content parsing', () => {
  const output = JSON.stringify({
    type: 'message',
    content: 'fix(git): preserve legacy parser compatibility',
  });

  assert.equal(
    extractCodexCommitMessage(output),
    'fix(git): preserve legacy parser compatibility',
  );
});
