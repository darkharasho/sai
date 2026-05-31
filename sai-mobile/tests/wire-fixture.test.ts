import fixtures from './fixtures/wire-messages.json';

describe('wire fixture coverage', () => {
  it('every inbound message has a recognized type', () => {
    const known = new Set([
      'auth_ok', 'pong', 'chat:user', 'chat:assistant', 'chat:delta',
      'tool:use', 'tool:result', 'approval:request',
      'term:data', 'workspace:status',
    ]);
    for (const m of fixtures.inbound) {
      expect(known.has(m.type as string)).toBe(true);
    }
  });
});
