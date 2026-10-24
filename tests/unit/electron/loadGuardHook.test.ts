// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const guard = vi.hoisted(() => ({ current: null as null | { takeNote: ReturnType<typeof vi.fn> } }));
vi.mock('../../../electron/services/loadGuard/index', () => ({ getLoadGuard: () => guard.current }));

import { buildLoadGuardHook, withLoadNote, makeOnAgentKilled } from '../../../electron/services/loadGuard/hook';

/** A guard holding one pending note: the first take returns it, later takes nothing. */
function oneNote(note: string) {
  let pending: string | null = note;
  return { takeNote: vi.fn(() => { const n = pending; pending = null; return n; }) };
}

const opts = { signal: new AbortController().signal };

describe('buildLoadGuardHook', () => {
  beforeEach(() => { guard.current = null; });

  it('returns additionalContext once, then {}', async () => {
    guard.current = oneNote('LOAD NOTE');
    const hook = buildLoadGuardHook('claude', '/p', 'chat');
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, tool_use_id: 't1' } as any;
    expect(await hook(input, 't1', opts)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'LOAD NOTE' },
    });
    expect(await hook(input, 't2', opts)).toEqual({});
    expect(guard.current.takeNote).toHaveBeenCalledWith('claude', '/p', 'chat');
  });

  it('echoes the UserPromptSubmit event name', async () => {
    guard.current = oneNote('N');
    const hook = buildLoadGuardHook('claude', '/p', 'chat');
    const out = await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' } as any, undefined, opts);
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'N' } });
  });

  it('returns {} when there is no guard (non-linux)', async () => {
    const hook = buildLoadGuardHook('claude', '/p', 'chat');
    expect(await hook({ hook_event_name: 'PreToolUse' } as any, undefined, opts)).toEqual({});
  });

  it('never throws: a takeNote error returns {}', async () => {
    guard.current = { takeNote: vi.fn(() => { throw new Error('boom'); }) };
    const hook = buildLoadGuardHook('claude', '/p', 'chat');
    expect(await hook({ hook_event_name: 'PreToolUse' } as any, undefined, opts)).toEqual({});
  });
});

describe('withLoadNote', () => {
  beforeEach(() => { guard.current = null; });

  it('prefixes the note once', () => {
    guard.current = oneNote('LOAD NOTE');
    expect(withLoadNote('codex', '/p', 'chat', 'do it')).toBe('LOAD NOTE\n\ndo it');
    expect(withLoadNote('codex', '/p', 'chat', 'again')).toBe('again');
    expect(guard.current.takeNote).toHaveBeenCalledWith('codex', '/p', 'chat');
  });

  it('leaves a slash command untouched and keeps the note pending', () => {
    guard.current = oneNote('LOAD NOTE');
    expect(withLoadNote('claude', '/p', 'chat', '  /compact now')).toBe('  /compact now');
    expect(guard.current.takeNote).not.toHaveBeenCalled();
    expect(withLoadNote('claude', '/p', 'chat', 'next')).toBe('LOAD NOTE\n\nnext');
  });

  it('returns the prompt unchanged with no guard or on error', () => {
    expect(withLoadNote('gemini', '/p', 'chat', 'x')).toBe('x');
    guard.current = { takeNote: vi.fn(() => { throw new Error('boom'); }) };
    expect(withLoadNote('kimi', '/p', 'chat', 'x')).toBe('x');
  });
});

describe('makeOnAgentKilled', () => {
  const tag = (over: Record<string, unknown> = {}) => ({ instance: 1, provider: 'claude', projectPath: '/p', scope: 'chat', ...over }) as any;

  it('suspends a claude real scope and devlogs', () => {
    const suspendScope = vi.fn();
    const devlog = vi.fn();
    makeOnAgentKilled(() => ({ suspendScope }), devlog)(tag());
    expect(suspendScope).toHaveBeenCalledWith('/p', 'chat');
    expect(devlog).toHaveBeenCalledWith('agent_killed', expect.objectContaining({ provider: 'claude', scope: 'chat' }));
  });

  it("does nothing beyond the devlog for scope '*' or another provider", () => {
    const suspendScope = vi.fn();
    const devlog = vi.fn();
    const onKilled = makeOnAgentKilled(() => ({ suspendScope }), devlog);
    onKilled(tag({ scope: '*' }));
    onKilled(tag({ provider: 'codex' }));
    onKilled(tag({ provider: 'kimi', scope: '*' }));
    expect(suspendScope).not.toHaveBeenCalled();
    expect(devlog).toHaveBeenCalledTimes(3);
  });

  it('is a no-op on a backend without suspendScope and never throws', () => {
    expect(() => makeOnAgentKilled(() => ({}), vi.fn())(tag())).not.toThrow();
    expect(() => makeOnAgentKilled(() => { throw new Error('x'); }, vi.fn())(tag())).not.toThrow();
  });
});
