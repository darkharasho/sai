import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../src/lib/chat/migrateToLog', () => ({
  ensureChatInLog: vi.fn(async () => {}),
  isChatImported: vi.fn(() => false),
  forgetChatImported: vi.fn(),
}));
import { useChatLog, prependOlder } from '../../../src/hooks/useChatLog';
import { emptyChatState } from '../../../src/lib/chat/reducer';

const settings = { provider: 'claude' } as any;
const msg = (id: string) => ({ id, role: 'user', content: id, timestamp: 1 } as any);
const flushMicro = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe('prependOlder', () => {
  it('prependOlder stitches pages in order and shifts turn.startIndex', () => {
    const base = emptyChatState(settings);
    const s0 = { ...base, messages: [msg('m5'), msg('m6')], turn: { ...base.turn, startIndex: 1 } };
    const s1 = prependOlder(s0, [msg('m3'), msg('m4')]);
    expect(s1.messages.map((m) => m.id)).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(s1.turn.startIndex).toBe(3);
    const s2 = prependOlder(s1, [msg('m1'), msg('m2')]);
    expect(s2.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    expect(s2.turn.startIndex).toBe(5);
    expect(prependOlder({ ...s0, turn: { ...s0.turn, startIndex: null } }, [msg('x')]).turn.startIndex).toBeNull();
  });
});

describe('useChatLog paging', () => {
  let open: ReturnType<typeof vi.fn>;
  let page: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const base = emptyChatState(settings);
    open = vi.fn().mockResolvedValue({
      snapshot: { chatId: 'a', seq: 5, state: { ...base, lastSeq: 5, messages: [msg('m5'), msg('m6')] } },
      entries: [], headSeq: 5, meta: null, olderCount: 4,
    });
    page = vi.fn();
    (window as any).sai = { chatlog: { open, page, onEvent: () => () => {} } };
  });
  afterEach(() => { delete (window as any).sai; vi.unstubAllGlobals(); });

  it('exposes olderCount and prepends a page', async () => {
    page.mockResolvedValue({ messages: [msg('m3'), msg('m4')], olderCount: 2 });
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    expect(result.current.olderCount).toBe(4);
    await act(async () => { await result.current.loadOlder(); });
    expect(page).toHaveBeenCalledWith('a', 4, expect.any(Number));
    expect(result.current.state!.messages.map((m) => m.id)).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(result.current.olderCount).toBe(2);
    expect(result.current.state!.lastSeq).toBe(5);
  });

  it('loadOlder is a no-op while in flight', async () => {
    const d = deferred<any>();
    page.mockReturnValue(d.promise);
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => { p1 = result.current.loadOlder(); p2 = result.current.loadOlder(); });
    expect(page).toHaveBeenCalledTimes(1);
    d.resolve({ messages: [msg('m3'), msg('m4')], olderCount: 2 });
    await act(async () => { await Promise.all([p1, p2]); });
    expect(result.current.state!.messages).toHaveLength(4);
  });

  it('is a no-op when olderCount is 0 or page is unimplemented', async () => {
    open.mockResolvedValue({ snapshot: null, entries: [], headSeq: 0, meta: null });
    const { result } = renderHook(() => useChatLog('a', settings));
    await flushMicro();
    expect(result.current.olderCount).toBe(0);
    await act(async () => { await result.current.loadOlder(); });
    expect(page).not.toHaveBeenCalled();
  });
});
