// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const guard = vi.hoisted(() => ({ current: null as null | { takeNote: ReturnType<typeof vi.fn> } }));
vi.mock('../../../electron/services/loadGuard/index', () => ({ getLoadGuard: () => guard.current }));

import { buildLoadGuardHook, withLoadNote } from '../../../electron/services/loadGuard/hook';

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

  it('returns the prompt unchanged with no guard or on error', () => {
    expect(withLoadNote('gemini', '/p', 'chat', 'x')).toBe('x');
    guard.current = { takeNote: vi.fn(() => { throw new Error('boom'); }) };
    expect(withLoadNote('kimi', '/p', 'chat', 'x')).toBe('x');
  });
});
