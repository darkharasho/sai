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
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    rerender({ live: new Set(['a']) });
    await tick(2000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    unmount();
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('marks unavailable on null without retrying', async () => {
    fetchFn.mockResolvedValue(null);
    const { result } = renderHook(() => useAgentTranscripts('sess', ['a'], new Set(['a'])));
    await flush();
    expect(result.current.get('a')).toMatchObject({ unavailable: true, messages: [] });
    await tick(6000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
