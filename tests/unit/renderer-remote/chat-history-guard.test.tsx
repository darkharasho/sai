/**
 * Regression: a `session.history` frame for a session we've navigated away
 * from must not clobber the transcript of the currently attached session
 * (rapid session switching delivered stale history — audit 2026-06-10).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, act, screen } from '@testing-library/react';
import Chat from '../../../src/renderer-remote/chat/Chat';
import { createWorkspaceStatusStore } from '../../../src/renderer-remote/lib/workspaceStatusStore';

type Handler = (msg: unknown) => void;

function makeClient() {
  const handlers = new Set<Handler>();
  const client = {
    on: (h: Handler) => { handlers.add(h); return () => handlers.delete(h); },
    attach: () => {},
    setFollow: () => {},
    sendPrompt: () => {},
    approve: () => {},
    answerQuestion: () => {},
    interrupt: () => {},
    send: () => {},
    listWorkspaces: () => new Promise(() => {}),
    listSessions: () => new Promise(() => {}),
  } as any;
  return { client, fire: (msg: unknown) => { for (const h of handlers) h(msg); } };
}

class RO { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => {
  (globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || RO;
  // Chat reads matchMedia via children in some paths; provide a stub.
  window.matchMedia = window.matchMedia || ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as any);
});

describe('Chat session.history guard', () => {
  it('ignores history frames for a different session and applies matching ones', async () => {
    const { client, fire } = makeClient();
    const statusStore = createWorkspaceStatusStore();
    render(
      <Chat
        client={client}
        statusStore={statusStore}
        active={{ projectPath: '/p', scope: 'chat', sessionId: 'A' }}
        onActiveChange={() => {}}
        follow={false}
        onFollowChange={() => {}}
        onOpenNav={() => {}}
      />
    );

    // Stale frame: history for session B arrives while attached to A.
    await act(async () => {
      fire({ type: 'session.history', sessionId: 'B', messages: [{ role: 'assistant', content: 'stale reply from B' }] });
    });
    expect(screen.queryByText('stale reply from B')).toBeNull();

    // Matching frame applies.
    await act(async () => {
      fire({ type: 'session.history', sessionId: 'A', messages: [{ role: 'assistant', content: 'fresh reply from A' }] });
    });
    expect(screen.queryByText('fresh reply from A')).not.toBeNull();
  });
});
