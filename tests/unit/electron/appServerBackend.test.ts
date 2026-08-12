// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AppServerClientTransport, AppServerNotification } from '../../../electron/services/codexBackend/appServerClient';
import { AppServerBackend } from '../../../electron/services/codexBackend/appServerBackend';

type Request = { method: string; params: unknown };

function harness() {
  const notifications = new Set<(notification: AppServerNotification) => void>();
  const failures = new Set<(error: Error) => void>();
  const requests: Request[] = [];
  const responses = new Map<string, unknown>();
  const client: AppServerClientTransport = {
    failureReason: undefined,
    start: vi.fn(async () => undefined),
    request: vi.fn(async (method: string, params: unknown) => {
      requests.push({ method, params });
      const response = responses.get(method);
      if (response instanceof Error) throw response;
      return response ?? {};
    }),
    notify: vi.fn(),
    onNotification: vi.fn((listener) => { notifications.add(listener); return () => notifications.delete(listener); }),
    onFailure: vi.fn((listener) => { failures.add(listener); return () => failures.delete(listener); }),
    destroy: vi.fn(),
  };
  const emitted: Array<Record<string, unknown>> = [];
  const registerWorkspace = vi.fn();
  const backend = new AppServerBackend({
    createClient: () => client,
    emit: (event) => emitted.push(event),
    registerWorkspace,
  });
  return {
    backend, client, requests, responses, emitted, registerWorkspace,
    notify: (method: string, params: unknown) => notifications.forEach((listener) => listener({ jsonrpc: '2.0', method, params })),
    fail: (error: Error) => failures.forEach((listener) => listener(error as never)),
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AppServerBackend', () => {
  it('starts a scoped thread with its scoped cwd and announces readiness', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-chat' } });

    await h.backend.start({ projectPath: '/repo', scope: 'chat', scopeCwd: '/repo/chat' });

    expect(h.registerWorkspace).toHaveBeenCalledWith('/repo');
    expect(h.requests).toEqual([{ method: 'thread/start', params: { cwd: '/repo/chat' } }]);
    expect(h.emitted).toContainEqual({ type: 'ready', projectPath: '/repo', scope: 'chat' });
  });

  it('resumes a persisted session only while that scope is idle', async () => {
    const h = harness();
    h.responses.set('thread/resume', { thread: { id: 'saved' } });
    h.backend.setSessionId('/repo', 'saved', 'one');

    await h.backend.start({ projectPath: '/repo', scope: 'one' });
    expect(h.requests).toEqual([{ method: 'thread/resume', params: { threadId: 'saved' } }]);

    h.responses.set('turn/start', { turn: { id: 'turn-1' } });
    h.backend.send({ projectPath: '/repo', scope: 'one', message: 'go' });
    await settle();
    h.backend.setSessionId('/repo', 'other', 'one');
    expect(h.requests.find((request) => request.method === 'thread/resume')?.params).toEqual({ threadId: 'saved' });
  });

  it('starts a turn in the matching scoped thread and streams only its notifications', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'task:a' });
    h.backend.send({ projectPath: '/repo', scope: 'task:a', message: 'hello' });
    await settle();

    expect(h.requests.at(-1)).toEqual({ method: 'turn/start', params: {
      threadId: 'thread-a', input: [{ type: 'text', text: 'hello' }],
    } });
    h.notify('item/agentMessage/delta', { threadId: 'thread-stale', turnId: 'turn-a', delta: 'wrong' });
    h.notify('item/agentMessage/delta', { threadId: 'thread-a', turnId: 'turn-a', delta: 'right' });
    expect(h.emitted).toContainEqual(expect.objectContaining({ type: 'assistant', message: { content: [{ type: 'text', text: 'right' }] } }));
    expect(h.emitted).not.toContainEqual(expect.objectContaining({ type: 'assistant', message: { content: [{ type: 'text', text: 'wrong' }] } }));
  });

  it('interrupts and reconciles only the named scope', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    await h.backend.start({ projectPath: '/repo', scope: 'b' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();

    h.backend.interrupt('/repo', 'a');
    await settle();
    expect(h.requests.at(-1)).toEqual({ method: 'turn/interrupt', params: { threadId: 'thread-a', turnId: 'turn-a' } });
    h.backend.reconcileScope('/repo', 'b');
    expect(h.emitted).toContainEqual({ type: 'done', projectPath: '/repo', scope: 'b', turnSeq: null });
  });

  it('drops delayed notifications after a scope is suspended', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    h.backend.suspendWorkspace('/repo');
    h.notify('item/agentMessage/delta', { threadId: 'thread-a', turnId: 'turn-a', delta: 'late' });
    expect(h.emitted).not.toContainEqual(expect.objectContaining({ type: 'assistant', message: { content: [{ type: 'text', text: 'late' }] } }));
  });

  it('settles a matching completed turn exactly once', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    h.notify('turn/completed', { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } });
    expect(h.emitted.filter((event) => event.type === 'result')).toHaveLength(1);
    expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(h.backend.isWorkspaceBusy('/repo')).toBe(false);
  });

  it('settles active work when the App Server fails and exposes an unavailable preview', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    h.fail(new Error('server exited'));

    expect(h.backend.previewStatus).toEqual({ available: false, reason: 'server exited' });
    expect(h.emitted).toContainEqual(expect.objectContaining({ type: 'error', text: 'server exited', scope: 'a' }));
    expect(h.emitted).toContainEqual(expect.objectContaining({ type: 'done', scope: 'a', subagentsAborted: true }));
  });

  it('reports image input as unsupported instead of dropping it', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'look', imagePaths: ['/tmp/a.png'] });
    await settle();
    expect(h.emitted).toContainEqual(expect.objectContaining({ type: 'error', text: expect.stringMatching(/image input.*not supported/i) }));
    expect(h.requests.some((request) => request.method === 'turn/start')).toBe(false);
  });

  it('lists models only after successful initialization', async () => {
    const h = harness();
    h.responses.set('model/list', { data: [
      { model: 'gpt-5', displayName: 'GPT-5', isDefault: true },
      { model: 'hidden', hidden: true },
    ] });
    await expect(h.backend.getModels()).resolves.toEqual({
      models: [{ id: 'gpt-5', name: 'GPT-5' }], defaultModel: 'gpt-5',
    });
    expect(h.client.start).toHaveBeenCalledOnce();
    expect(h.requests).toEqual([{ method: 'model/list', params: {} }]);
  });
});
