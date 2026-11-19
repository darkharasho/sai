import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../src/lib/chat/migrateToLog', () => ({
  ensureChatInLog: vi.fn(async () => {}),
  isChatImported: vi.fn(() => false),
  forgetChatImported: vi.fn(),
}));
import { useChatLog, HIDDEN_FLUSH_MS, _resetUnavailableToastForTests } from '../../../src/hooks/useChatLog';
import * as migrate from '../../../src/lib/chat/migrateToLog';

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
afterEach(() => { delete (window as any).sai; vi.unstubAllGlobals(); _resetUnavailableToastForTests(); vi.mocked(migrate.isChatImported).mockReturnValue(false); vi.mocked(migrate.forgetChatImported).mockClear(); vi.mocked(migrate.ensureChatInLog).mockClear(); });

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

  it('applies live entries in a hidden window where animation frames never run', async () => {
    openMock.mockResolvedValue(res([entry('a', 1)]));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    act(() => { listener(entry('a', 2)); listener(entry('a', 3)); });
    expect(result.current.state?.lastSeq).toBe(1);
    await act(async () => { await new Promise((r) => setTimeout(r, HIDDEN_FLUSH_MS + 50)); });
    expect(result.current.state?.lastSeq).toBe(3);
    expect(result.current.lastApplied.current.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('a history_imported entry reloads the chat from seq 0 (main folded history in front)', async () => {
    openMock.mockResolvedValueOnce(res([entry('a', 1)]));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    const base = { ...(await import('../../../src/lib/chat/reducer')).emptyChatState(settings) };
    const folded = { ...base, lastSeq: 1, messages: [{ id: 'old', role: 'user', content: 'old', timestamp: 0 }, { id: 'm1', role: 'user', content: 'm1', timestamp: 1 }] };
    openMock.mockResolvedValueOnce(res([{ chatId: 'a', seq: 2, ts: 2, ev: { type: 'history_imported' } }], { chatId: 'a', seq: 1, state: folded }));
    act(() => { listener({ chatId: 'a', seq: 2, ts: 2, ev: { type: 'history_imported' } }); });
    await flushMicro();
    expect(openMock).toHaveBeenLastCalledWith('a', 0, { panel: true });
    expect(result.current.state?.messages.map((m: any) => m.id)).toEqual(['old', 'm1']);
    expect(result.current.state?.lastSeq).toBe(2);
    // History, not live activity: no side-effect entries.
    expect(result.current.lastApplied.current).toEqual([]);
  });

  it('a history_imported reload cancels a pending recovery retry (R15.4)', async () => {
    vi.useFakeTimers();
    try {
      openMock.mockResolvedValueOnce(res([entry('a', 1)]));
      const { result } = renderHook(() => useChatLog('a', settings));
      await flushMicro();
      // Gap (seq 3 while at 1): the recovery open fails and a retry is scheduled.
      openMock.mockRejectedValueOnce(new Error('x'));
      act(() => { listener(entry('a', 3)); });
      await flushMicro();
      expect(openMock).toHaveBeenLastCalledWith('a', 1);
      // Seq 2 is history_imported: reload from 0 (which returns everything).
      const base = { ...(await import('../../../src/lib/chat/reducer')).emptyChatState(settings) };
      const folded = { ...base, lastSeq: 2, messages: [{ id: 'old', role: 'user', content: 'old', timestamp: 0 }] };
      openMock.mockResolvedValue(res([entry('a', 3)], { chatId: 'a', seq: 2, state: folded }));
      act(() => { listener({ chatId: 'a', seq: 2, ts: 2, ev: { type: 'history_imported' } }); });
      await flushMicro();
      const callsAfterReload = openMock.mock.calls.length;
      expect(openMock).toHaveBeenLastCalledWith('a', 0, { panel: true });
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      // The stale recovery retry never fires an open(after>0).
      expect(openMock.mock.calls.length).toBe(callsAfterReload);
      expect(result.current.state?.lastSeq).toBe(3);
    } finally { vi.useRealTimers(); }
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

  it('failing gap recovery retries with backoff, bounded, then fills', async () => {
    vi.useFakeTimers();
    try {
      openMock.mockResolvedValueOnce(res([entry('a', 1)]));
      const { result } = renderHook(() => useChatLog('a', settings));
      await flushMicro();
      openMock.mockRejectedValue(new Error('x'));
      act(() => { listener(entry('a', 4)); });
      await flushMicro();
      expect(openMock).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(openMock.mock.calls.length).toBeLessThanOrEqual(5);
      openMock.mockResolvedValue(res([entry('a', 2), entry('a', 3)]));
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      frame();
      expect(result.current.state?.lastSeq).toBe(4);
    } finally { vi.useRealTimers(); }
  });

  it('initial open failure retries and then loads', async () => {
    vi.useFakeTimers();
    try {
      openMock.mockRejectedValueOnce(new Error('x')).mockResolvedValue(res([entry('a', 1)]));
      const { result } = renderHook(() => useChatLog('a', settings));
      await flushMicro();
      expect(result.current.state).toBeNull();
      act(() => { listener(entry('a', 2)); }); // dropped while failing
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(openMock).toHaveBeenCalledTimes(2);
      expect(result.current.state?.lastSeq).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('recovery with a newer snapshot rebuilds from it', async () => {
    const { emptyChatState } = await import('../../../src/lib/chat/reducer');
    openMock.mockResolvedValueOnce(res([entry('a', 1)]));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    openMock.mockResolvedValueOnce(res([entry('a', 6)], { chatId: 'a', seq: 5, state: { ...emptyChatState(settings), lastSeq: 5 } }));
    act(() => { listener(entry('a', 4)); });
    await flushMicro();
    frame();
    expect(result.current.state?.lastSeq).toBe(6);
  });

  it('live entry during pending recovery is buffered; lastApplied accumulates', async () => {
    openMock.mockResolvedValueOnce(res([entry('a', 1)]));
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    const d = deferred<any>();
    openMock.mockReturnValueOnce(d.promise);
    act(() => { listener(entry('a', 2)); }); // queued
    act(() => { listener(entry('a', 4)); }); // gap -> flush + recover
    act(() => { listener(entry('a', 5)); }); // buffered
    d.resolve(res([entry('a', 3)]));
    await flushMicro();
    frame();
    expect(result.current.state?.lastSeq).toBe(5);
    expect(result.current.lastApplied.current.map((e) => e.seq)).toEqual([2, 3, 4, 5]);
  });

  it('returns null state on the first render after a chatId switch', async () => {
    openMock.mockResolvedValue(res([entry('a', 1)]));
    const seen: Array<number | undefined> = [];
    const { rerender } = renderHook(({ id }) => { const r = useChatLog(id, settings); seen.push(r.state?.lastSeq); return r; }, { initialProps: { id: 'a' } });
    await flushMicro();
    openMock.mockReturnValue(new Promise(() => {}));
    seen.length = 0;
    rerender({ id: 'b' });
    expect(seen[0]).toBeUndefined();
  });

  it('the initial open is a panel open (kicks the queue drain); recovery opens are not', async () => {
    openMock.mockResolvedValueOnce(res([entry('a', 1)]));
    renderHook(() => useChatLog('a', settings));
    await flushMicro();
    expect(openMock).toHaveBeenCalledWith('a', 0, { panel: true });
    openMock.mockResolvedValueOnce(res([entry('a', 2)]));
    act(() => { listener(entry('a', 3)); });
    await flushMicro();
    expect(openMock).toHaveBeenLastCalledWith('a', 1);
  });

  it('chat storage unavailable: stops retrying, exposes the error and toasts once', async () => {
    vi.useFakeTimers();
    const toasts: string[] = [];
    const onErr = (e: Event) => toasts.push((e as CustomEvent).detail?.message);
    window.addEventListener('sai-chat-error', onErr);
    try {
      openMock.mockRejectedValue(new Error("Error invoking remote method 'chatlog:open': Error: Chat storage unavailable: EACCES"));
      const a = renderHook(() => useChatLog('a', settings));
      const b = renderHook(() => useChatLog('b', settings));
      await flushMicro();
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(openMock).toHaveBeenCalledTimes(2); // one per hook, no retries
      expect(a.result.current.state).toBeNull();
      expect(a.result.current.error).toMatch(/Chat storage unavailable: EACCES/);
      expect(b.result.current.error).toMatch(/Chat storage unavailable/);
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatch(/Chat storage unavailable/);
    } finally { window.removeEventListener('sai-chat-error', onErr); vi.useRealTimers(); }
  });

  it('other initial-open errors still retry and expose no error', async () => {
    vi.useFakeTimers();
    try {
      openMock.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(res([entry('a', 1)]));
      const { result } = renderHook(() => useChatLog('a', settings));
      await flushMicro();
      expect(result.current.error).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(result.current.state?.lastSeq).toBe(1);
      expect(result.current.error).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a chat main reports unimported after this session settled it (lost snapshot) is re-folded', async () => {
    vi.mocked(migrate.isChatImported).mockReturnValue(true);
    openMock.mockResolvedValue({ ...res([entry('a', 5)]), meta: { chatId: 'a', imported: false } });
    renderHook(() => useChatLog('a', settings));
    await flushMicro();
    await flushMicro();
    expect(migrate.forgetChatImported).toHaveBeenCalledWith('a');
    expect(migrate.ensureChatInLog).toHaveBeenCalledTimes(2);
  });

  it('an imported chat is not re-folded', async () => {
    vi.mocked(migrate.isChatImported).mockReturnValue(true);
    openMock.mockResolvedValue({ ...res([entry('a', 5)]), meta: { chatId: 'a', imported: true } });
    renderHook(() => useChatLog('a', settings));
    await flushMicro();
    await flushMicro();
    expect(migrate.forgetChatImported).not.toHaveBeenCalled();
    expect(migrate.ensureChatInLog).toHaveBeenCalledTimes(1);
  });
});
