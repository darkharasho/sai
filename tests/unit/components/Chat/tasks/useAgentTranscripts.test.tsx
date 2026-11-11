import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentTranscripts } from '../../../../../src/components/Chat/tasks/useAgentTranscripts';

const asst = (uuid: string, content: unknown[]) => ({ type: 'assistant', uuid, session_id: 's', parent_tool_use_id: null, message: { content } });
const user = (uuid: string, content: unknown[]) => ({ type: 'user', uuid, session_id: 's', parent_tool_use_id: null, message: { content } });
const text = (uuid: string, t: string) => asst(uuid, [{ type: 'text', text: t }]);

let fetchFn: ReturnType<typeof vi.fn>;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  fetchFn = vi.fn();
  (window as any).sai = { claudeSubagentTranscript: fetchFn };
});
afterEach(() => { vi.useRealTimers(); });

describe('useAgentTranscripts', () => {
  it('fetches each id once and polls only live ids', async () => {
    fetchFn.mockImplementation(async (_s: string, id: string) => ({ agentId: id, finished: false, messages: [text('u1', 'hi')], nextOffset: 1 }));
    renderHook(() => useAgentTranscripts('sess', ['a', 'b'], new Set(['a'])));
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledWith('sess', 'a', 0);
    expect(fetchFn).toHaveBeenCalledWith('sess', 'b', 0);
    await tick(2000);
    expect(fetchFn.mock.calls.filter((c) => c[1] === 'a')).toHaveLength(2);
    expect(fetchFn.mock.calls.filter((c) => c[1] === 'b')).toHaveLength(1);
  });

  it('appends incremental chunks using nextOffset', async () => {
    fetchFn
      .mockResolvedValueOnce({ agentId: 'x', finished: false, messages: [text('u1', 'one')], nextOffset: 1 })
      .mockResolvedValueOnce({ agentId: 'x', finished: true, messages: [text('u2', 'two')], nextOffset: 2 });
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set(['a'])));
    await flush();
    expect(result.current.get('a')!.messages).toHaveLength(1);
    await tick(2000);
    expect(fetchFn).toHaveBeenLastCalledWith('sess', 'a', 1);
    const t = result.current.get('a')!;
    expect(t.messages.map((m) => m.content)).toEqual(['one', 'two']);
    expect(t.finished).toBe(true);
    expect(t.unavailable).toBe(false);
  });

  it('pairs a tool_result in a later chunk with its tool_use from an earlier chunk', async () => {
    fetchFn
      .mockResolvedValueOnce({ agentId: 'x', finished: false, nextOffset: 1,
        messages: [asst('u1', [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }])] })
      .mockResolvedValueOnce({ agentId: 'x', finished: false, nextOffset: 2,
        messages: [user('u2', [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file-list' }])] });
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set(['a'])));
    await flush();
    await tick(2000);
    const calls = result.current.get('a')!.messages.flatMap((m) => m.toolCalls ?? []);
    expect(calls).toHaveLength(1);
    expect(calls[0].output).toContain('file-list');
  });

  it('stops polling on unmount and when ids go non-live', async () => {
    fetchFn.mockResolvedValue({ agentId: 'x', finished: false, messages: [], nextOffset: 0 });
    const { rerender, unmount } = renderHook(({ live }) => useAgentTranscripts('sess', ['a'], live), {
      initialProps: { live: new Set(['a']) as ReadonlySet<string> },
    });
    await flush();
    await tick(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    rerender({ live: new Set<string>() });
    await flush(); // one final poll on leaving liveIds
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    rerender({ live: new Set(['a']) });
    await tick(2000);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    unmount();
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('marks a non-live, finished id unavailable on a single null without retrying', async () => {
    fetchFn.mockResolvedValue(null);
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set<string>(), new Set(['a'])));
    await flush();
    expect(result.current.get('a')).toMatchObject({ unavailable: true, messages: [] });
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never marks a live id unavailable on nulls, and backs the retries off', async () => {
    fetchFn.mockResolvedValue(null);
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set(['a'])));
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await tick(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await tick(2000); // backed off to 4s after the second null
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await tick(2000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.current.get('a')).toMatchObject({ unavailable: false, messages: [] });
  });

  it('a live id whose transcript lands only after minutes still loads it, keeping earlier messages', async () => {
    fetchFn
      .mockResolvedValueOnce({ agentId: 'x', finished: false, messages: [text('u1', 'one')], nextOffset: 1 })
      .mockResolvedValue(null);
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set(['a'])));
    await flush();
    await tick(300_000);
    const t = result.current.get('a')!;
    expect(t.unavailable).toBe(false);
    expect(t.messages.map((m) => m.content)).toEqual(['one']);
    fetchFn.mockResolvedValue({ agentId: 'x', finished: true, messages: [text('u2', 'two')], nextOffset: 2 });
    await tick(30_000);
    expect(result.current.get('a')!.messages.map((m) => m.content)).toEqual(['one', 'two']);
  });

  it('a live id that returns null once then succeeds is not unavailable', async () => {
    fetchFn
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ agentId: 'x', finished: false, messages: [text('u1', 'one')], nextOffset: 1 });
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set(['a'])));
    await flush();
    expect(result.current.get('a')!.unavailable).toBe(false);
    await tick(2000);
    expect(result.current.get('a')).toMatchObject({ unavailable: false });
    expect(result.current.get('a')!.messages).toHaveLength(1);
  });

  it('does not duplicate polls or messages when a cancelled fetch settles after a deps change', async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    const pending = [(r: (v: unknown) => void) => { resolveFirst = r; }, (r: (v: unknown) => void) => { resolveSecond = r; }];
    fetchFn.mockImplementation((_s: string, id: string, offset: number) => {
      if (id === 'b') return Promise.resolve({ agentId: 'b', finished: false, messages: [], nextOffset: 0 });
      const hook = pending.shift();
      return hook ? new Promise((r) => hook(r)) : Promise.resolve({ agentId: 'a', finished: false, messages: [], nextOffset: offset });
    });
    const { result, rerender } = renderHook(({ live }) => useAgentTranscripts('sess', ['a', 'b'], live), {
      initialProps: { live: new Set(['a']) as ReadonlySet<string> },
    });
    await flush();
    const callsFor = (id: string) => fetchFn.mock.calls.filter((c) => c[1] === id).length;
    expect(callsFor('a')).toBe(1);
    // live set changes (b goes live) while a's first fetch is still pending
    rerender({ live: new Set(['a', 'b']) });
    await flush();
    expect(callsFor('a')).toBe(2);
    // cancelled first fetch settles; must not clear the new run's in-flight guard
    await act(async () => { resolveFirst({ agentId: 'a', finished: false, messages: [text('u1', 'one')], nextOffset: 1 }); });
    await tick(2000); // second fetch for a is still pending when the tick fires
    expect(callsFor('a')).toBe(2);
    await act(async () => { resolveSecond({ agentId: 'a', finished: false, messages: [text('u1', 'one')], nextOffset: 1 }); });
    expect(result.current.get('a')!.messages.map((m) => m.content)).toEqual(['one']);
  });
  it('an id list change keeps loaded ids (no refetch from 0) and drops removed ones', async () => {
    fetchFn.mockImplementation(async (_s: string, id: string, offset: number) =>
      offset === 0 ? { agentId: id, finished: false, messages: [text(`${id}1`, id)], nextOffset: 1 } : { agentId: id, finished: false, messages: [], nextOffset: offset });
    const { result, rerender } = renderHook(({ ids }) => useAgentTranscripts('sess', ids, new Set<string>()), {
      initialProps: { ids: ['a'] },
    });
    await flush();
    expect(result.current.get('a')!.messages).toHaveLength(1);
    rerender({ ids: ['a', 'b'] });
    await flush();
    expect(fetchFn.mock.calls.filter((c) => c[1] === 'a')).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledWith('sess', 'b', 0);
    expect(result.current.get('a')!.messages).toHaveLength(1);
    expect(result.current.get('b')!.messages).toHaveLength(1);
    rerender({ ids: ['b'] });
    await flush();
    expect(result.current.has('a')).toBe(false);
    expect(result.current.get('b')!.messages).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('stops polling a live id once its transcript is finished, and empty chunks keep the same map', async () => {
    fetchFn
      .mockResolvedValueOnce({ agentId: 'x', finished: false, messages: [text('u1', 'one')], nextOffset: 1 })
      .mockResolvedValueOnce({ agentId: 'x', finished: false, messages: [], nextOffset: 1 })
      .mockResolvedValue({ agentId: 'x', finished: true, messages: [], nextOffset: 1 });
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set(['a'])));
    await flush();
    const first = result.current;
    await tick(2000); // empty chunk, nothing changed
    expect(result.current).toBe(first);
    await tick(2000); // finished flips
    expect(result.current.get('a')!.finished).toBe(true);
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('race: a null before the subagent writes its meta does not stick once the id goes live', async () => {
    fetchFn
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ agentId: 'x', finished: false, messages: [text('u1', 'one')], nextOffset: 1 });
    const { result, rerender } = renderHook(({ live }) => useAgentTranscripts('sess', ['a'], live), {
      initialProps: { live: new Set<string>() as ReadonlySet<string> },
    });
    await flush();
    expect(result.current.get('a')?.unavailable ?? false).toBe(false);
    rerender({ live: new Set(['a']) });
    await tick(2000);
    expect(result.current.get('a')).toMatchObject({ unavailable: false });
    expect(result.current.get('a')!.messages.map((m) => m.content)).toEqual(['one']);
  });

  it('an unavailable id recovers when it re-enters liveIds', async () => {
    fetchFn.mockResolvedValueOnce(null)
      .mockResolvedValue({ agentId: 'x', finished: false, messages: [text('u1', 'one')], nextOffset: 1 });
    const { result, rerender } = renderHook(({ live }) => useAgentTranscripts('sess', ['a'], live, new Set(['a'])), {
      initialProps: { live: new Set<string>() as ReadonlySet<string> },
    });
    await flush();
    expect(result.current.get('a')!.unavailable).toBe(true);
    rerender({ live: new Set(['a']) });
    await tick(2000);
    expect(result.current.get('a')).toMatchObject({ unavailable: false });
    expect(result.current.get('a')!.messages).toHaveLength(1);
  });

  it('live → not-live gets one final poll that picks up the tail', async () => {
    fetchFn
      .mockResolvedValueOnce({ agentId: 'x', finished: false, messages: [text('u1', 'one')], nextOffset: 1 })
      .mockResolvedValue({ agentId: 'x', finished: true, messages: [text('u2', 'two')], nextOffset: 2 });
    const { result, rerender } = renderHook(({ live }) => useAgentTranscripts('sess', ['a'], live, new Set<string>()), {
      initialProps: { live: new Set(['a']) as ReadonlySet<string> },
    });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    rerender({ live: new Set<string>() });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenLastCalledWith('sess', 'a', 1);
    expect(result.current.get('a')!.messages.map((m) => m.content)).toEqual(['one', 'two']);
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('a non-live id that nulled is re-polled once when its card finishes, then marked unavailable', async () => {
    fetchFn.mockResolvedValue(null);
    const { result, rerender } = renderHook(({ fin }) => useAgentTranscripts('sess', ['a'], new Set<string>(), fin), {
      initialProps: { fin: new Set<string>() as ReadonlySet<string> },
    });
    await flush();
    expect(result.current.get('a')?.unavailable ?? false).toBe(false);
    rerender({ fin: new Set(['a']) });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current.get('a')!.unavailable).toBe(true);
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
