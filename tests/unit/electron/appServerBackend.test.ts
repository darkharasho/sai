// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AppServerClientTransport, AppServerNotification, AppServerServerRequest, AppServerServerRequestResponder } from '../../../electron/services/codexBackend/appServerClient';
import { AppServerBackend } from '../../../electron/services/codexBackend/appServerBackend';

type Request = { method: string; params: unknown };

function harness() {
  const notifications = new Set<(notification: AppServerNotification) => void>();
  const serverRequests = new Set<(request: AppServerServerRequest) => void>();
  const failures = new Set<(error: Error) => void>();
  const requests: Request[] = [];
  const responses = new Map<string, unknown>();
  const queuedResponses = new Map<string, unknown[]>();
  const responders = new Map<string | number, AppServerServerRequestResponder>();
  const client: AppServerClientTransport = {
    failureReason: undefined,
    start: vi.fn(async () => undefined),
    request: vi.fn(async (method: string, params: unknown) => {
      requests.push({ method, params });
      const response = queuedResponses.get(method)?.shift() ?? responses.get(method);
      if (response instanceof Error) throw response;
      return response ?? {};
    }),
    notify: vi.fn(),
    onNotification: vi.fn((listener) => { notifications.add(listener); return () => notifications.delete(listener); }),
    onServerRequest: vi.fn((listener) => { serverRequests.add(listener); return () => serverRequests.delete(listener); }),
    claimServerRequest: vi.fn((id) => {
      const responder = responders.get(id);
      if (!responder) throw new Error('No server request is pending');
      responders.delete(id);
      return responder;
    }),
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
    queueResponse: (method: string, response: unknown) => {
      const queue = queuedResponses.get(method) ?? [];
      queue.push(response);
      queuedResponses.set(method, queue);
    },
    notify: (method: string, params: unknown) => notifications.forEach((listener) => listener({ jsonrpc: '2.0', method, params })),
    serverRequest: (id: string | number, method: string, params: unknown) => {
      const responder: AppServerServerRequestResponder = {
        request: { id, method, params },
        respond: vi.fn(),
        reject: vi.fn(),
      };
      responders.set(id, responder);
      serverRequests.forEach((listener) => listener(responder.request));
      return responder;
    },
    fail: (error: Error) => failures.forEach((listener) => listener(error as never)),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
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

  it('emits a new thread session ID so a fresh backend resumes the persisted chat', async () => {
    const first = harness();
    first.responses.set('thread/start', { thread: { id: 'thread-persisted' } });

    await first.backend.start({ projectPath: '/repo', scope: 'chat' });

    const session = first.emitted.find((event) => event.type === 'session_id');
    expect(session).toEqual({
      type: 'session_id', sessionId: 'thread-persisted', projectPath: '/repo', scope: 'chat',
    });
    expect(first.emitted.filter((event) => event.type === 'session_id')).toHaveLength(1);

    const second = harness();
    second.responses.set('thread/resume', { thread: { id: 'thread-persisted' } });
    second.backend.setSessionId('/repo', session?.sessionId as string, 'chat');
    await second.backend.start({ projectPath: '/repo', scope: 'chat' });

    expect(second.requests).toEqual([{ method: 'thread/resume', params: { threadId: 'thread-persisted' } }]);
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
      threadId: 'thread-a', input: [{ type: 'text', text: 'hello' }], cwd: '/repo',
      approvalPolicy: 'onRequest', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/repo'], networkAccess: true },
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

  it.each(['interrupt', 'replacement', 'suspend'] as const)('interrupts a turn once its delayed ID resolves after %s', async (action) => {
    const h = harness();
    const delayedTurn = deferred<unknown>();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.queueResponse('turn/start', delayedTurn.promise);
    h.queueResponse('turn/start', { turn: { id: 'turn-next' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'first' });
    await settle();

    if (action === 'interrupt') h.backend.interrupt('/repo', 'a');
    if (action === 'replacement') h.backend.send({ projectPath: '/repo', scope: 'a', message: 'second' });
    if (action === 'suspend') h.backend.suspendWorkspace('/repo');
    delayedTurn.resolve({ turn: { id: 'turn-late' } });
    await settle();

    expect(h.requests.filter((request) => request.method === 'turn/interrupt')).toEqual([
      { method: 'turn/interrupt', params: { threadId: 'thread-a', turnId: 'turn-late' } },
    ]);
  });

  it('buffers early matching notifications until a delayed turn/start response binds their ID', async () => {
    const h = harness();
    const delayedTurn = deferred<unknown>();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', delayedTurn.promise);
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    h.notify('item/agentMessage/delta', { threadId: 'thread-a', turnId: 'turn-a', delta: 'early' });
    h.notify('turn/completed', { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } });
    expect(h.emitted).not.toContainEqual(expect.objectContaining({ type: 'assistant' }));

    delayedTurn.resolve({ turn: { id: 'turn-a' } });
    await settle();
    expect(h.emitted).toContainEqual(expect.objectContaining({ type: 'assistant', message: { content: [{ type: 'text', text: 'early' }] } }));
    expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(h.backend.isWorkspaceBusy('/repo')).toBe(false);
  });

  it('passes model, effort, and permission through documented turn/start overrides', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go', model: 'gpt-5', effort: 'high', permission: 'full-access' });
    await settle();
    expect(h.requests.at(-1)).toEqual({ method: 'turn/start', params: expect.objectContaining({
      model: 'gpt-5', effort: 'high', approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' },
    }) });
  });

  it('rejects startup failures instead of announcing a ready preview', async () => {
    const h = harness();
    h.responses.set('thread/start', new Error('cannot start thread'));
    await expect(h.backend.start({ projectPath: '/repo', scope: 'a' })).rejects.toThrow('cannot start thread');
    expect(h.emitted).not.toContainEqual({ type: 'ready', projectPath: '/repo', scope: 'a' });
    expect(h.backend.previewStatus).toEqual({ available: false, reason: 'cannot start thread' });
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

  it('settles a docs-shaped completed turn without a thread ID when its bound turn ID is unique', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();

    h.notify('turn/completed', { turn: { id: 'turn-a', status: 'completed' } });

    expect(h.emitted.filter((event) => event.type === 'result')).toHaveLength(1);
    expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(h.backend.isWorkspaceBusy('/repo')).toBe(false);
  });

  it('interrupts a delayed retired turn in its original thread after the scope resumes another', async () => {
    const h = harness();
    const delayedTurn = deferred<unknown>();
    h.responses.set('thread/start', { thread: { id: 'thread-old' } });
    h.responses.set('thread/resume', { thread: { id: 'thread-new' } });
    h.responses.set('turn/start', delayedTurn.promise);
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'first' });
    await settle();

    h.backend.interrupt('/repo', 'a');
    h.backend.setSessionId('/repo', 'thread-new', 'a');
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    delayedTurn.resolve({ turn: { id: 'turn-old' } });
    await settle();

    expect(h.requests.filter((request) => request.method === 'turn/interrupt')).toEqual([
      { method: 'turn/interrupt', params: { threadId: 'thread-old', turnId: 'turn-old' } },
    ]);
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

  it.each([
    ['item/commandExecution/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', reason: 'Needs to run tests', command: 'npm test', cwd: '/repo',
      networkApprovalContext: { host: 'registry.npmjs.org', protocol: 'https' },
      availableDecisions: ['accept', 'decline'],
    }, { toolName: 'Command approval', command: 'npm test', cwd: '/repo', reason: 'Needs to run tests', network: { host: 'registry.npmjs.org', protocol: 'https' } }],
    ['item/fileChange/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', reason: 'Needs write access', grantRoot: '/repo/src',
      availableDecisions: ['accept', 'decline'],
    }, { toolName: 'File change approval', grantRoot: '/repo/src', reason: 'Needs write access' }],
    ['item/permissions/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', reason: 'Needs network', permissions: [{ kind: 'network', host: 'api.openai.com', protocol: 'https' }],
      availableDecisions: ['accept', 'decline'],
    }, { toolName: 'Permission approval', reason: 'Needs network', network: { host: 'api.openai.com', protocol: 'https' }, requestedPermissions: [{ kind: 'network', host: 'api.openai.com', protocol: 'https' }] }],
  ] as const)('claims and normalizes %s approvals for the active scoped turn', async (method, params, expected) => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();

    h.serverRequest(`request-${method}`, method, params);

    expect(h.client.claimServerRequest).toHaveBeenCalledWith(`request-${method}`);
    expect(h.emitted).toContainEqual(expect.objectContaining({
      type: 'approval_needed', provider: 'codex', requestHandle: `request-${method}`,
      projectPath: '/repo', scope: 'a', toolUseId: `request-${method}`, ...expected,
    }));
    expect(h.backend.isScopeBusy?.('/repo', 'a')).toBe(true);
  });

  it('declines stale approval requests without exposing a renderer event', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();

    const responder = h.serverRequest('stale', 'item/commandExecution/requestApproval', {
      threadId: 'wrong-thread', turnId: 'turn-a', command: 'rm -rf /', cwd: '/wrong',
    });

    expect(responder.respond).toHaveBeenCalledWith({ decision: 'decline' });
    expect(h.emitted.some((event) => event.type === 'approval_needed')).toBe(false);
  });

  it('declines stale permission requests with an empty permission grant', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();

    const responder = h.serverRequest('stale-permission', 'item/permissions/requestApproval', {
      threadId: 'wrong-thread', turnId: 'turn-a', permissions: [{ kind: 'network' }],
    });

    expect(responder.respond).toHaveBeenCalledWith({ permissions: [] });
    expect(h.emitted.some((event) => event.type === 'approval_needed')).toBe(false);
  });

  it.each(['completed', 'interrupt', 'session replacement', 'suspend', 'failure'] as const)('retires pending approvals when the turn is %s', async (action) => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('pending', 'item/commandExecution/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', command: 'npm test', cwd: '/repo',
    });

    if (action === 'completed') h.notify('turn/completed', { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } });
    if (action === 'interrupt') h.backend.interrupt('/repo', 'a');
    if (action === 'session replacement') h.backend.interrupt('/repo', 'a');
    if (action === 'session replacement') h.backend.setSessionId('/repo', 'next', 'a');
    if (action === 'suspend') h.backend.suspendWorkspace('/repo');
    if (action === 'failure') h.fail(new Error('server exited'));
    await settle();

    if (action === 'failure') expect(responder.respond).not.toHaveBeenCalled();
    else expect(responder.respond).toHaveBeenCalledWith({ decision: 'decline' });
    expect(h.backend.isScopeBusy?.('/repo', 'a')).toBe(false);
  });

  it('removes a request resolved by App Server without writing a stale decision', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('resolved', 'item/commandExecution/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', command: 'npm test', cwd: '/repo',
    });

    h.notify('serverRequest/resolved', { requestId: 'resolved', threadId: 'thread-a', turnId: 'turn-a' });
    h.backend.interrupt('/repo', 'a');
    await settle();

    expect(responder.respond).not.toHaveBeenCalled();
  });

  it('accepts only an offered command decision for the request in its own scope', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('command', 'item/commandExecution/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', command: 'npm test', cwd: '/repo',
      availableDecisions: ['accept', 'decline'],
    });

    expect(h.backend.approve('/repo', 'other', 'command', { type: 'decision', value: 'accept' }))
      .toEqual({ ok: false, code: 'not-pending' });
    expect(h.backend.approve('/repo', 'a', 'command', { type: 'decision', value: 'acceptForSession' }))
      .toEqual({ ok: false, code: 'invalid-decision' });
    expect(h.backend.approve('/repo', 'a', 'command', { type: 'decision', value: 'accept' }))
      .toEqual({ ok: true });
    expect(responder.respond).toHaveBeenCalledWith({ decision: 'accept' });
    expect(h.backend.approve('/repo', 'a', 'command', { type: 'decision', value: 'accept' }))
      .toEqual({ ok: false, code: 'not-pending' });
  });

  it('allows only the offered proposed command amendment', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('amend', 'item/commandExecution/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', availableDecisions: ['acceptWithExecpolicyAmendment'],
      proposedExecpolicyAmendment: ['npm', 'test'],
    });

    expect(h.backend.approve('/repo', 'a', 'amend', { type: 'command-amendment', execpolicyAmendment: ['rm', '-rf', '/'] }))
      .toEqual({ ok: false, code: 'invalid-decision' });
    expect(h.backend.approve('/repo', 'a', 'amend', { type: 'command-amendment', execpolicyAmendment: ['npm', 'test'] }))
      .toEqual({ ok: true });
    expect(responder.respond).toHaveBeenCalledWith({ acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'test'] } });
  });

  it('grants permission requests only as a requested subset and explicit scope', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const requested = [{ kind: 'network', host: 'api.openai.com' }, { kind: 'filesystem', path: '/repo/tmp' }];
    const responder = h.serverRequest('permissions', 'item/permissions/requestApproval', {
      threadId: 'thread-a', turnId: 'turn-a', permissions: requested,
    });

    expect(h.backend.approve('/repo', 'a', 'permissions', { type: 'permissions', scope: 'session', permissions: [{ kind: 'network', host: '*' }] }))
      .toEqual({ ok: false, code: 'invalid-decision' });
    expect(h.backend.approve('/repo', 'a', 'permissions', { type: 'permissions', scope: 'turn', permissions: [requested[0]] }))
      .toEqual({ ok: true });
    expect(responder.respond).toHaveBeenCalledWith({ permissions: [requested[0]], scope: 'turn' });
  });

  it('claims active scoped user-input requests and responds only with offered option IDs', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('input', 'item/tool/requestUserInput', {
      threadId: 'thread-a', turnId: 'turn-a', autoResolutionMs: 1200,
      questions: [{ id: 'format', question: 'Choose a format', options: [
        { label: 'JSON' }, { label: 'YAML' },
      ] }],
    });

    expect(h.emitted).toContainEqual(expect.objectContaining({
      type: 'user_input_needed', provider: 'codex', requestHandle: 'input',
      projectPath: '/repo', scope: 'a', autoResolutionMs: 1200,
      questions: [{ id: 'format', prompt: 'Choose a format', options: [
        { id: 'JSON', label: 'JSON' }, { id: 'YAML', label: 'YAML' },
      ] }],
    }));
    expect(h.backend.answerUserInput('/repo', 'a', 'input', { type: 'answers', answers: { format: ['shell'] } }))
      .toEqual({ ok: false, code: 'invalid-decision' });
    expect(h.backend.answerUserInput('/repo', 'a', 'input', { type: 'answers', answers: { format: ['YAML'] } }))
      .toEqual({ ok: true });
    expect(responder.respond).toHaveBeenCalledWith({ answers: { format: ['YAML'] } });
  });

  it('maps an explicit user-input cancellation to the protocol empty-answer response', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('cancel-input', 'item/tool/requestUserInput', {
      threadId: 'thread-a', turnId: 'turn-a', questions: [{ id: 'format', question: 'Choose', options: [{ label: 'JSON' }] }],
    });

    expect(h.backend.answerUserInput('/repo', 'a', 'cancel-input', { type: 'cancel' }))
      .toEqual({ ok: true });
    expect(responder.respond).toHaveBeenCalledWith({ answers: {} });
  });

  it('rejects malformed cancel responses rather than accepting arbitrary answer data', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('malformed-cancel', 'item/tool/requestUserInput', {
      threadId: 'thread-a', turnId: 'turn-a', questions: [{ id: 'format', question: 'Choose', options: [{ label: 'JSON' }] }],
    });

    expect(h.backend.answerUserInput('/repo', 'a', 'malformed-cancel', { type: 'cancel', answers: { format: ['JSON'] } } as any))
      .toEqual({ ok: false, code: 'invalid-decision' });
    expect(responder.respond).not.toHaveBeenCalled();
  });

  it('keeps a user-input request pending when its protocol response fails, then retires it only after success', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('retry-input', 'item/tool/requestUserInput', {
      threadId: 'thread-a', turnId: 'turn-a', questions: [{ id: 'format', question: 'Choose', options: [{ label: 'JSON' }] }],
    });
    vi.mocked(responder.respond).mockImplementationOnce(() => { throw new Error('closed'); });

    expect(h.backend.answerUserInput('/repo', 'a', 'retry-input', { type: 'answers', answers: { format: ['JSON'] } }))
      .toEqual({ ok: false, code: 'not-pending' });
    expect(h.backend.answerUserInput('/repo', 'a', 'retry-input', { type: 'answers', answers: { format: ['JSON'] } }))
      .toEqual({ ok: true });
  });

  it('declines stale user-input requests without exposing renderer data', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();

    const responder = h.serverRequest('stale-input', 'item/tool/requestUserInput', {
      threadId: 'other', turnId: 'turn-a', questions: [{ id: 'x', question: 'Wrong' }],
    });

    expect(responder.respond).toHaveBeenCalledWith({ answers: {} });
    expect(h.emitted.some((event) => event.type === 'user_input_needed')).toBe(false);
  });

  it('retires a timed-out user-input request without allowing a late answer', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.responses.set('thread/start', { thread: { id: 'thread-a' } });
      h.responses.set('turn/start', { turn: { id: 'turn-a' } });
      await h.backend.start({ projectPath: '/repo', scope: 'a' });
      h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
      await vi.runAllTimersAsync();
      const responder = h.serverRequest('timed', 'item/tool/requestUserInput', {
        threadId: 'thread-a', turnId: 'turn-a', autoResolutionMs: 100,
        questions: [{ id: 'format', question: 'Choose', options: [{ label: 'JSON' }] }],
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(responder.respond).toHaveBeenCalledWith({ answers: {} });
      expect(h.emitted).toContainEqual(expect.objectContaining({
        type: 'user_input_resolved', provider: 'codex', requestHandle: 'timed',
        projectPath: '/repo', scope: 'a',
      }));
      expect(h.backend.answerUserInput('/repo', 'a', 'timed', { type: 'answers', answers: { format: ['JSON'] } }))
        .toEqual({ ok: false, code: 'not-pending' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes active MCP form elicitation and validates its response against the requested schema', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('mcp-form', 'mcpServer/elicitation/request', {
      threadId: 'thread-a', turnId: 'turn-a', serverName: 'calendar', mode: 'form', message: 'Choose a date',
      requestedSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false },
    });

    expect(h.emitted).toContainEqual(expect.objectContaining({
      type: 'mcp_elicitation_needed', provider: 'codex', requestHandle: 'mcp-form',
      serverName: 'calendar', message: 'Choose a date', mode: 'form',
      requestedSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false },
    }));
    expect(h.backend.resolveMcpElicitation('/repo', 'a', 'mcp-form', { action: 'accept', content: { date: 3 } }))
      .toEqual({ ok: false, code: 'invalid-decision' });
    expect(h.backend.resolveMcpElicitation('/repo', 'a', 'mcp-form', { action: 'accept', content: { date: '2026-08-12' } }))
      .toEqual({ ok: true });
    expect(responder.respond).toHaveBeenCalledWith({ action: 'accept', content: { date: '2026-08-12' } });
  });

  it('keeps an MCP elicitation pending when its protocol response fails', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('retry-mcp', 'mcpServer/elicitation/request', {
      threadId: 'thread-a', turnId: 'turn-a', serverName: 'calendar', mode: 'form', message: 'Choose',
      requestedSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] },
    });
    vi.mocked(responder.respond).mockImplementationOnce(() => { throw new Error('closed'); });

    const decision = { action: 'accept' as const, content: { date: '2026-08-12' } };
    expect(h.backend.resolveMcpElicitation('/repo', 'a', 'retry-mcp', decision))
      .toEqual({ ok: false, code: 'not-pending' });
    expect(h.backend.resolveMcpElicitation('/repo', 'a', 'retry-mcp', decision)).toEqual({ ok: true });
  });

  it('cancels an optional-turn MCP request when its thread belongs to multiple active scopes', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'shared-thread' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    await h.backend.start({ projectPath: '/repo', scope: 'b' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('ambiguous-mcp', 'mcpServer/elicitation/request', {
      threadId: 'shared-thread', serverName: 'calendar', mode: 'url', message: 'Sign in', url: 'https://example.test', elicitationId: 'e-1',
    });

    expect(responder.respond).toHaveBeenCalledWith({ action: 'cancel', content: null });
    expect(h.emitted.some((event) => event.type === 'mcp_elicitation_needed')).toBe(false);
  });

  it('rejects unknown and oversized values even when a primitive form schema allows additional properties', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    h.serverRequest('bounded-form', 'mcpServer/elicitation/request', {
      threadId: 'thread-a', turnId: 'turn-a', serverName: 'calendar', mode: 'form', message: 'Choose a date',
      requestedSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: true },
    });

    expect(h.backend.resolveMcpElicitation('/repo', 'a', 'bounded-form', { action: 'accept', content: { date: '2026-08-12', injected: 'nope' } }))
      .toEqual({ ok: false, code: 'invalid-decision' });
    expect(h.backend.resolveMcpElicitation('/repo', 'a', 'bounded-form', { action: 'accept', content: { date: 'x'.repeat(2_001) } }))
      .toEqual({ ok: false, code: 'invalid-decision' });
  });

  it('cancels unsupported or stale MCP elicitation and retires it after server resolution', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const stale = h.serverRequest('stale-mcp', 'mcpServer/elicitation/request', {
      threadId: 'wrong', turnId: 'turn-a', serverName: 'calendar', mode: 'url', message: 'Sign in', url: 'https://example.test', elicitationId: 'e-1',
    });
    expect(stale.respond).toHaveBeenCalledWith({ action: 'cancel', content: null });

    const responder = h.serverRequest('mcp-url', 'mcpServer/elicitation/request', {
      threadId: 'thread-a', turnId: 'turn-a', serverName: 'calendar', mode: 'url', message: 'Sign in', url: 'https://example.test', elicitationId: 'e-1',
    });
    h.notify('serverRequest/resolved', { requestId: 'mcp-url', threadId: 'thread-a', turnId: 'turn-a' });
    expect(h.emitted).toContainEqual(expect.objectContaining({
      type: 'mcp_elicitation_resolved', provider: 'codex', requestHandle: 'mcp-url',
      projectPath: '/repo', scope: 'a',
    }));
    expect(h.backend.resolveMcpElicitation('/repo', 'a', 'mcp-url', { action: 'accept', content: null }))
      .toEqual({ ok: false, code: 'not-pending' });
    expect(responder.respond).not.toHaveBeenCalled();
  });

  it('publishes correlated input-panel resolution when a turn ends', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    h.serverRequest('input-end', 'item/tool/requestUserInput', {
      threadId: 'thread-a', turnId: 'turn-a', questions: [{ id: 'format', question: 'Choose', options: [{ label: 'JSON' }] }],
    });
    h.serverRequest('mcp-end', 'mcpServer/elicitation/request', {
      threadId: 'thread-a', turnId: 'turn-a', serverName: 'calendar', mode: 'url', message: 'Sign in', url: 'https://example.test', elicitationId: 'e-1',
    });

    h.notify('turn/completed', { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } });

    expect(h.emitted).toContainEqual(expect.objectContaining({ type: 'user_input_resolved', provider: 'codex', requestHandle: 'input-end' }));
    expect(h.emitted).toContainEqual(expect.objectContaining({ type: 'mcp_elicitation_resolved', provider: 'codex', requestHandle: 'mcp-end' }));
  });

  it('rejects nested MCP form fields that the renderer cannot safely render', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();

    const responder = h.serverRequest('nested-form', 'mcpServer/elicitation/request', {
      threadId: 'thread-a', turnId: 'turn-a', serverName: 'calendar', mode: 'form', message: 'Choose',
      requestedSchema: { type: 'object', properties: { filters: { type: 'array', items: { type: 'string' } } } },
    });

    expect(responder.respond).toHaveBeenCalledWith({ action: 'cancel', content: null });
    expect(h.emitted.some((event) => event.type === 'mcp_elicitation_needed')).toBe(false);
  });

  it('cancels URL elicitation without its required opaque elicitation ID', async () => {
    const h = harness();
    h.responses.set('thread/start', { thread: { id: 'thread-a' } });
    h.responses.set('turn/start', { turn: { id: 'turn-a' } });
    await h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'go' });
    await settle();
    const responder = h.serverRequest('missing-url-id', 'mcpServer/elicitation/request', {
      threadId: 'thread-a', turnId: 'turn-a', serverName: 'calendar', mode: 'url', message: 'Sign in', url: 'https://example.test',
    });

    expect(responder.respond).toHaveBeenCalledWith({ action: 'cancel', content: null });
    expect(h.emitted.some((event) => event.type === 'mcp_elicitation_needed')).toBe(false);
  });
});
