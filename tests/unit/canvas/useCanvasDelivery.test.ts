import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { StrictMode, createElement, type ReactNode } from 'react';
import { createCanvasStore } from '../../../src/canvas/canvasStore';
import { useCanvasDelivery } from '../../../src/canvas/useCanvasDelivery';

const A = '/ws/.sai/canvas/a.md';
const B = '/ws/.sai/canvas/b.md';

async function makeStore() {
  const store = createCanvasStore({ writeFile: async () => {}, now: () => Date.now() });
  // Agent creates both canvases; chat `c` has seen them.
  await store.onDiskChange(A, '- [ ] a\n', true);
  await store.onDiskChange(B, '- [ ] b\n', true);
  store.markDelivered(A, 'c');
  store.markDelivered(B, 'c');
  return store;
}

type Opts = Parameters<typeof useCanvasDelivery>[0];

function setup(store: Awaited<ReturnType<typeof makeStore>>, init: Partial<Opts> = {}, wrapper?: (p: { children: ReactNode }) => ReactNode) {
  const send = vi.fn();
  const initialProps: Opts = { store, chatKey: 'c', chatBusy: false, send, ...init };
  const hook = renderHook((p: Opts) => useCanvasDelivery(p), { initialProps, wrapper });
  return { send, hook, props: initialProps };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useCanvasDelivery', () => {
  it('waits 5s idle then sends once', async () => {
    const store = await makeStore();
    const { send, hook } = setup(store);
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    expect(send).not.toHaveBeenCalled();
    expect(hook.result.current.sendIn).toBe(5);
    expect(hook.result.current.sendInFor(A)).toBe(5);
    expect(hook.result.current.sendInFor(B)).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(hook.result.current.sendIn).toBe(4);
    act(() => { vi.advanceTimersByTime(3999); });
    expect(send).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain('[Canvas update]');
    expect(store.hasPending(A, 'c')).toBe(false);
    expect(hook.result.current.sendIn).toBeNull();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('per-canvas idle: a later edit to one canvas does not delay another', async () => {
    const store = await makeStore();
    const { send } = setup(store);
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { vi.advanceTimersByTime(3000); });
    await act(async () => { await store.userWrite(B, '- [x] b\n'); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain('a.md');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toContain('b.md');
  });

  it('a new edit restarts that canvas idle window', async () => {
    const store = await makeStore();
    const { send } = setup(store);
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { vi.advanceTimersByTime(4000); });
    await act(async () => { await store.userWrite(A, '- [x] a\n\nmore\n'); });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(send).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('emits trigger send after idle', async () => {
    const store = await makeStore();
    const { send } = setup(store);
    act(() => { store.userEmit(A, 'form', { ok: true }); });
    act(() => { vi.advanceTimersByTime(4999); });
    expect(send).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain('form');
  });

  it('holds while busy, sends after idle', async () => {
    const store = await makeStore();
    const { send, hook, props } = setup(store, { chatBusy: true });
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    expect(hook.result.current.sendIn).toBeNull();
    act(() => { vi.advanceTimersByTime(30000); });
    expect(send).not.toHaveBeenCalled();
    hook.rerender({ ...props, chatBusy: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('busy → idle before the idle window passes still waits out the window', async () => {
    const store = await makeStore();
    const { send, hook, props } = setup(store, { chatBusy: true });
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { vi.advanceTimersByTime(2000); });
    hook.rerender({ ...props, chatBusy: false });
    expect(send).not.toHaveBeenCalled();
    expect(hook.result.current.sendIn).toBe(3);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('hold toggle suppresses auto-send; sendNow sends immediately', async () => {
    const store = await makeStore();
    const { send, hook } = setup(store);
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { store.setAutoSend(A, false); });
    expect(hook.result.current.sendIn).toBeNull();
    act(() => { vi.advanceTimersByTime(30000); });
    expect(send).not.toHaveBeenCalled();
    act(() => { hook.result.current.sendNow(A); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.hasPending(A, 'c')).toBe(false);
  });

  it('sendNow while busy sends as soon as the chat is idle, ignoring the window', async () => {
    const store = await makeStore();
    const { send, hook, props } = setup(store, { chatBusy: true });
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { store.setAutoSend(A, false); });
    act(() => { hook.result.current.sendNow(A); });
    expect(send).not.toHaveBeenCalled();
    // Idle comes back immediately after the edit: no 5s wait.
    hook.rerender({ ...props, chatBusy: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('no send when pendingMessage null', async () => {
    const store = await makeStore();
    const { send, hook } = setup(store);
    // Agent write only: nothing pending for the chat.
    await act(async () => { await store.onDiskChange(A, '- [ ] a\n\nagent\n', true); });
    expect(hook.result.current.sendIn).toBeNull();
    act(() => { vi.advanceTimersByTime(30000); });
    act(() => { hook.result.current.sendNow(A); });
    expect(send).not.toHaveBeenCalled();
  });

  it('no send without a chat key or send function', async () => {
    const store = await makeStore();
    const { send, hook, props } = setup(store, { chatKey: null });
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    expect(hook.result.current.sendIn).toBeNull();
    act(() => { vi.advanceTimersByTime(30000); });
    hook.rerender({ ...props, chatKey: 'c', send: null });
    act(() => { vi.advanceTimersByTime(30000); });
    expect(send).not.toHaveBeenCalled();
    hook.rerender({ ...props, chatKey: 'c' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a throwing send keeps the update pending, logs once per streak and backs off', async () => {
    const store = await makeStore();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => { throw new Error('no chat'); });
    const { hook, props } = setup(store, { send: bad });
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(store.hasPending(A, 'c')).toBe(true);
    // No retry every second.
    act(() => { vi.advanceTimersByTime(29000); });
    expect(bad).toHaveBeenCalledTimes(1);
    // Retries after the back-off, without logging again.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(bad).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledTimes(1);
    // A new send function ends the back-off at once.
    const good = vi.fn();
    hook.rerender({ ...props, send: good });
    expect(good).toHaveBeenCalledTimes(1);
    expect(store.hasPending(A, 'c')).toBe(false);
    errSpy.mockRestore();
  });

  it('switching chats restarts the idle window', async () => {
    const store = await makeStore();
    store.markDelivered(A, 'd');
    const { send, hook, props } = setup(store);
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { vi.advanceTimersByTime(4000); });
    hook.rerender({ ...props, chatKey: 'd' });
    expect(hook.result.current.sendIn).toBe(5);
    act(() => { vi.advanceTimersByTime(4999); });
    expect(send).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sendInFor is stable while the countdown is unchanged', async () => {
    const store = await makeStore();
    const { hook, props } = setup(store);
    const before = hook.result.current.sendInFor;
    hook.rerender({ ...props });
    expect(hook.result.current.sendInFor).toBe(before);
  });

  it('never double-sends under StrictMode and re-renders', async () => {
    const store = await makeStore();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { send, hook, props } = setup(store, {}, wrapper);
    await act(async () => { await store.userWrite(A, '- [x] a\n'); });
    act(() => { vi.advanceTimersByTime(5000); });
    hook.rerender({ ...props });
    hook.rerender({ ...props, send: props.send });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(send).toHaveBeenCalledTimes(1);
    // sendNow twice in one tick: the second finds nothing pending.
    await act(async () => { await store.userWrite(B, '- [x] b\n'); });
    act(() => {
      hook.result.current.sendNow(B);
      hook.result.current.sendNow(B);
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
