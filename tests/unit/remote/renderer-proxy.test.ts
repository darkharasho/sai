import { describe, it, expect, vi } from 'vitest';
import { RendererProxy } from '@electron/services/remote/renderer-proxy';

interface FakeContents { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }
interface FakeWindow { webContents: FakeContents; isDestroyed: () => boolean }

function fakeWindow(opts: { destroyed?: boolean } = {}): FakeWindow {
  return {
    webContents: { send: vi.fn(), isDestroyed: () => !!opts.destroyed },
    isDestroyed: () => !!opts.destroyed,
  };
}

describe('RendererProxy', () => {
  it('resolves a request when a matching reply is received', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const promise = proxy.listSessions('/path');
    expect(win.webContents.send).toHaveBeenCalledOnce();
    const [, payload] = win.webContents.send.mock.calls[0];
    expect(payload.kind).toBe('listSessions');
    expect(payload.args).toEqual({ projectPath: '/path' });
    proxy.handleReply({ reqId: payload.reqId, result: [{ id: 's1' }] });
    expect(await promise).toEqual([{ id: 's1' }]);
  });

  it('rejects on timeout', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 10 });
    await expect(proxy.loadHistory('s1')).rejects.toThrow(/timeout/);
  });

  it('rejects when window is destroyed', async () => {
    const win = fakeWindow({ destroyed: true });
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    await expect(proxy.loadHistory('s1')).rejects.toThrow(/window/);
  });

  it('rejects when reply carries error', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const promise = proxy.listSessions('/p');
    const [, payload] = win.webContents.send.mock.calls[0];
    proxy.handleReply({ reqId: payload.reqId, error: 'boom' });
    await expect(promise).rejects.toThrow(/boom/);
  });

  it('handles multiple in-flight requests', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const a = proxy.listSessions('/a');
    const b = proxy.listSessions('/b');
    const [, payloadA] = win.webContents.send.mock.calls[0];
    const [, payloadB] = win.webContents.send.mock.calls[1];
    proxy.handleReply({ reqId: payloadB.reqId, result: ['B'] });
    proxy.handleReply({ reqId: payloadA.reqId, result: ['A'] });
    expect(await a).toEqual(['A']);
    expect(await b).toEqual(['B']);
  });

  it('listWorkspaces sends correct request and resolves with reply', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const promise = proxy.listWorkspaces();
    const [, payload] = win.webContents.send.mock.calls[0];
    expect(payload.kind).toBe('listWorkspaces');
    expect(payload.args).toEqual({});
    proxy.handleReply({ reqId: payload.reqId, result: [{ projectPath: '/p', name: 'p', kind: 'project' }] });
    expect(await promise).toEqual([{ projectPath: '/p', name: 'p', kind: 'project' }]);
  });

  it('setActiveWorkspace sends path and resolves', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const promise = proxy.setActiveWorkspace('/p');
    const [, payload] = win.webContents.send.mock.calls[0];
    expect(payload.kind).toBe('setActiveWorkspace');
    expect(payload.args).toEqual({ projectPath: '/p' });
    proxy.handleReply({ reqId: payload.reqId, result: null });
    await expect(promise).resolves.toBeNull();
  });
});
