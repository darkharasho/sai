import fixtures from './fixtures/wire-messages.json';

describe('wire fixture coverage', () => {
  it('every inbound message has a recognized type', () => {
    const known = new Set([
      'auth_ok', 'pong',
      'assistant', 'user', 'user_message',
      'result', 'done', 'streaming_start',
      'session.active', 'session.history',
      'approval_needed', 'question_answered',
      'terminal.output', 'terminal.exit',
      'workspace.status',
      'workspaces.list.result', 'files.list.result', 'files.read.result',
      'files.status.result', 'files.diff.result',
      'sessions.list.result',
      'terminal.list.result', 'terminal.opened', 'terminal.attached',
      'terminal.kill.result',
      'git.stage.result', 'git.unstage.result', 'git.commit.result',
      'git.push.result', 'git.pull.result',
      'files.write.result', 'error',
    ]);
    for (const m of fixtures.inbound) {
      expect(known.has(m.type as string)).toBe(true);
    }
  });
});
