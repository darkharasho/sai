import type {
  CodexOptions,
  Input,
  ThreadEvent,
  ThreadOptions,
  TurnOptions,
} from '@openai/codex-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  SdkCodexBackend,
  type CodexSdkClient,
  type CodexSdkThread,
} from '../../../electron/services/codexBackend/sdkBackend';

type PendingStream = {
  events: AsyncGenerator<ThreadEvent>;
  push(event: ThreadEvent): void;
  end(): void;
};

function pendingStream(): PendingStream {
  const queue: ThreadEvent[] = [];
  const readers: Array<(result: IteratorResult<ThreadEvent>) => void> = [];
  let ended = false;
  return {
    events: (async function* () {
      while (true) {
        const next = queue.length
          ? { done: false as const, value: queue.shift()! }
          : ended
            ? { done: true as const, value: undefined }
            : await new Promise<IteratorResult<ThreadEvent>>((resolve) => readers.push(resolve));
        if (next.done) return;
        yield next.value;
      }
    })(),
    push(event) {
      const reader = readers.shift();
      if (reader) reader({ done: false, value: event });
      else queue.push(event);
    },
    end() {
      ended = true;
      for (const reader of readers.splice(0)) reader({ done: true, value: undefined });
    },
  };
}

function completedEvents(text = 'hello'): ThreadEvent[] {
  return [
    { type: 'thread.started', thread_id: 'thread-new' },
    { type: 'item.completed', item: { id: 'msg', type: 'agent_message', text } },
    {
      type: 'turn.completed',
      usage: {
        input_tokens: 2,
        cached_input_tokens: 1,
        output_tokens: 3,
        reasoning_output_tokens: 1,
      },
    },
  ];
}

function streamOf(events: ThreadEvent[]): AsyncGenerator<ThreadEvent> {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

interface FakeHarness {
  backend: SdkCodexBackend;
  emitted: Array<Record<string, unknown>>;
  clients: Array<{ options: CodexOptions; start: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> }>;
  runs: Array<{ input: Input; options?: TurnOptions; threadOptions: ThreadOptions; resumeId?: string }>;
  streams: Array<AsyncGenerator<ThreadEvent> | Error>;
  registerWorkspace: ReturnType<typeof vi.fn>;
  notifyCompletion: ReturnType<typeof vi.fn>;
  timeline: string[];
}

function harness(streams: Array<AsyncGenerator<ThreadEvent> | Error> = []): FakeHarness {
  const emitted: Array<Record<string, unknown>> = [];
  const clients: FakeHarness['clients'] = [];
  const runs: FakeHarness['runs'] = [];
  const queue = [...streams];

  const createThread = (threadOptions: ThreadOptions, resumeId?: string): CodexSdkThread => ({
    id: resumeId ?? null,
    runStreamed: vi.fn(async (input: Input, options?: TurnOptions) => {
      runs.push({ input, options, threadOptions, resumeId });
      const next = queue.shift() ?? streamOf(completedEvents());
      if (next instanceof Error) throw next;
      return { events: next };
    }),
  });

  const createClient = vi.fn((options: CodexOptions): CodexSdkClient => {
    const client = {
      options,
      start: vi.fn((threadOptions: ThreadOptions) => createThread(threadOptions)),
      resume: vi.fn((id: string, threadOptions: ThreadOptions) => createThread(threadOptions, id)),
    };
    clients.push(client);
    return { startThread: client.start, resumeThread: client.resume };
  });

  const registerWorkspace = vi.fn();
  const timeline: string[] = [];
  const notifyCompletion = vi.fn(() => timeline.push('notify'));

  return {
    backend: new SdkCodexBackend({
      createClient,
      emit: (event) => {
        emitted.push(event);
        timeline.push(`emit:${event.type}`);
      },
      getModels: vi.fn(async () => ({ models: [{ id: 'gpt-5', name: 'GPT-5' }], defaultModel: 'gpt-5' })),
      getEnv: () => ({ PATH: '/bin', EMPTY: undefined, TOKEN: 'secret' }),
      registerWorkspace,
      notifyCompletion,
    }),
    emitted,
    clients,
    runs,
    streams: queue,
    registerWorkspace,
    notifyCompletion,
    timeline,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SdkCodexBackend', () => {
  it('registers a workspace when a scope starts', () => {
    const h = harness();
    h.backend.start({ projectPath: '/repo', scope: 'chat' });
    expect(h.registerWorkspace).toHaveBeenCalledWith('/repo');
  });

  it('reactivates a workspace again before every send', () => {
    const h = harness();
    h.backend.start({ projectPath: '/repo', scope: 'chat' });
    h.backend.send({ projectPath: '/repo', scope: 'chat', message: 'continue' });
    expect(h.registerWorkspace).toHaveBeenCalledTimes(2);
  });

  it('does not register or disturb another project', async () => {
    const one = pendingStream();
    const two = pendingStream();
    const h = harness([one.events, two.events]);
    h.backend.start({ projectPath: '/one' });
    h.backend.start({ projectPath: '/two' });
    expect(h.registerWorkspace.mock.calls).toEqual([['/one'], ['/two']]);

    // Give '/two' a still-pending turn so suspending '/one' has something to
    // wrongly disturb if suspendWorkspace ever stopped scoping its cleanup by
    // projectPath (e.g. wiped every runtime instead of only '/one''s).
    h.backend.send({ projectPath: '/one', message: 'one' });
    h.backend.send({ projectPath: '/two', message: 'two' });
    await settle();
    expect(h.backend.isWorkspaceBusy('/one')).toBe(true);
    expect(h.backend.isWorkspaceBusy('/two')).toBe(true);

    h.backend.suspendWorkspace('/one');
    await settle();
    expect(h.backend.isWorkspaceBusy('/one')).toBe(false);
    expect(h.backend.isWorkspaceBusy('/two')).toBe(true);
  });

  it('passes normalized additional directories per scope and rebuilds when they change', async () => {
    const h = harness([streamOf(completedEvents()), streamOf(completedEvents())]);
    h.backend.start({ projectPath: '/meta', scope: 'chat', additionalDirectories: ['/a', '', '/a', '/b'] });
    h.backend.send({ projectPath: '/meta', scope: 'chat', message: 'one' });
    await settle();
    expect(h.runs[0].threadOptions.additionalDirectories).toEqual(['/a', '/b']);
    h.backend.start({ projectPath: '/meta', scope: 'chat', additionalDirectories: ['/c'] });
    h.backend.send({ projectPath: '/meta', scope: 'chat', message: 'two' });
    await settle();
    expect(h.runs[1].threadOptions.additionalDirectories).toEqual(['/c']);
    expect(h.clients).toHaveLength(2);
  });

  it('removes suspended metadata so stale roots cannot be reused before remount', async () => {
    const h = harness([streamOf(completedEvents()), streamOf(completedEvents())]);
    h.backend.start({ projectPath: '/meta', scope: 'chat', scopeCwd: '/synthetic', additionalDirectories: ['/linked'] });
    h.backend.send({ projectPath: '/meta', message: 'one' });
    await settle();
    h.backend.suspendWorkspace('/meta');
    h.backend.send({ projectPath: '/meta', message: 'two' });
    await settle();
    expect(h.runs[1].threadOptions.workingDirectory).toBe('/meta');
    expect(h.runs[1].threadOptions.additionalDirectories).toBeUndefined();
  });
  it('isolates scopes and workspaces and uses each scoped cwd', async () => {
    const h = harness([streamOf(completedEvents()), streamOf(completedEvents()), streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a', scope: 'chat', scopeCwd: '/a/chat' });
    await h.backend.start({ projectPath: '/a', scope: 'task:1', scopeCwd: '/a/task' });
    await h.backend.start({ projectPath: '/b', scopeCwd: '/b/root' });

    h.backend.send({ projectPath: '/a', scope: 'chat', message: 'a' });
    h.backend.send({ projectPath: '/a', scope: 'task:1', message: 'b' });
    h.backend.send({ projectPath: '/b', message: 'c' });
    await settle();

    expect(h.runs.map((r) => r.threadOptions.workingDirectory)).toEqual(['/a/chat', '/a/task', '/b/root']);
    expect(h.emitted.filter((e) => e.type === 'ready')).toEqual([
      { type: 'ready', projectPath: '/a', scope: 'chat' },
      { type: 'ready', projectPath: '/a', scope: 'task:1' },
      { type: 'ready', projectPath: '/b', scope: 'chat' },
    ]);
  });

  it('resumes a supplied session only in its owning scope', async () => {
    const h = harness([streamOf(completedEvents()), streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a', scope: 'one' });
    await h.backend.start({ projectPath: '/a', scope: 'two' });
    h.backend.setSessionId('/a', 'owned-thread', 'one');

    h.backend.send({ projectPath: '/a', scope: 'one', message: 'resume' });
    h.backend.send({ projectPath: '/a', scope: 'two', message: 'new' });
    await settle();

    expect(h.runs.map((r) => r.resumeId)).toEqual(['owned-thread', undefined]);
  });

  it('forwards mapped events with their owning project, scope, and turn sequence', async () => {
    const h = harness([streamOf(completedEvents('answer'))]);
    await h.backend.start({ projectPath: '/a', scope: 'task' });
    h.backend.send({ projectPath: '/a', scope: 'task', message: 'go' });
    await settle();

    const forwarded = h.emitted.filter((e) => !['ready', 'streaming_start'].includes(String(e.type)));
    expect(forwarded).toHaveLength(4);
    for (const event of forwarded) {
      expect(event).toMatchObject({ projectPath: '/a', scope: 'task' });
      if (event.type !== 'session_id') expect(event.turnSeq).toBe(1);
    }
    expect(forwarded.map((e) => e.type)).toEqual(['session_id', 'assistant', 'result', 'done']);
  });

  it('notifies exactly once when a chat turn completes', async () => {
    const h = harness([streamOf(completedEvents('finished'))]);
    h.backend.start({ projectPath: '/a', scope: 'chat' });
    h.backend.send({ projectPath: '/a', scope: 'chat', message: 'go' });
    await settle();

    expect(h.notifyCompletion).toHaveBeenCalledTimes(1);
    expect(h.notifyCompletion).toHaveBeenCalledWith('/a', { provider: 'Codex', summary: 'finished' });
  });

  it('drains native subagent lifecycle events after the parent completes before settling the turn', async () => {
    const stream = pendingStream();
    const h = harness([stream.events]);
    h.backend.start({ projectPath: '/a', scope: 'chat' });
    h.backend.send({ projectPath: '/a', scope: 'chat', message: 'delegate' });
    await settle();

    stream.push({
      type: 'item.started',
      item: { id: 'child-1', type: 'collab_tool_call', status: 'running', description: 'Inspect renderer' },
    } as unknown as ThreadEvent);
    stream.push({
      type: 'turn.completed',
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
    });
    await settle();

    expect(h.emitted.some((event) => event.type === 'result')).toBe(false);
    expect(h.emitted.some((event) => event.type === 'done')).toBe(false);
    expect(h.notifyCompletion).not.toHaveBeenCalled();
    expect(h.emitted).toContainEqual(expect.objectContaining({
      type: 'subagent_activity', agentId: 'child-1', status: 'running', turnSeq: 1,
    }));
    expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(0);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(true);

    stream.push({
      type: 'item.completed',
      item: { id: 'child-1', type: 'collab_tool_call', status: 'completed', description: 'Inspect renderer' },
    } as unknown as ThreadEvent);
    await settle();

    expect(h.emitted).toContainEqual(expect.objectContaining({
      type: 'subagent_activity', agentId: 'child-1', status: 'completed', turnSeq: 1,
    }));
    expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(0);

    stream.end();
    await settle();

    expect(h.emitted.filter((event) => event.type === 'subagent_activity').map((event) => event.status)).toEqual([
      'running', 'completed',
    ]);
    expect(h.emitted.filter((event) => event.type === 'result')).toEqual([
      expect.objectContaining({ type: 'result', projectPath: '/a', scope: 'chat', turnSeq: 1 }),
    ]);
    expect(h.emitted.filter((event) => event.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsSettled: true },
    ]);
    expect(h.emitted.map((event) => event.type).slice(-2)).toEqual(['result', 'done']);
    expect(h.notifyCompletion).toHaveBeenCalledTimes(1);
    expect(h.timeline.slice(-3)).toEqual(['emit:result', 'emit:done', 'notify']);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
  });

  it('settles an active native child when the stream reaches EOF without its terminal event', async () => {
    const stream = pendingStream();
    const h = harness([stream.events]);
    h.backend.start({ projectPath: '/a', scope: 'chat' });
    h.backend.send({ projectPath: '/a', scope: 'chat', message: 'delegate' });
    await settle();

    stream.push({
      type: 'item.started',
      item: { id: 'child-1', type: 'collab_tool_call', status: 'running', description: 'Inspect renderer' },
    } as unknown as ThreadEvent);
    stream.push({
      type: 'turn.completed',
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
    });
    stream.end();
    await settle();

    expect(h.emitted.filter((event) => event.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsSettled: true },
    ]);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
  });

  it('settles a failed stream immediately without waiting for its iterator to end', async () => {
    const stream = pendingStream();
    const h = harness([stream.events]);
    h.backend.start({ projectPath: '/a', scope: 'chat' });
    h.backend.send({ projectPath: '/a', scope: 'chat', message: 'delegate' });
    await settle();

    stream.push({ type: 'turn.failed', error: { message: 'boom' } });
    await settle();

    expect(h.emitted.filter((event) => event.type === 'error')).toEqual([
      expect.objectContaining({ text: 'boom', turnSeq: 1 }),
    ]);
    expect(h.emitted.filter((event) => event.type === 'result')).toHaveLength(0);
    expect(h.emitted.filter((event) => event.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsAborted: true },
    ]);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
    expect(h.notifyCompletion).not.toHaveBeenCalled();
  });

  it('settles a top-level stream error immediately without waiting for its iterator to end', async () => {
    const stream = pendingStream();
    const h = harness([stream.events]);
    h.backend.start({ projectPath: '/a', scope: 'chat' });
    h.backend.send({ projectPath: '/a', scope: 'chat', message: 'delegate' });
    await settle();

    stream.push({ type: 'error', message: 'transport lost' });
    await settle();

    expect(h.emitted.filter((event) => event.type === 'error')).toEqual([
      expect.objectContaining({ text: 'transport lost', turnSeq: 1 }),
    ]);
    expect(h.emitted.filter((event) => event.type === 'result')).toHaveLength(0);
    expect(h.emitted.filter((event) => event.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsAborted: true },
    ]);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
    expect(h.notifyCompletion).not.toHaveBeenCalled();
  });

  it('settles a draining turn exactly once when the SDK iterator throws after parent completion', async () => {
    const stream = (async function* (): AsyncGenerator<ThreadEvent> {
      yield {
        type: 'turn.completed',
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
      };
      throw new Error('late stream failure');
    })();
    const h = harness([stream]);
    h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'delegate' });
    await settle();

    expect(h.emitted.some((event) => event.type === 'result')).toBe(false);
    expect(h.emitted.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
  });

  it.each([
    {
      label: 'a task turn',
      scope: 'task:1',
      events: completedEvents(),
      interrupt: false,
    },
    {
      label: 'a failed chat turn',
      scope: 'chat',
      events: [{ type: 'turn.failed', error: { message: 'boom' } }] satisfies ThreadEvent[],
      interrupt: false,
    },
    {
      label: 'an interrupted chat turn',
      scope: 'chat',
      events: [],
      interrupt: true,
    },
  ])('does not notify for $label', async ({ scope, events, interrupt }) => {
    const stream = pendingStream();
    const h = harness([interrupt ? stream.events : streamOf(events)]);
    h.backend.start({ projectPath: '/a', scope: scope as string, kind: scope === 'chat' ? 'chat' : 'task' });
    h.backend.send({ projectPath: '/a', scope: scope as string, message: 'go' });
    await settle();
    if (interrupt) h.backend.interrupt('/a', scope as string);
    await settle();

    expect(h.notifyCompletion).not.toHaveBeenCalled();
  });

  it('passes structured images, meta preamble, and a string-only enriched environment', async () => {
    const h = harness([streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a', metaPreamble: 'SAI developer context' });
    h.backend.send({ projectPath: '/a', message: 'look', imagePaths: ['/tmp/a.png', '/tmp/b.jpg'] });
    await settle();

    expect(h.runs[0].input).toEqual([
      { type: 'text', text: 'look' },
      { type: 'local_image', path: '/tmp/a.png' },
      { type: 'local_image', path: '/tmp/b.jpg' },
    ]);
    expect(h.clients[0].options).toMatchObject({
      config: { developer_instructions: 'SAI developer context' },
      env: { PATH: '/bin', TOKEN: 'secret' },
    });
    expect(h.clients[0].options.env).not.toHaveProperty('EMPTY');
  });

  it('interrupts only the requested scope and tracks workspace busy state', async () => {
    const one = pendingStream();
    const two = pendingStream();
    const h = harness([one.events, two.events]);
    await h.backend.start({ projectPath: '/a', scope: 'one' });
    await h.backend.start({ projectPath: '/a', scope: 'two' });
    h.backend.send({ projectPath: '/a', scope: 'one', message: 'one' });
    h.backend.send({ projectPath: '/a', scope: 'two', message: 'two' });
    await settle();
    expect(h.backend.isWorkspaceBusy('/a')).toBe(true);

    h.backend.interrupt('/a', 'one');
    await settle();
    expect(h.runs[0].options?.signal?.aborted).toBe(true);
    expect(h.runs[1].options?.signal?.aborted).toBe(false);
    expect(h.emitted.filter((e) => e.type === 'done' && e.scope === 'one')).toHaveLength(1);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(true);

    two.end();
    await settle();
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
  });

  it('suspends one workspace without disturbing another and settles its busy scopes', async () => {
    const a = pendingStream();
    const b = pendingStream();
    const h = harness([a.events, b.events]);
    await h.backend.start({ projectPath: '/a', scope: 'task' });
    await h.backend.start({ projectPath: '/b', scope: 'task' });
    h.backend.send({ projectPath: '/a', scope: 'task', message: 'a' });
    h.backend.send({ projectPath: '/b', scope: 'task', message: 'b' });
    await settle();

    h.backend.suspendWorkspace('/a');
    await settle();
    expect(h.runs[0].options?.signal?.aborted).toBe(true);
    expect(h.runs[1].options?.signal?.aborted).toBe(false);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
    expect(h.backend.isWorkspaceBusy('/b')).toBe(true);
    expect(h.emitted.filter((e) => e.type === 'done' && e.projectPath === '/a')).toHaveLength(1);
  });

  it('reconciles an idle or missing scope with an unconditional null-sequence done', async () => {
    const h = harness([streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a', scope: 'idle' });
    h.backend.send({ projectPath: '/a', scope: 'idle', message: 'done' });
    await settle();

    h.backend.reconcileScope('/a', 'idle');
    h.backend.reconcileScope('/a', 'missing');
    expect(h.emitted.slice(-2)).toEqual([
      { type: 'done', projectPath: '/a', scope: 'idle', turnSeq: null },
      { type: 'done', projectPath: '/a', scope: 'missing', turnSeq: null },
    ]);
  });

  it('emits exactly one done when the mapper supplies a terminal event', async () => {
    const h = harness([streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'go' });
    await settle();
    expect(h.emitted.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsSettled: true },
    ]);
  });

  it('emits one done if a stream ends without a terminal event', async () => {
    const h = harness([streamOf([{ type: 'thread.started', thread_id: 'partial' }])]);
    await h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'go' });
    await settle();
    expect(h.emitted.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsSettled: true },
    ]);
  });

  it('emits a scoped error and one done when the SDK throws', async () => {
    const h = harness([new Error('SDK exploded')]);
    await h.backend.start({ projectPath: '/a', scope: 'task' });
    h.backend.send({ projectPath: '/a', scope: 'task', message: 'go' });
    await settle();
    expect(h.emitted.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', text: 'SDK exploded', projectPath: '/a', scope: 'task', turnSeq: 1 },
    ]);
    expect(h.emitted.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(h.emitted.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'task', turnSeq: 1, subagentsAborted: true },
    ]);
  });

  it('settles an aborted turn without reporting it as an error', async () => {
    const pending = pendingStream();
    const h = harness([pending.events]);
    await h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'go' });
    await settle();
    h.backend.interrupt('/a');
    await settle();
    expect(h.emitted.filter((e) => e.type === 'error')).toHaveLength(0);
    expect(h.emitted.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsAborted: true },
    ]);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
  });

  it('retires an interrupted thread so late identity cannot taint its replacement', async () => {
    const old = pendingStream();
    const replacement = pendingStream();
    const h = harness([old.events, replacement.events, streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'old', model: 'gpt-a' });
    await settle();

    h.backend.interrupt('/a');
    h.backend.send({ projectPath: '/a', message: 'replacement', model: 'gpt-a' });
    await settle();
    expect(h.clients).toHaveLength(2);
    expect(h.clients[0].start.mock.results[0]?.value).not.toBe(h.clients[1].start.mock.results[0]?.value);

    old.push({ type: 'thread.started', thread_id: 'stale-interrupted-thread' });
    replacement.push({ type: 'thread.started', thread_id: 'replacement-after-stop' });
    replacement.push({
      type: 'turn.completed',
      usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 },
    });
    old.end();
    replacement.end();
    await settle();

    h.backend.send({ projectPath: '/a', message: 'config change', model: 'gpt-b' });
    await settle();
    expect(h.clients).toHaveLength(3);
    expect(h.runs[2].resumeId).toBe('replacement-after-stop');
    expect(h.runs[2].resumeId).not.toBe('stale-interrupted-thread');
  });

  it('prevents stale turn cleanup and callbacks from corrupting a replacement turn', async () => {
    const old = pendingStream();
    const replacement = pendingStream();
    const h = harness([old.events, replacement.events]);
    await h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'old' });
    await settle();
    h.backend.send({ projectPath: '/a', message: 'replacement' });
    await settle();
    expect(h.runs[0].options?.signal?.aborted).toBe(true);
    expect(h.emitted.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', projectPath: '/a', scope: 'chat', turnSeq: 1, subagentsAborted: true },
    ]);
    expect(h.clients).toHaveLength(2);
    expect(h.clients[0].start.mock.results[0]?.value).not.toBe(h.clients[1].start.mock.results[0]?.value);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(true);

    old.push({ type: 'item.completed', item: { id: 'stale', type: 'agent_message', text: 'stale' } });
    old.end();
    await settle();
    expect(h.emitted.some((e) => JSON.stringify(e).includes('stale'))).toBe(false);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(true);

    replacement.push({ type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } });
    replacement.end();
    await settle();
    expect(h.emitted.filter((e) => e.type === 'done').map((e) => e.turnSeq)).toEqual([1, 2]);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
  });

  it('keeps a replacement thread authoritative when stale thread identity arrives late', async () => {
    const old = pendingStream();
    const replacement = pendingStream();
    const h = harness([old.events, replacement.events, streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'old', model: 'gpt-a' });
    await settle();
    h.backend.send({ projectPath: '/a', message: 'replacement', model: 'gpt-a' });
    await settle();

    expect(h.clients).toHaveLength(2);
    old.push({ type: 'thread.started', thread_id: 'stale-thread' });
    replacement.push({ type: 'thread.started', thread_id: 'replacement-thread' });
    replacement.push({
      type: 'turn.completed',
      usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 },
    });
    old.end();
    replacement.end();
    await settle();

    h.backend.send({ projectPath: '/a', message: 'config change', model: 'gpt-b' });
    await settle();
    expect(h.clients).toHaveLength(3);
    expect(h.runs[2].resumeId).toBe('replacement-thread');
    expect(h.runs[2].resumeId).not.toBe('stale-thread');
  });

  it('rebuilds config while resuming the same session id', async () => {
    const h = harness([streamOf(completedEvents()), streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a' });
    h.backend.send({ projectPath: '/a', message: 'one', model: 'gpt-a', effort: 'low' });
    await settle();
    h.backend.send({ projectPath: '/a', message: 'two', model: 'gpt-b', effort: 'high' });
    await settle();

    expect(h.clients).toHaveLength(2);
    expect(h.runs[0].threadOptions).toMatchObject({ model: 'gpt-a', modelReasoningEffort: 'low' });
    expect(h.runs[1].threadOptions).toMatchObject({ model: 'gpt-b', modelReasoningEffort: 'high' });
    expect(h.runs[1].resumeId).toBe('thread-new');
  });

  it('setSessionId resets only its scope and resumes the requested id next', async () => {
    const h = harness([streamOf(completedEvents()), streamOf(completedEvents()), streamOf(completedEvents())]);
    await h.backend.start({ projectPath: '/a', scope: 'one' });
    await h.backend.start({ projectPath: '/a', scope: 'two' });
    h.backend.send({ projectPath: '/a', scope: 'one', message: 'one' });
    h.backend.send({ projectPath: '/a', scope: 'two', message: 'two' });
    await settle();

    h.backend.setSessionId('/a', 'replacement-id', 'one');
    h.backend.send({ projectPath: '/a', scope: 'one', message: 'again' });
    await settle();
    expect(h.runs[2].resumeId).toBe('replacement-id');
    expect(h.clients).toHaveLength(3);
  });

  it('setSessionId leaves an active scope untouched until its turn settles', async () => {
    const active = pendingStream();
    const h = harness([active.events]);
    await h.backend.start({ projectPath: '/a', scope: 'chat' });
    h.backend.send({ projectPath: '/a', scope: 'chat', message: 'working' });
    await settle();

    h.backend.setSessionId('/a', 'different-session', 'chat');
    expect(h.runs[0].options?.signal?.aborted).toBe(false);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(true);
    expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(0);

    active.push({
      type: 'turn.completed',
      usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 },
    });
    active.end();
    await settle();
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
  });

  it('announces the turn before client initialization errors and settles the same sequence', async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const backend = new SdkCodexBackend({
      createClient: () => { throw new Error('client init failed'); },
      emit: (event) => emitted.push(event),
      getEnv: () => ({ PATH: '/bin' }),
    });
    await backend.start({ projectPath: '/a', scope: 'task' });
    backend.send({ projectPath: '/a', scope: 'task', message: 'go' });

    expect(emitted.slice(1).map((event) => event.type)).toEqual([
      'streaming_start', 'error', 'done',
    ]);
    expect(emitted.slice(1)).toEqual([
      {
        type: 'streaming_start', projectPath: '/a', scope: 'task',
        turnSeq: 1, sessionId: null,
      },
      { type: 'error', text: 'client init failed', projectPath: '/a', scope: 'task', turnSeq: 1 },
      { type: 'done', projectPath: '/a', scope: 'task', turnSeq: 1, subagentsAborted: true },
    ]);
  });

  it('delegates model loading and defaults to an empty model result', async () => {
    const delegated = harness();
    await expect(delegated.backend.getModels(true)).resolves.toEqual({
      models: [{ id: 'gpt-5', name: 'GPT-5' }], defaultModel: 'gpt-5',
    });

    const empty = new SdkCodexBackend({
      createClient: () => { throw new Error('unused'); },
      emit: () => undefined,
      getEnv: () => ({}),
    });
    await expect(empty.getModels()).resolves.toEqual({ models: [], defaultModel: '' });
  });

  it('returns a typed unsupported result for approval decisions', () => {
    const h = harness();
    expect(h.backend.approve('/a', 'chat', 'request-1', { type: 'decision', value: 'accept' }))
      .toEqual({ ok: false, code: 'unsupported' });
  });

  it('destroy aborts every active scope and leaves no workspace busy', async () => {
    const a = pendingStream();
    const b = pendingStream();
    const h = harness([a.events, b.events]);
    await h.backend.start({ projectPath: '/a' });
    await h.backend.start({ projectPath: '/b' });
    h.backend.send({ projectPath: '/a', message: 'a' });
    h.backend.send({ projectPath: '/b', message: 'b' });
    await settle();
    h.backend.destroy();
    await settle();
    expect(h.runs.every((run) => run.options?.signal?.aborted)).toBe(true);
    expect(h.backend.isWorkspaceBusy('/a')).toBe(false);
    expect(h.backend.isWorkspaceBusy('/b')).toBe(false);
  });
});
