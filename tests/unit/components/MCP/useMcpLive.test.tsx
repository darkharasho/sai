// tests/unit/components/MCP/useMcpLive.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMcpLive } from '../../../../src/components/MCP/useMcpLive';

let pushCb: ((p: any) => void) | null = null;
const sai = {
  mcpStatus: vi.fn(),
  mcpRuntimeStatus: vi.fn(),
  mcpReconnect: vi.fn().mockResolvedValue({ ok: true }),
  mcpToggle: vi.fn().mockResolvedValue({ ok: true }),
  onMcpRuntimeStatus: vi.fn((cb: any) => { pushCb = cb; return () => { pushCb = null; }; }),
};
Object.defineProperty(window, 'sai', { value: sai, writable: true });

const snap = (over: any = {}) => ({
  projectPath: '/p', scope: 's1', servers: {}, auth: {}, available: true,
  capabilities: { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true },
  ...over,
});

describe('useMcpLive', () => {
  beforeEach(() => { vi.clearAllMocks(); sai.mcpStatus.mockResolvedValue(snap()); sai.mcpRuntimeStatus.mockResolvedValue(snap()); });

  it('spawn:true uses mcpStatus; spawn:false uses mcpRuntimeStatus', async () => {
    renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(sai.mcpStatus).toHaveBeenCalledWith('/p', 's1'));
    renderHook(() => useMcpLive('/p', 's1', { spawn: false }));
    await waitFor(() => expect(sai.mcpRuntimeStatus).toHaveBeenCalledWith('/p', 's1'));
  });

  it('applies pushes for its own scope only, keeping capabilities from the last full snapshot', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => pushCb?.({ projectPath: '/p', scope: 'other', servers: { a: { name: 'a', status: 'connected' } }, auth: {} }));
    expect(result.current.snapshot!.servers).toEqual({});
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: { a: { name: 'a', status: 'connected' } }, auth: {} }));
    expect(result.current.snapshot!.servers.a.status).toBe('connected');
    expect(result.current.snapshot!.capabilities.authenticate).toBe(true);
  });

  it('undefined scope matches "chat" pushes', async () => {
    sai.mcpStatus.mockResolvedValue(snap({ scope: 'chat' }));
    const { result } = renderHook(() => useMcpLive('/p', undefined, { spawn: true }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => pushCb?.({ projectPath: '/p', scope: 'chat', servers: { b: { name: 'b', status: 'pending' } }, auth: {} }));
    expect(result.current.snapshot!.servers.b).toBeDefined();
  });

  it('actions pass projectPath + scope', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await act(() => result.current.reconnect('gh'));
    expect(sai.mcpReconnect).toHaveBeenCalledWith('/p', 's1', 'gh');
  });

  it('toggle passes scope and controlName', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await act(() => result.current.toggle('plugin:cf:api', false, 'plugin', 'api'));
    expect(sai.mcpToggle).toHaveBeenCalledWith('/p', 's1', 'plugin:cf:api', false, 'plugin', 'api');
  });

  it('accepts a full-snapshot push', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => pushCb?.(snap({ servers: { z: { name: 'z', status: 'failed' } }, capabilities: { status: true, reconnect: false, toggle: false, authenticate: false, clearAuth: false, submitCallbackUrl: false } })));
    expect(result.current.snapshot!.servers.z).toBeDefined();
    expect(result.current.snapshot!.capabilities.reconnect).toBe(false);
  });

  it('enabled:false makes no IPC calls and adds no listeners', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true, enabled: false }));
    await act(async () => { await result.current.refresh(); await result.current.reconnect('gh'); });
    expect(sai.mcpStatus).not.toHaveBeenCalled();
    expect(sai.mcpRuntimeStatus).not.toHaveBeenCalled();
    expect(sai.mcpReconnect).not.toHaveBeenCalled();
    expect(sai.onMcpRuntimeStatus).not.toHaveBeenCalled();
  });

  it('spawn:true never calls mcpRuntimeStatus; spawn:false never calls mcpStatus', async () => {
    renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(sai.mcpStatus).toHaveBeenCalledTimes(1));
    expect(sai.mcpRuntimeStatus).not.toHaveBeenCalled();
    vi.clearAllMocks();
    renderHook(() => useMcpLive('/p', 's1', { spawn: false }));
    await waitFor(() => expect(sai.mcpRuntimeStatus).toHaveBeenCalledTimes(1));
    expect(sai.mcpStatus).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(pushCb).not.toBeNull());
    unmount();
    expect(pushCb).toBeNull();
  });

  it('ignores a push for a different projectPath', async () => {
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => pushCb?.({ projectPath: '/other', scope: 's1', servers: { a: { name: 'a', status: 'connected' } }, auth: {} }));
    expect(result.current.snapshot!.servers).toEqual({});
  });

  it('re-fetches, re-subscribes and clears on scope change', async () => {
    sai.mcpStatus.mockImplementation(async (_p: string, sc: string) => snap({ scope: sc, servers: { [sc]: { name: sc, status: 'connected' } } }));
    const { result, rerender } = renderHook(({ sc }) => useMcpLive('/p', sc, { spawn: true }), { initialProps: { sc: 's1' } });
    await waitFor(() => expect(result.current.snapshot?.servers.s1).toBeDefined());
    rerender({ sc: 's2' });
    expect(sai.onMcpRuntimeStatus).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.snapshot?.servers.s2).toBeDefined());
    expect(sai.mcpStatus).toHaveBeenLastCalledWith('/p', 's2');
    expect(result.current.snapshot!.servers.s1).toBeUndefined();
  });

  it('clears the snapshot immediately on projectPath change', async () => {
    const { result, rerender } = renderHook(({ pp }) => useMcpLive(pp, 's1', { spawn: true }), { initialProps: { pp: '/p' } });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    sai.mcpStatus.mockReturnValue(new Promise(() => {}));
    rerender({ pp: '/q' });
    expect(result.current.snapshot).toBeNull();
    expect(sai.mcpStatus).toHaveBeenLastCalledWith('/q', 's1');
  });

  it('drops a late response from the previous scope', async () => {
    let resolveOld!: (v: any) => void;
    sai.mcpStatus.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    const { result, rerender } = renderHook(({ sc }) => useMcpLive('/p', sc, { spawn: true }), { initialProps: { sc: 's1' } });
    sai.mcpStatus.mockResolvedValue(snap({ scope: 's2', servers: { b: { name: 'b', status: 'connected' } } }));
    rerender({ sc: 's2' });
    await waitFor(() => expect(result.current.snapshot?.servers.b).toBeDefined());
    await act(async () => { resolveOld(snap({ scope: 's1', servers: { old: { name: 'old', status: 'connected' } } })); });
    expect(result.current.snapshot!.servers.old).toBeUndefined();
    expect(result.current.snapshot!.servers.b).toBeDefined();
  });

  it('a late fetch does not overwrite a newer push', async () => {
    let resolveFetch!: (v: any) => void;
    sai.mcpStatus.mockImplementationOnce(() => new Promise((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useMcpLive('/p', 's1', { spawn: true }));
    await waitFor(() => expect(pushCb).not.toBeNull());
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: { fresh: { name: 'fresh', status: 'connected' } }, auth: {} }));
    await act(async () => { resolveFetch(snap({ servers: { stale: { name: 'stale', status: 'pending' } } })); });
    expect(result.current.snapshot!.servers.fresh).toBeDefined();
    expect(result.current.snapshot!.servers.stale).toBeUndefined();
    expect(result.current.snapshot!.capabilities.authenticate).toBe(true);
  });
});
