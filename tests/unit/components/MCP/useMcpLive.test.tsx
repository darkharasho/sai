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
});
