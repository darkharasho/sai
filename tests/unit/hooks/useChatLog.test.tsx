import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../src/lib/chat/migrateToLog', () => ({ ensureChatInLog: vi.fn(async () => {}) }));
import { useChatLog } from '../../../src/hooks/useChatLog';

const settings = { provider: 'claude' } as any;
const ev = (text: string) => ({ type: 'user_message', clientId: text, text } as any);
const entry = (chatId: string, seq: number) => ({ chatId, seq, ts: seq, ev: ev(`m${seq}`) });

let listener: (e: any) => void = () => {};
let openMock: ReturnType<typeof vi.fn>;
let rafQueue: Array<() => void> = [];
const frame = () => { const q = rafQueue; rafQueue = []; act(() => { q.forEach((f) => f()); }); };
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const flushMicro = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const res = (entries: any[], snapshot: any = null) => ({ snapshot, entries, headSeq: entries.at(-1)?.seq ?? 0, meta: null });

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => { rafQueue.push(f); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  openMock = vi.fn();
  (window as any).sai = { chatlog: { open: openMock, onEvent: (cb: any) => { listener = cb; return () => { listener = () => {}; }; } } };
});
afterEach(() => { delete (window as any).sai; vi.unstubAllGlobals(); });

describe('useChatLog', () => {
  it('applies snapshot then entries', async () => {
    const base = { ...(await import('../../../src/lib/chat/reducer')).emptyChatState(settings) };
    openMock.mockResolvedValue(res([entry('a', 6), entry('a', 7)], { chatId: 'a', seq: 5, state: { ...base, lastSeq: 5 } }));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    expect(result.current.state?.lastSeq).toBe(7);
  });

  it('live events before open are not lost', async () => {
    const d = deferred<any>();
    openMock.mockReturnValue(d.promise);
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    act(() => { listener(entry('a', 3)); });
    d.resolve(res([entry('a', 1), entry('a', 2)]));
    await flushMicro();
    frame();
    expect(result.current.state?.lastSeq).toBe(3);
  });

  it('duplicate seq is ignored', async () => {
    openMock.mockResolvedValue(res([entry('a', 1)]));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    act(() => { listener(entry('a', 1)); listener(entry('a', 2)); listener(entry('a', 2)); });
    frame();
    expect(result.current.state?.lastSeq).toBe(2);
    expect(result.current.lastApplied.current.map((e) => e.seq)).toEqual([2]);
  });

  it('a gap triggers open(chatId, lastSeq) and fills in', async () => {
    openMock.mockResolvedValueOnce(res([entry('a', 1)]));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    openMock.mockResolvedValueOnce(res([entry('a', 2), entry('a', 3)]));
    act(() => { listener(entry('a', 4)); });
    await flushMicro();
    frame();
    expect(openMock).toHaveBeenLastCalledWith('a', 1);
    expect(result.current.state?.lastSeq).toBe(4);
  });

  it('batches many deltas into one render per frame', async () => {
    openMock.mockResolvedValue(res([entry('a', 1)]));
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useChatLog('a', settings); });
    await flushMicro();
    const before = renders;
    act(() => { for (let s = 2; s <= 20; s++) listener(entry('a', s)); });
    expect(renders).toBe(before);
    frame();
    expect(renders).toBe(before + 1);
    expect(result.current.state?.lastSeq).toBe(20);
  });

  it('switching chatId ignores the stale open result', async () => {
    const d = deferred<any>();
    openMock.mockReturnValueOnce(d.promise);
    const { result, rerender } = renderHook(({ id }) => useChatLog(id, settings), { initialProps: { id: 'a' } });
    await flushMicro();
    openMock.mockResolvedValueOnce(res([entry('b', 1)]));
    rerender({ id: 'b' });
    await flushMicro();
    d.resolve(res([entry('a', 1), entry('a', 2), entry('a', 3)]));
    await flushMicro();
    expect(result.current.state?.lastSeq).toBe(1);
  });

  it('events for other chats are ignored', async () => {
    openMock.mockResolvedValue(res([entry('a', 1)]));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    act(() => { listener(entry('other', 2)); });
    frame();
    expect(result.current.state?.lastSeq).toBe(1);
  });

  it('null chatId yields null state', async () => {
    const { result } = renderHook(() => useChatLog(null, settings));
    await flushMicro();
    expect(result.current.state).toBeNull();
    expect(openMock).not.toHaveBeenCalled();
  });
});
