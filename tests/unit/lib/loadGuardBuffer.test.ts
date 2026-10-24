import { describe, it, expect, beforeEach } from 'vitest';
import { loadGuardCard, loadGuardTargetSessions, bufferLoadGuardEvent } from '../../../src/lib/loadGuardBuffer';
import { registerChatListener, scopeMessageBuffer, takeBufferedMessages, _resetChatFrameGate } from '../../../src/lib/chatFrameGate';
import type { ChatSession } from '../../../src/types';

const killed = { kind: 'killed', unitKind: 'agent', label: 'claude', sizeKb: 1, memUsedPct: 95, top: [], toldAi: 'x' };
const ev = (over: Record<string, unknown> = {}) => ({
  type: 'load_guard', id: 'lg-1', projectPath: '/a', scope: 's1', provider: 'claude', loadGuard: killed, ...over,
});
const session = (id: string, aiProvider?: ChatSession['aiProvider']) =>
  ({ id, title: id, messages: [], createdAt: 0, updatedAt: 0, ...(aiProvider ? { aiProvider } : {}) }) as ChatSession;
const ws = (active: ChatSession, ...rest: ChatSession[]) => ({ activeSession: active, sessions: [active, ...rest] });

describe('loadGuardCard', () => {
  it('builds a system card carrying the event, with the envelope id', () => {
    expect(loadGuardCard(ev(), 5)).toEqual({ id: 'lg-1', role: 'system', content: '', timestamp: 5, loadGuard: killed });
  });

  it('rejects unknown kinds and non-load_guard messages', () => {
    expect(loadGuardCard(ev({ loadGuard: { kind: 'bogus' } }))).toBeNull();
    expect(loadGuardCard(ev({ loadGuard: undefined }))).toBeNull();
    expect(loadGuardCard({ type: 'assistant' })).toBeNull();
  });

  it('falls back to a generated id when the envelope has none', () => {
    expect(loadGuardCard(ev({ id: undefined }), 7)?.id).toMatch(/^load-guard-7-/);
  });
});

describe('loadGuardTargetSessions', () => {
  const workspaces = new Map([
    ['/a', ws(session('s1'), session('k1', 'kimi'), session('k2', 'kimi'), session('c1', 'codex'))],
    ['/b', ws(session('k3', 'kimi'), session('c2', 'codex'))],
  ]);

  it('an exact scope targets that session of that project', () => {
    expect(loadGuardTargetSessions(ev(), workspaces)).toEqual(['s1']);
    expect(loadGuardTargetSessions(ev({ projectPath: '/b' }), workspaces)).toEqual([]);
  });

  it("a '*' scope fans out to every session of the provider in the project", () => {
    expect(loadGuardTargetSessions(ev({ scope: '*', provider: 'kimi' }), workspaces).sort()).toEqual(['k1', 'k2']);
  });

  it("a '*' project fans out across workspaces", () => {
    expect(loadGuardTargetSessions(ev({ projectPath: '*', scope: '*', provider: 'codex' }), workspaces).sort()).toEqual(['c1', 'c2']);
  });

  it("an untagged session counts as claude; the legacy 'chat' scope has no session", () => {
    expect(loadGuardTargetSessions(ev({ scope: '*' }), workspaces)).toEqual(['s1']);
    expect(loadGuardTargetSessions(ev({ scope: 'chat' }), workspaces)).toEqual([]);
  });
});

describe('bufferLoadGuardEvent (I5)', () => {
  beforeEach(() => _resetChatFrameGate());
  const workspaces = new Map([['/a', ws(session('s1'), session('s2'))]]);

  it('buffers the card for a session with no listening panel, deduped by id', () => {
    bufferLoadGuardEvent(ev({ scope: 's2' }), workspaces, 3);
    bufferLoadGuardEvent(ev({ scope: 's2' }), workspaces, 4);
    expect(scopeMessageBuffer.get('s2')).toEqual([{ id: 'lg-1', role: 'system', content: '', timestamp: 3, loadGuard: killed }]);
  });

  it('skips a session whose panel is listening (it renders the card live)', () => {
    registerChatListener('s1');
    bufferLoadGuardEvent(ev(), workspaces);
    expect(scopeMessageBuffer.has('s1')).toBe(false);
  });

  it('appends after buffered assistant content and is drained with it', () => {
    scopeMessageBuffer.set('s2', [{ id: 'a1', role: 'assistant', content: 'hi', timestamp: 1 }]);
    bufferLoadGuardEvent(ev({ scope: 's2' }), workspaces, 2);
    expect(takeBufferedMessages('s2').map(m => m.id)).toEqual(['a1', 'lg-1']);
  });
});
