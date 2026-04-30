import { describe, it, expect } from 'vitest';
import { computeUnmountFlushes, type WorkspaceLike } from '@/workspaceFlush';
import type { ChatMessage, ChatSession } from '@/types';

const FIXED_NOW = 1_700_000_000_000;

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-' + Math.random(),
    role: 'user',
    content: 'hi',
    timestamp: FIXED_NOW,
    ...overrides,
  };
}

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's-' + Math.random(),
    title: '',
    messages: [],
    messageCount: 0,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function ws(overrides: Partial<ChatSession> = {}): WorkspaceLike {
  return { activeSession: session(overrides) };
}

describe('computeUnmountFlushes', () => {
  it('returns nothing when no workspaces are leaving the mounted set', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set(['/a', '/b']),
      workspaces: new Map([['/a', ws()], ['/b', ws()]]),
      wsMessages: new Map([['/a', [msg()]]]),
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes).toEqual([]);
  });

  it('flushes a workspace that transitions out of the mounted set', () => {
    const m1 = msg({ role: 'user', content: 'hello' });
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set([]),
      workspaces: new Map([['/a', ws({ id: 'sess1', title: 'pre-existing' })]]),
      wsMessages: new Map([['/a', [m1]]]),
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes).toHaveLength(1);
    expect(flushes[0].wsPath).toBe('/a');
    expect(flushes[0].session.id).toBe('sess1');
    expect(flushes[0].session.title).toBe('pre-existing');
    expect(flushes[0].session.messages).toEqual([m1]);
    expect(flushes[0].session.messageCount).toBe(1);
    expect(flushes[0].session.updatedAt).toBe(FIXED_NOW);
    expect(flushes[0].fromIdx).toBe(0);
  });

  it('passes through the workspace fromIdx so splice-saves are correct', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set([]),
      workspaces: new Map([['/a', ws({ title: 't' })]]),
      wsMessages: new Map([['/a', [msg()]]]),
      wsFirstLoadedIdx: new Map([['/a', 250]]),
      now: FIXED_NOW,
    });
    expect(flushes).toHaveLength(1);
    expect(flushes[0].fromIdx).toBe(250);
  });

  it('skips workspaces with no in-flight messages (would clobber DB tail with empty)', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set([]),
      workspaces: new Map([['/a', ws()]]),
      wsMessages: new Map(), // nothing to flush
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes).toEqual([]);
  });

  it('skips workspaces whose message array is empty', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set([]),
      workspaces: new Map([['/a', ws()]]),
      wsMessages: new Map([['/a', []]]),
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes).toEqual([]);
  });

  it('skips a path that no longer has a workspace entry (defensive)', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set([]),
      workspaces: new Map(),
      wsMessages: new Map([['/a', [msg()]]]),
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes).toEqual([]);
  });

  it('generates a smart title when the session has no existing title', () => {
    const userMsg = msg({ role: 'user', content: 'Please help me refactor this file' });
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set([]),
      workspaces: new Map([['/a', ws({ title: '' })]]),
      wsMessages: new Map([['/a', [userMsg]]]),
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes[0].session.title).toBeTruthy();
    expect(flushes[0].session.title).not.toBe('');
  });

  it('does not overwrite an existing title', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set([]),
      workspaces: new Map([['/a', ws({ title: 'My custom title' })]]),
      wsMessages: new Map([['/a', [msg({ role: 'user', content: 'something else' })]]]),
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes[0].session.title).toBe('My custom title');
  });

  it('handles multiple simultaneous unmount transitions', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a', '/b', '/c'],
      nextMounted: new Set(['/c']),
      workspaces: new Map([
        ['/a', ws({ id: 'sa', title: 'A' })],
        ['/b', ws({ id: 'sb', title: 'B' })],
        ['/c', ws({ id: 'sc', title: 'C' })],
      ]),
      wsMessages: new Map([
        ['/a', [msg()]],
        ['/b', [msg(), msg()]],
        ['/c', [msg()]], // still mounted, should not be flushed
      ]),
      wsFirstLoadedIdx: new Map([['/a', 10], ['/b', 0]]),
      now: FIXED_NOW,
    });
    const byPath = Object.fromEntries(flushes.map(f => [f.wsPath, f]));
    expect(Object.keys(byPath).sort()).toEqual(['/a', '/b']);
    expect(byPath['/a'].fromIdx).toBe(10);
    expect(byPath['/a'].session.messageCount).toBe(1);
    expect(byPath['/b'].fromIdx).toBe(0);
    expect(byPath['/b'].session.messageCount).toBe(2);
  });

  it('does not flush a workspace that is busy (still in nextMounted)', () => {
    const flushes = computeUnmountFlushes({
      prevMounted: ['/a'],
      nextMounted: new Set(['/a']), // busy → still mounted
      workspaces: new Map([['/a', ws()]]),
      wsMessages: new Map([['/a', [msg()]]]),
      wsFirstLoadedIdx: new Map(),
      now: FIXED_NOW,
    });
    expect(flushes).toEqual([]);
  });
});
