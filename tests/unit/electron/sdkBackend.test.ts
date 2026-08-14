// @vitest-environment node
/**
 * sdkBackend.test.ts — TDD for SdkBackend
 *
 * All 5 required test cases from the task-3-brief:
 *   1. send → streaming_start (turnSeq 1) + result + done (turnSeq 1)
 *   2. wait→resume: second streaming_start gets turnSeq 2, final done gets turnSeq 2
 *   3. interrupt() calls query.interrupt()
 *   4. setSessionId + send → queryFn called with options.resume === id
 *   5. destroy() calls query.close()
 *
 * Task 1 (Phase 2): canUseTool / approval tests:
 *   8. canUseTool is passed to queryFn options when permMode is not bypass
 *   9. canUseTool callback for Bash emits approval_needed (with command) + returns pending promise; approve(true) resolves allow
 *  10. canUseTool callback for non-Bash emits approval_needed (no command) + approve(false) resolves deny
 *  11. canUseTool is NOT passed when permMode is bypass
 *  12. approve returns false (no-op) when toolUseId not found
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted is required so the mock variables are available when vi.mock factory runs
const {
  mockApproveImpl,
  mockAnswerQuestionImpl,
  mockAnswerPlanReviewImpl,
  mockAlwaysAllowImpl,
  mockGenerateCommitMessageImpl,
  mockGenerateTitleImpl,
  mockGetAvailableClaudeModels,
  mockReadCachedSlashCommands,
  mockWriteCachedSlashCommands,
  mockReadSaiSetting,
  mockGetRemoteCeiling,
  mockSpawnEnv,
  mockGetOrCreateWorkspace,
} = vi.hoisted(() => ({
  mockApproveImpl: vi.fn().mockResolvedValue(undefined),
  mockAnswerQuestionImpl: vi.fn().mockResolvedValue(true),
  mockAnswerPlanReviewImpl: vi.fn().mockResolvedValue(true),
  mockAlwaysAllowImpl: vi.fn().mockResolvedValue(true),
  mockGenerateCommitMessageImpl: vi.fn().mockResolvedValue('msg'),
  mockGenerateTitleImpl: vi.fn().mockResolvedValue('title'),
  mockGetAvailableClaudeModels: vi.fn().mockReturnValue({ models: [], detected: false }),
  mockReadCachedSlashCommands: vi.fn().mockReturnValue(['/foo', '/bar']),
  mockWriteCachedSlashCommands: vi.fn(),
  mockReadSaiSetting: vi.fn().mockReturnValue(undefined),
  mockGetRemoteCeiling: vi.fn().mockReturnValue(null),
  mockSpawnEnv: vi.fn().mockReturnValue({ PATH: '/enriched/bin', NODE_OPTIONS: '--max-old-space-size=1024' }),
  mockGetOrCreateWorkspace: vi.fn(),
}));

vi.mock('../../../electron/services/claude', () => ({
  // Delegation target for non-SDK approvals (Gemini). Real impl returns
  // undefined for unknown toolUseIds — mirror that as the default.
  approveImpl: mockApproveImpl,
  answerQuestionImpl: mockAnswerQuestionImpl,
  answerPlanReviewImpl: mockAnswerPlanReviewImpl,
  alwaysAllowImpl: mockAlwaysAllowImpl,
  generateCommitMessageImpl: mockGenerateCommitMessageImpl,
  generateTitleImpl: mockGenerateTitleImpl,
  getAvailableClaudeModels: mockGetAvailableClaudeModels,
  readCachedSlashCommands: mockReadCachedSlashCommands,
  writeCachedSlashCommands: mockWriteCachedSlashCommands,
  readSaiSetting: mockReadSaiSetting,
  getRemoteCeiling: mockGetRemoteCeiling,
  getMainWin: () => null,
  spawnEnv: mockSpawnEnv,
  getOrCreateWorkspace: mockGetOrCreateWorkspace,
}));

// notify.ts touches electron `app` at module load — must be mocked in node env.
vi.mock('../../../electron/services/notify', () => ({
  notifyCompletion: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyPlanReview: vi.fn(),
}));

// Import after mocks are set up
import { SdkBackend } from '../../../electron/services/claudeBackend/sdkBackend';

// fs mock — mockReadFileSync is overridden per-test that needs it; others leave it as-is
const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: mockReadFileSync };
});

// externalMcp reads the real ~/.claude.json / plugin dirs at session creation;
// stub it so unit tests stay hermetic (and don't consume once-mocked fs reads).
vi.mock('../../../electron/services/claudeBackend/externalMcp', () => ({
  loadExternalMcpForSdk: () => ({ servers: {}, plugins: [] }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FakeQuery extends AsyncIterable<any> {
  interruptSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
  interrupt: () => Promise<void>;
  close: () => void;
  [Symbol.asyncIterator]: () => AsyncIterator<any>;
}

/**
 * Build a fake Query object that yields the given messages in order,
 * with `interrupt` and `close` spies.
 * When `hang` is true, after yielding messages the generator will block
 * indefinitely until close() is called (models a live streaming session).
 */
function makeFakeQuery(messages: any[], opts: { hang?: boolean } = {}): FakeQuery {
  const interruptSpy = vi.fn().mockResolvedValue(undefined);
  const closeSpy = vi.fn();

  let closed = false;
  let hangResolve: (() => void) | null = null;
  const pending: any[] = [...messages];

  async function* gen() {
    for (const msg of pending) {
      if (closed) return;
      yield msg;
    }
    // If hang mode, block until close() is called
    if (opts.hang) {
      await new Promise<void>((res) => { hangResolve = res; });
    }
  }

  const iterator = gen();

  const fakeQuery: FakeQuery = {
    interruptSpy,
    closeSpy,
    interrupt: interruptSpy,
    close: () => {
      closed = true;
      closeSpy();
      hangResolve?.();
    },
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };

  return fakeQuery;
}

const PROJECT = '/some/project';
const SCOPE = 'chat';

/** Collect all emits from a send call, waiting for 'done' */
async function collectUntilDone(
  backend: SdkBackend,
  emits: Record<string, unknown>[],
  args: { projectPath: string; message: string; scope?: string; permMode?: string },
): Promise<void> {
  return new Promise<void>((resolve) => {
    const originalLength = emits.length;
    // poll for done
    const check = () => {
      const newEmits = emits.slice(originalLength);
      if (newEmits.some(e => e.type === 'done')) {
        resolve();
      } else {
        setTimeout(check, 5);
      }
    };

    backend.send({ projectPath: args.projectPath, message: args.message, scope: args.scope, permMode: args.permMode });
    setTimeout(check, 5);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SdkBackend', () => {
  let emits: Record<string, unknown>[];
  let capturedQueryArgs: Array<{ prompt: any; options: any }>;

  beforeEach(() => {
    emits = [];
    capturedQueryArgs = [];
  });

  // ── Test 1: send → streaming_start(turnSeq=1) + result + done(turnSeq=1) ──

  it('(1) send emits streaming_start(turnSeq=1) then result and done(turnSeq=1)', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);

    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedQueryArgs.push(args);
      return fakeQuery;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.send({ projectPath: PROJECT, message: 'hello', scope: SCOPE });
    // Wait for drain
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.some(e => e.type === 'done')) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    // First emit must be streaming_start (order-sensitive)
    expect(emits[0].type).toBe('streaming_start');

    // First emit must be streaming_start with turnSeq 1
    const startEmit = emits.find(e => e.type === 'streaming_start');
    expect(startEmit).toBeDefined();
    expect(startEmit!.turnSeq).toBe(1);
    expect(startEmit!.projectPath).toBe(PROJECT);
    expect(startEmit!.scope).toBe(SCOPE);

    // result emit must carry turnSeq 1
    const resultEmit = emits.find(e => e.type === 'result');
    expect(resultEmit).toBeDefined();
    expect(resultEmit!.turnSeq).toBe(1);

    // done emit must carry turnSeq 1
    const doneEmit = emits.find(e => e.type === 'done');
    expect(doneEmit).toBeDefined();
    expect(doneEmit!.turnSeq).toBe(1);

    // queryFn called once
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  // ── Test 2: wait→resume: second streaming_start gets turnSeq=2, done gets turnSeq=2 ──

  it('(2) wait→resume sequence: second streaming_start has turnSeq=2, final done has turnSeq=2', async () => {
    // Script: assistant (triggers re-arm from mapper), result, assistant (re-arm again), result
    const fakeQuery = makeFakeQuery([
      // First turn: assistant arrives (streaming=false initially → mapper emits streaming_start + assistant)
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'thinking...' }] } },
      // Wait result (stop for tool use)
      { type: 'result', stop_reason: 'tool_use', num_turns: 1 },
      // Second turn: assistant resumes (streaming=false after result → mapper emits streaming_start again)
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'resumed' }] } },
      // Final result
      { type: 'result', stop_reason: 'end_turn', num_turns: 2 },
    ]);

    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => {
        // Wait for 2 done emits
        if (emits.filter(e => e.type === 'done').length >= 2) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    const streamingStarts = emits.filter(e => e.type === 'streaming_start');
    expect(streamingStarts).toHaveLength(2);
    // First from send() itself
    expect(streamingStarts[0].turnSeq).toBe(1);
    // Second from re-arm in drain loop (assistant after result)
    expect(streamingStarts[1].turnSeq).toBe(2);

    const dones = emits.filter(e => e.type === 'done');
    expect(dones).toHaveLength(2);
    expect(dones[0].turnSeq).toBe(1);
    expect(dones[1].turnSeq).toBe(2);
  });

  // ── Test 2b: background launch → done carries wait.kind 'background' ──

  it('(2b) a turn that dispatched Agent run_in_background ends with wait.kind=background on result+done', async () => {
    const fakeQuery = makeFakeQuery([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'dispatching reviewer…' },
            { type: 'tool_use', id: 'tu-agent-1', name: 'Agent', input: { prompt: 'review it', run_in_background: true } },
          ],
        },
      },
      { type: 'result', stop_reason: 'end_turn', num_turns: 1, terminal_reason: 'completed' },
    ], { hang: true });

    const backend = new SdkBackend({
      queryFn: vi.fn(() => fakeQuery),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE, permMode: 'bypass' });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'done')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    const done = emits.find(e => e.type === 'done') as any;
    const result = emits.find(e => e.type === 'result') as any;
    expect(result?.wait?.kind).toBe('background');
    expect(done?.wait?.kind).toBe('background');
    fakeQuery.close();
  });

  // ── Test 2c: background-wait scope survives a chat select (setSessionId) ──

  it('(2c) setSessionId on a scope waiting for a background-task resume leaves the query alive', async () => {
    const fakeQuery = makeFakeQuery([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu-agent-1', name: 'Agent', input: { prompt: 'review', run_in_background: true } }],
        },
      },
      // Turn ends while the reviewer keeps running — the runtime will re-invoke
      // the model when it finishes, but only if the query stays alive.
      { type: 'result', stop_reason: 'end_turn', num_turns: 1, terminal_reason: 'completed' },
    ], { hang: true });

    const backend = new SdkBackend({
      queryFn: vi.fn(() => fakeQuery),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE, permMode: 'bypass' });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'done')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });
    expect((emits.find(e => e.type === 'done') as any)?.wait?.kind).toBe('background');

    // User switches away and back to this chat → renderer calls setSessionId.
    emits.length = 0;
    backend.setSessionId(PROJECT, 'persisted-session-id', SCOPE);
    expect(fakeQuery.closeSpy).not.toHaveBeenCalled();
    // No synthetic done either — one would clear the renderer's waiting pill.
    expect(emits.find(e => e.type === 'done')).toBeUndefined();
    fakeQuery.close();
  });

  // ── Test 2d: reconcileScope re-asserts backend truth for stuck renderers ──

  it('(2d) reconcileScope emits an unstick done(turnSeq null) when the scope is idle or unknown, and stays silent while busy', async () => {
    const backend = new SdkBackend({
      queryFn: vi.fn(() => makeFakeQuery([], { hang: true })),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    // Unknown scope (no session at all — e.g. swept): must unstick.
    backend.reconcileScope(PROJECT, 'ghost-scope');
    let done = emits.find(e => e.type === 'done') as any;
    expect(done).toBeDefined();
    expect(done.turnSeq).toBeNull();
    expect(done.scope).toBe('ghost-scope');
    expect(done.wait).toBeUndefined();

    // Streaming scope: backend is mid-turn — reconcile must NOT end it.
    emits.length = 0;
    backend.send({ projectPath: PROJECT, message: 'work', scope: SCOPE, permMode: 'bypass' });
    await new Promise(r => setTimeout(r, 10));
    backend.reconcileScope(PROJECT, SCOPE);
    expect(emits.filter(e => e.type === 'done')).toHaveLength(0);
  });

  it('(2e) reconcileScope on a live idle session unsticks, and re-asserts the wait for a background-waiting scope', async () => {
    const fakeQuery = makeFakeQuery([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Agent', input: { prompt: 'go', run_in_background: true } }],
        },
      },
      { type: 'result', stop_reason: 'end_turn', num_turns: 1, terminal_reason: 'completed' },
    ], { hang: true });
    const backend = new SdkBackend({
      queryFn: vi.fn(() => fakeQuery),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE, permMode: 'bypass' });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'done')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    // Background wait: reconcile re-emits the wait done (renderer may have
    // lost the original) instead of clearing the state.
    emits.length = 0;
    backend.reconcileScope(PROJECT, SCOPE);
    const waitDone = emits.find(e => e.type === 'done') as any;
    expect(waitDone).toBeDefined();
    expect(waitDone.turnSeq).toBeNull();
    expect(waitDone.wait?.kind).toBe('background');
    fakeQuery.close();
  });

  // ── Test 3: interrupt() calls query.interrupt() ──

  it('(3) interrupt() calls the query interrupt spy', async () => {
    // Make a query that hangs indefinitely (blocks until closed/interrupted)
    const fakeQuery = makeFakeQuery([], { hang: true });
    fakeQuery.interrupt = vi.fn().mockResolvedValue(undefined);
    (fakeQuery as any).interruptSpy = fakeQuery.interrupt;

    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.send({ projectPath: PROJECT, message: 'work', scope: SCOPE });
    // Let the session be established
    await new Promise(r => setTimeout(r, 20));

    backend.interrupt(PROJECT, SCOPE);

    expect(fakeQuery.interrupt).toHaveBeenCalledTimes(1);
  });

  // ── Test 4: setSessionId + send → queryFn called with options.resume === id ──

  it('(4) setSessionId then send creates a new query with options.resume set', async () => {
    const SESSION_ID = 'resume-session-abc';

    const fakeQuery1 = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);
    const fakeQuery2 = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);

    let callCount = 0;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedQueryArgs.push(args);
      callCount++;
      return callCount === 1 ? fakeQuery1 : fakeQuery2;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    // First send
    backend.send({ projectPath: PROJECT, message: 'first', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.filter(e => e.type === 'done').length >= 1) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    // Set session ID (simulates server sending a session_id)
    backend.setSessionId(PROJECT, SESSION_ID, SCOPE);

    // Second send — should use resume
    const priorDones = emits.filter(e => e.type === 'done').length;
    backend.send({ projectPath: PROJECT, message: 'second', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.filter(e => e.type === 'done').length > priorDones) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    expect(queryFn).toHaveBeenCalledTimes(2);
    // Second call must have options.resume === SESSION_ID
    expect(capturedQueryArgs[1].options.resume).toBe(SESSION_ID);
  });

  // ── Test 5: destroy() calls query.close() ──

  it('(5) destroy() calls close() on all live sessions', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    fakeQuery.close = vi.fn();
    (fakeQuery as any).closeSpy = fakeQuery.close;

    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.send({ projectPath: PROJECT, message: 'work', scope: SCOPE });
    // Give session time to start
    await new Promise(r => setTimeout(r, 20));

    backend.destroy();

    expect(fakeQuery.close).toHaveBeenCalledTimes(1);
  });

  // ── Test 6: drain-loop error → error+done emitted, dead session removed, next send rebuilds ──

  it('(6) drain-loop error removes dead session; subsequent send creates a fresh query', async () => {
    // First query: async generator that throws immediately
    function makeThrowingQuery() {
      const interruptSpy = vi.fn().mockResolvedValue(undefined);
      const closeSpy = vi.fn();

      async function* gen() {
        throw new Error('sdk exploded');
      }

      const iterator = gen();
      return {
        interruptSpy,
        closeSpy,
        interrupt: interruptSpy,
        close: closeSpy,
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
    }

    const throwingQuery = makeThrowingQuery();
    const goodQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);

    let callCount = 0;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedQueryArgs.push(args);
      callCount++;
      return callCount === 1 ? throwingQuery : goodQuery;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    // First send — drain loop will throw
    backend.send({ projectPath: PROJECT, message: 'first', scope: SCOPE });
    // Wait for error + done to be emitted
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.some(e => e.type === 'error') && emits.some(e => e.type === 'done')) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    expect(emits.some(e => e.type === 'error')).toBe(true);
    const errorEmit = emits.find(e => e.type === 'error') as Record<string, unknown>;
    expect(errorEmit.text).toContain('sdk exploded');
    expect(emits.some(e => e.type === 'done')).toBe(true);

    // queryFn was called once for the first (throwing) query
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Second send — dead session must have been removed; queryFn should be called again
    const priorDones = emits.filter(e => e.type === 'done').length;
    backend.send({ projectPath: PROJECT, message: 'second', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.filter(e => e.type === 'done').length > priorDones) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    // queryFn must have been called a second time (fresh session, not the dead one)
    expect(queryFn).toHaveBeenCalledTimes(2);
    // Second send should succeed (result + done emitted)
    const dones = emits.filter(e => e.type === 'done');
    expect(dones.length).toBeGreaterThanOrEqual(2);
  });

  // ── Task 1 Phase 2: canUseTool / approval tests ───────────────────────────

  it('(8) non-bypass send passes canUseTool in queryFn options', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);

    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedOptions = args.options;
      return fakeQuery;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.send({ projectPath: PROJECT, message: 'hello', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.some(e => e.type === 'done')) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    expect(capturedOptions).toBeDefined();
    expect(typeof capturedOptions.canUseTool).toBe('function');
  });

  it('(9) canUseTool for Bash emits approval_needed with command; approve(true) resolves allow', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });

    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedOptions = args.options;
      return fakeQuery;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'run', scope: SCOPE, permMode: 'default' });

    // Wait for session to be created (options captured)
    await new Promise<void>((resolve) => {
      const check = () => {
        if (capturedOptions) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    const canUseTool = capturedOptions.canUseTool;
    expect(typeof canUseTool).toBe('function');

    // Invoke canUseTool as the SDK would (Bash tool)
    const resultPromise = canUseTool(
      'Bash',
      { command: 'echo hi' },
      { toolUseID: 'tu1', signal: new AbortController().signal },
    );

    // It should emit approval_needed
    await new Promise(r => setTimeout(r, 5));
    const approvalEmit = emits.find(e => e.type === 'approval_needed');
    expect(approvalEmit).toBeDefined();
    expect(approvalEmit!.toolName).toBe('Bash');
    expect(approvalEmit!.toolUseId).toBe('tu1');
    expect(approvalEmit!.command).toBe('echo hi');
    expect(approvalEmit!.projectPath).toBe(PROJECT);
    expect(approvalEmit!.scope).toBe(SCOPE);
    expect(approvalEmit!.input).toEqual({ command: 'echo hi' });

    // Promise should still be pending
    let resolved = false;
    resultPromise.then(() => { resolved = true; });
    await new Promise(r => setTimeout(r, 5));
    expect(resolved).toBe(false);

    // approve(true) should resolve it
    const approveResult = await backend.approve({ projectPath: PROJECT, toolUseId: 'tu1', approved: true, scope: SCOPE });
    expect(approveResult).toBe(true);

    const permResult = await resultPromise;
    expect(permResult).toEqual({ behavior: 'allow' });

    // Clean up
    fakeQuery.close();
  });

  it('(10) canUseTool for non-Bash has no command; approve(false) resolves deny', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });

    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedOptions = args.options;
      return fakeQuery;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'run', scope: SCOPE, permMode: 'default' });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (capturedOptions) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    const canUseTool = capturedOptions.canUseTool;
    const resultPromise = canUseTool(
      'Edit',
      { file_path: '/some/file.ts', old_str: 'foo', new_str: 'bar' },
      { toolUseID: 'tu2', signal: new AbortController().signal },
    );

    await new Promise(r => setTimeout(r, 5));
    const approvalEmit = emits.find(e => e.type === 'approval_needed');
    expect(approvalEmit).toBeDefined();
    expect(approvalEmit!.toolName).toBe('Edit');
    expect(approvalEmit!.toolUseId).toBe('tu2');
    // CLI-parity command derivation: non-Bash tools surface their target
    // (file_path/path/pattern/url/query fallback chain) on the approval card.
    expect(approvalEmit!.command).toBe('/some/file.ts');

    const approveResult = await backend.approve({ projectPath: PROJECT, toolUseId: 'tu2', approved: false, scope: SCOPE });
    expect(approveResult).toBe(true);

    const permResult = await resultPromise;
    expect(permResult).toEqual({ behavior: 'deny', message: 'User denied tool use' });

    // Resolution clears the card everywhere (CLI parity)
    expect(emits.find(e => e.type === 'approval_resolved')).toBeDefined();

    fakeQuery.close();
  });

  it('(11) bypass permMode does NOT pass canUseTool in queryFn options', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);

    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedOptions = args.options;
      return fakeQuery;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    backend.send({ projectPath: PROJECT, message: 'hello', scope: SCOPE, permMode: 'bypass' });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.some(e => e.type === 'done')) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions.canUseTool).toBeUndefined();
  });

  it('(11b) canUseTool GATES AskUserQuestion: question_needed emitted, promise held until answerQuestion resolves with the answers', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => { capturedOptions = args.options; return fakeQuery; });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'ask', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((resolve) => { const check = () => { if (capturedOptions) resolve(); else setTimeout(check, 5); }; setTimeout(check, 5); });

    const gatePromise = capturedOptions.canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Which approach?' }] },
      { toolUseID: 'tu-ask', signal: new AbortController().signal },
    );

    await new Promise(r => setTimeout(r, 5));
    // Card emitted from the gate, no approval banner
    const questionNeeded = emits.find(e => e.type === 'question_needed');
    expect(questionNeeded).toBeDefined();
    expect(questionNeeded!.toolUseId).toBe('tu-ask');
    expect(questionNeeded!.question).toBe('Which approach?');
    expect(emits.find(e => e.type === 'approval_needed')).toBeUndefined();

    // Promise held — the model cannot proceed past the unanswered question
    let resolved = false;
    gatePromise.then(() => { resolved = true; });
    await new Promise(r => setTimeout(r, 5));
    expect(resolved).toBe(false);

    const ok = await backend.answerQuestion({ projectPath: PROJECT, toolUseId: 'tu-ask', answers: { q0: 'Option A' }, scope: SCOPE });
    expect(ok).toBe(true);
    const permResult = await gatePromise;
    expect(permResult.behavior).toBe('deny'); // answers delivered as the tool result
    expect(permResult.message).toContain('Option A');
    expect(emits.find(e => e.type === 'question_answered')).toBeDefined();

    fakeQuery.close();
  });

  it('(11c) canUseTool GATES ExitPlanMode: plan_review_needed emitted; approve → allow, reject → deny', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => { capturedOptions = args.options; return fakeQuery; });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'plan', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((resolve) => { const check = () => { if (capturedOptions) resolve(); else setTimeout(check, 5); }; setTimeout(check, 5); });

    // Approved plan → allow with the original input
    const planInput = { plan: 'Step 1: A. Step 2: B.', planFilePath: '/tmp/plan.md' };
    const approvedPromise = capturedOptions.canUseTool(
      'ExitPlanMode', planInput,
      { toolUseID: 'tu-plan-1', signal: new AbortController().signal },
    );
    await new Promise(r => setTimeout(r, 5));
    const card = emits.find(e => e.type === 'plan_review_needed');
    expect(card).toBeDefined();
    expect(card!.plan).toBe(planInput.plan);
    expect(card!.planFilePath).toBe(planInput.planFilePath);

    let resolved = false;
    approvedPromise.then(() => { resolved = true; });
    await new Promise(r => setTimeout(r, 5));
    expect(resolved).toBe(false); // held until the user decides

    await backend.answerPlanReview({ projectPath: PROJECT, toolUseId: 'tu-plan-1', approved: true, scope: SCOPE });
    expect(await approvedPromise).toEqual({ behavior: 'allow', updatedInput: planInput });
    expect(emits.find(e => e.type === 'plan_review_answered' && e.approved === true)).toBeDefined();

    // Rejected plan → deny with corrective message
    const rejectedPromise = capturedOptions.canUseTool(
      'ExitPlanMode', planInput,
      { toolUseID: 'tu-plan-2', signal: new AbortController().signal },
    );
    await new Promise(r => setTimeout(r, 5));
    await backend.answerPlanReview({ projectPath: PROJECT, toolUseId: 'tu-plan-2', approved: false, scope: SCOPE });
    const rejected = await rejectedPromise;
    expect(rejected.behavior).toBe('deny');
    expect(rejected.message).toContain('rejected');

    fakeQuery.close();
  });

  it('(12) approve delegates unknown toolUseIds to approveImpl (Gemini path) and returns false when unhandled', async () => {
    const backend = new SdkBackend({
      queryFn: vi.fn(() => makeFakeQuery([])),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    const result = await backend.approve({ projectPath: PROJECT, toolUseId: 'nonexistent', approved: true, scope: SCOPE });
    expect(result).toBe(false);
    // Must have fallen through to the CLI impl, which owns Gemini approvals.
    expect(mockApproveImpl).toHaveBeenCalledWith(PROJECT, 'nonexistent', true, undefined, SCOPE);

    // When the CLI impl handles it (e.g. a Gemini approval), approve reports true.
    mockApproveImpl.mockResolvedValueOnce(true);
    const handled = await backend.approve({ projectPath: PROJECT, toolUseId: 'gemini-tu', approved: false, scope: SCOPE });
    expect(handled).toBe(true);
  });

  // ── Test 7: normal drain completion removes session; next send rebuilds ──

  it('(7) normal drain completion removes session so next send creates a fresh query', async () => {
    const fakeQuery1 = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);
    const fakeQuery2 = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ]);

    let callCount = 0;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedQueryArgs.push(args);
      callCount++;
      return callCount === 1 ? fakeQuery1 : fakeQuery2;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    // First send — drains normally
    backend.send({ projectPath: PROJECT, message: 'first', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.some(e => e.type === 'done')) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    expect(queryFn).toHaveBeenCalledTimes(1);

    // Second send — session should have been deleted after normal completion
    // so queryFn is called again for a fresh session
    const priorDones = emits.filter(e => e.type === 'done').length;
    backend.send({ projectPath: PROJECT, message: 'second', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.filter(e => e.type === 'done').length > priorDones) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  // ── Task 2 Phase 2: AskUserQuestion + ExitPlanMode flows ─────────────────

  it('(13) [bypass fallback] AskUserQuestion tool_use in assistant message emits question_needed; answerQuestion emits question_answered + pushes follow-up input', async () => {
    // Script a drain stream with an assistant message containing AskUserQuestion tool_use
    const TOOL_USE_ID = 'tool-ask-123';
    const QUESTION_TEXT = 'Which approach do you prefer?';

    // Capture pushInput calls via a spy on the input iterable
    let capturedPushInput: ((msg: any) => void) | null = null;
    const pushedInputs: any[] = [];

    const assistantMsg = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I need to ask you something.' },
          {
            type: 'tool_use',
            id: TOOL_USE_ID,
            name: 'AskUserQuestion',
            input: {
              questions: [{ question: QUESTION_TEXT }],
            },
          },
        ],
      },
    };

    // Use hang:true so drain keeps the session alive after yielding the messages
    const fakeQuery = makeFakeQuery([
      assistantMsg,
    ], { hang: true });

    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedQueryArgs.push(args);
      return fakeQuery;
    });

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    // Monkey-patch _createSession to spy on pushInput before session is stored
    const origCreateSession = (backend as any)._createSession.bind(backend);
    (backend as any)._createSession = function (...args: any[]) {
      const session = origCreateSession(...args);
      const origPush = session.pushInput.bind(session);
      session.pushInput = (msg: any) => {
        pushedInputs.push(msg);
        origPush(msg);
      };
      capturedPushInput = session.pushInput;
      return session;
    };

    // bypass → no canUseTool gate; cards come from drain detection and the
    // answer is injected as a corrective user message (legacy flow).
    backend.send({ projectPath: PROJECT, message: 'start', scope: SCOPE, permMode: 'bypass' });

    // Wait until question_needed is emitted
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.some(e => e.type === 'question_needed')) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    // Assert question_needed payload
    const questionNeeded = emits.find(e => e.type === 'question_needed');
    expect(questionNeeded).toBeDefined();
    expect(questionNeeded!.toolUseId).toBe(TOOL_USE_ID);
    expect(questionNeeded!.question).toBe(QUESTION_TEXT);
    expect(questionNeeded!.projectPath).toBe(PROJECT);
    expect(questionNeeded!.scope).toBe(SCOPE);

    // Count inputs pushed so far (the initial send message)
    const inputsBeforeAnswer = pushedInputs.length;

    // Call answerQuestion
    const answers = { q0: 'Option A' };
    const result = await backend.answerQuestion({ projectPath: PROJECT, toolUseId: TOOL_USE_ID, answers, scope: SCOPE });
    expect(result).toBe(true);

    // Assert question_answered emitted
    const questionAnswered = emits.find(e => e.type === 'question_answered');
    expect(questionAnswered).toBeDefined();
    expect(questionAnswered!.toolUseId).toBe(TOOL_USE_ID);
    expect(questionAnswered!.answers).toEqual(answers);
    expect(questionAnswered!.projectPath).toBe(PROJECT);
    expect(questionAnswered!.scope).toBe(SCOPE);

    // Assert a follow-up message was pushed into the input channel
    expect(pushedInputs.length).toBeGreaterThan(inputsBeforeAnswer);
    const followUp = pushedInputs[pushedInputs.length - 1];
    expect(followUp.type).toBe('user');
    expect(followUp.message.role).toBe('user');
    expect(typeof followUp.message.content).toBe('string');
  });

  it('(14) [bypass fallback] ExitPlanMode tool_use in assistant message emits plan_review_needed; answerPlanReview(approved=true) emits plan_review_answered + pushes follow-up input', async () => {
    const TOOL_USE_ID = 'tool-plan-456';
    const PLAN_TEXT = 'Step 1: Do A. Step 2: Do B.';
    const PLAN_FILE = '/tmp/plan.md';

    const pushedInputs: any[] = [];

    const assistantMsg = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is my plan.' },
          {
            type: 'tool_use',
            id: TOOL_USE_ID,
            name: 'ExitPlanMode',
            input: {
              plan: PLAN_TEXT,
              planFilePath: PLAN_FILE,
            },
          },
        ],
      },
    };

    // Use hang:true so the session stays alive after emitting plan_review_needed
    const fakeQuery = makeFakeQuery([
      assistantMsg,
    ], { hang: true });

    const queryFn = vi.fn(() => fakeQuery);

    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    const origCreateSession = (backend as any)._createSession.bind(backend);
    (backend as any)._createSession = function (...args: any[]) {
      const session = origCreateSession(...args);
      const origPush = session.pushInput.bind(session);
      session.pushInput = (msg: any) => {
        pushedInputs.push(msg);
        origPush(msg);
      };
      return session;
    };

    backend.send({ projectPath: PROJECT, message: 'start', scope: SCOPE, permMode: 'bypass' });

    // Wait until plan_review_needed is emitted
    await new Promise<void>((resolve) => {
      const check = () => {
        if (emits.some(e => e.type === 'plan_review_needed')) resolve();
        else setTimeout(check, 5);
      };
      setTimeout(check, 5);
    });

    // Assert plan_review_needed payload
    const planReviewNeeded = emits.find(e => e.type === 'plan_review_needed');
    expect(planReviewNeeded).toBeDefined();
    expect(planReviewNeeded!.toolUseId).toBe(TOOL_USE_ID);
    expect(planReviewNeeded!.plan).toBe(PLAN_TEXT);
    expect(planReviewNeeded!.planFilePath).toBe(PLAN_FILE);
    expect(planReviewNeeded!.projectPath).toBe(PROJECT);
    expect(planReviewNeeded!.scope).toBe(SCOPE);

    const inputsBeforeAnswer = pushedInputs.length;

    // Call answerPlanReview with approved=true
    const result = await backend.answerPlanReview({ projectPath: PROJECT, toolUseId: TOOL_USE_ID, approved: true, scope: SCOPE });
    expect(result).toBe(true);

    // Assert plan_review_answered emitted
    const planReviewAnswered = emits.find(e => e.type === 'plan_review_answered');
    expect(planReviewAnswered).toBeDefined();
    expect(planReviewAnswered!.toolUseId).toBe(TOOL_USE_ID);
    expect(planReviewAnswered!.approved).toBe(true);
    expect(planReviewAnswered!.projectPath).toBe(PROJECT);
    expect(planReviewAnswered!.scope).toBe(SCOPE);

    // Assert a follow-up message was pushed
    expect(pushedInputs.length).toBeGreaterThan(inputsBeforeAnswer);
    const followUp = pushedInputs[pushedInputs.length - 1];
    expect(followUp.type).toBe('user');
    expect(followUp.message.role).toBe('user');
    expect(followUp.message.content).toContain('approved');
  });

  it('(15) answerQuestion returns false when no session exists for the scope', async () => {
    const backend = new SdkBackend({
      queryFn: vi.fn(() => makeFakeQuery([])),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    // No send() call — no session exists
    const result = await backend.answerQuestion({
      projectPath: PROJECT,
      toolUseId: 'nonexistent-tu',
      answers: { q0: 'A' },
      scope: SCOPE,
    });
    expect(result).toBe(false);
  });

  it('(16) answerPlanReview returns false when no session exists for the scope', async () => {
    const backend = new SdkBackend({
      queryFn: vi.fn(() => makeFakeQuery([])),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    const result = await backend.answerPlanReview({
      projectPath: PROJECT,
      toolUseId: 'nonexistent-tu',
      approved: true,
      scope: SCOPE,
    });
    expect(result).toBe(false);
  });

  // ── Task 6: Chat MCP server + nudges wiring ───────────────────────────────

  it('(17) chat scope attaches mcpServers.sai from buildChatMcpServer + prepends nudges', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => { capturedOptions = args.options; return fakeQuery; });
    const fakeServer = { type: 'sdk', name: 'sai', instance: {} } as any;
    const buildChatMcpServer = vi.fn(() => fakeServer);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildChatMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((resolve) => { const check = () => { if (capturedOptions) resolve(); else setTimeout(check, 5); }; setTimeout(check, 5); });

    expect(buildChatMcpServer).toHaveBeenCalledWith(PROJECT);
    expect(capturedOptions.mcpServers).toEqual({ sai: fakeServer });
    const appended = (capturedOptions.systemPrompt && capturedOptions.systemPrompt.append) || '';
    expect(appended).toContain('render_html');
    expect(appended).toContain('sai_watch_github_run');

    fakeQuery.close();
  });

  it('(18) non-chat scope does not attach mcpServers', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => { capturedOptions = args.options; return fakeQuery; });
    const buildChatMcpServer = vi.fn(() => ({ type: 'sdk', name: 'sai', instance: {} } as any));
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildChatMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'orchestrator' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'bypass' });
    await new Promise<void>((resolve) => { const check = () => { if (capturedOptions) resolve(); else setTimeout(check, 5); }; setTimeout(check, 5); });

    expect(buildChatMcpServer).not.toHaveBeenCalled();
    expect(capturedOptions.mcpServers).toBeUndefined();

    // Verify chat nudges are also absent for non-chat scope
    const appended = (capturedOptions.systemPrompt && capturedOptions.systemPrompt.append) || '';
    expect(appended).not.toContain('render_html');

    fakeQuery.close();
  });

  // ── Task 1 Phase 4a: image forwarding ────────────────────────────────────

  it('(19) send forwards imagePaths as CLI-identical [Attached image: ...] refs', async () => {
    const pushed: any[] = [];
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      // Drain the async-iterable prompt to capture pushed user messages.
      (async () => { for await (const m of args.prompt) pushed.push(m); })();
      return fakeQuery;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'look', scope: SCOPE, permMode: 'default', imagePaths: ['/tmp/a.png', '/tmp/b.png'] });
    await new Promise<void>((r) => setTimeout(r, 20));

    const userMsg = pushed.find((m) => m?.type === 'user');
    expect(userMsg?.message?.content).toBe('[Attached image: /tmp/a.png]\n[Attached image: /tmp/b.png]\n\nlook');
    fakeQuery.close();
  });

  it('(21) start returns cached slash commands; drain caches slash_commands from system/init', async () => {
    mockReadCachedSlashCommands.mockReturnValue(['/clear', '/compact']);
    const initMsg = { type: 'system', subtype: 'init', slash_commands: ['/clear', '/compact', '/new'], session_id: 's1' };
    const fakeQuery = makeFakeQuery([initMsg], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    const ret = backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    expect(ret).toEqual({ slashCommands: ['/clear', '/compact'] });

    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(mockWriteCachedSlashCommands).toHaveBeenCalledWith(['/clear', '/compact', '/new']);
    fakeQuery.close();
  });

  it('(22) _sweepOnce suspends an idle non-streaming scope: emits scope_suspended, closes query, stashes sessionId, removes session', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 10));

    // Force the session idle and not streaming; set a known sessionId to verify stash.
    const key = `${PROJECT} ${SCOPE}`; // matches toScopeKey (space separator)
    const session: any = (backend as any).sessions.get(key);
    session.lastActivityAt = 1000;
    session.mapperState.streaming = false;
    session.awaitingInput = false;
    session.sessionId = 'sess-1';

    emits.length = 0;
    (backend as any)._sweepOnce(1000 + 31 * 60 * 1000); // 31 min later

    // (a) scope_suspended emitted
    expect(emits.find((e) => e.type === 'scope_suspended' && e.scope === SCOPE)).toBeTruthy();
    // (b) query.close() was called — SDK runtime freed
    expect(fakeQuery.closeSpy).toHaveBeenCalled();
    // (c) session removed from sessions map
    expect((backend as any).sessions.has(key)).toBe(false);
    // (d) sessionId stashed in pendingResume for next send
    expect((backend as any).pendingResume.get(key)).toBe('sess-1');
    // interrupt should NOT have been called (teardown is via close, not interrupt)
    expect(fakeQuery.interruptSpy).not.toHaveBeenCalled();
  });

  it('(23) chat scope merges user mcpConfigPath servers alongside sai', async () => {
    mockReadSaiSetting.mockReturnValue('/cfg/a.json');
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { foo: { type: 'stdio', command: 'foo' } } }) as any);
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const buildChatMcpServer = vi.fn(() => ({ type: 'sdk', name: 'sai', instance: {} } as any));
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildChatMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });
    expect(capturedOptions.mcpServers.foo).toEqual({ type: 'stdio', command: 'foo' });
    expect(capturedOptions.mcpServers.sai).toBeTruthy();
    fakeQuery.close();
    mockReadSaiSetting.mockReturnValue(undefined);
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('(20) compact runs SILENTLY: pushes /compact, forwards only system frames, no streaming_start/result/done', async () => {
    const pushed: any[] = [];
    // Scripted frames the runtime would produce for the compact turn.
    const fakeQuery = makeFakeQuery([
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 150000 } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Compacted.' }] } },
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ], { hang: true });
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      (async () => { for await (const m of args.prompt) pushed.push(m); })();
      return fakeQuery;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.compact({ projectPath: PROJECT, scope: SCOPE });
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(pushed.find((m) => m?.message?.content === '/compact')).toBeTruthy();
    // Silent: no turn boundary, no assistant chatter, no result/done.
    expect(emits.find((e) => e.type === 'streaming_start')).toBeUndefined();
    expect(emits.find((e) => e.type === 'assistant')).toBeUndefined();
    expect(emits.find((e) => e.type === 'result')).toBeUndefined();
    expect(emits.find((e) => e.type === 'done')).toBeUndefined();
    // System frames (compact notification) still pass through.
    expect(emits.find((e) => e.type === 'system' && e.subtype === 'compact_boundary')).toBeTruthy();

    // The result cleared the gate: a following send streams normally.
    emits.length = 0;
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(emits.find((e) => e.type === 'streaming_start')).toBeTruthy();
    fakeQuery.close();
  });

  // ── Task 7: Remote origin permission clamp ────────────────────────────────

  it('(24) remote origin clamps a bypass attempt down to the ceiling', async () => {
    mockGetRemoteCeiling.mockReturnValue('always-ask');
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'bypass', origin: 'remote' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });
    expect(capturedOptions.permissionMode).toBe('acceptEdits'); // clamped away from bypass
    fakeQuery.close();
  });

  it('(25) remote origin with null ceiling leaves bypass intact', async () => {
    mockGetRemoteCeiling.mockReturnValue(null);
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'bypass', origin: 'remote' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });
    expect(capturedOptions.permissionMode).toBe('bypassPermissions'); // no ceiling → unchanged
    fakeQuery.close();
  });

  it('(26) orchestrator scope attaches mcpServers.swarm + full orchestrator systemPrompt (plain string)', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const fakeSwarm = { type: 'sdk', name: 'swarm', instance: {} } as any;
    const buildSwarmMcpServer = vi.fn(() => fakeSwarm);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildSwarmMcpServer });
    backend.start({ projectPath: PROJECT, scope: 'orch', scopeCwd: PROJECT, kind: 'orchestrator', orchestratorContext: { defaultModel: 'opus', concurrencyCap: 3 } });
    backend.send({ projectPath: PROJECT, message: 'go', scope: 'orch', permMode: 'bypass' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });

    expect(buildSwarmMcpServer).toHaveBeenCalledWith(PROJECT);
    expect(capturedOptions.mcpServers).toEqual({ swarm: fakeSwarm });
    expect(typeof capturedOptions.systemPrompt).toBe('string'); // full replacement, not preset object
    expect(capturedOptions.systemPrompt.length).toBeGreaterThan(50); // the built orchestrator prompt
    expect(capturedOptions.tools).toEqual([]);
    expect(capturedOptions.permissionMode).toBe('bypassPermissions');
    fakeQuery.close();
  });

  it('(27) chat scope does not attach the swarm server', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const buildSwarmMcpServer = vi.fn(() => ({ type: 'sdk', name: 'swarm', instance: {} } as any));
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildSwarmMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });

    expect(buildSwarmMcpServer).not.toHaveBeenCalled();
    expect(capturedOptions.mcpServers?.swarm).toBeUndefined();
    fakeQuery.close();
  });

  // ── Interrupt-aware turnSeq protocol + parity emits ───────────────────────

  it('(28) send emits user_message with origin and the new turnSeq', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hello from phone', scope: SCOPE, permMode: 'default', origin: 'remote' });
    await new Promise(r => setTimeout(r, 10));

    const um = emits.find(e => e.type === 'user_message');
    expect(um).toBeDefined();
    expect(um!.text).toBe('hello from phone');
    expect(um!.origin).toBe('remote');
    expect(um!.turnSeq).toBe(1);
    fakeQuery.close();
  });

  it('(29) send mid-turn: pre-emptive done for the old turn; the old result is stamped with the OLD seq (stale-droppable)', async () => {
    // Query yields nothing until we push the old turn's result manually.
    let releaseResult: (() => void) | null = null;
    const resultGate = new Promise<void>((res) => { releaseResult = res; });
    async function* gen() {
      await resultGate;
      yield { type: 'result', stop_reason: 'end_turn', num_turns: 1 };
      await new Promise(() => {}); // hang
    }
    const iterator = gen();
    const fakeQuery: any = {
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]() { return iterator; },
    };
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });

    // Turn 1 starts and stays in flight (no result yet)
    backend.send({ projectPath: PROJECT, message: 'first', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));

    // Turn 2 sent mid-flight — CLI protocol: done(1) first, then streaming_start(2)
    backend.send({ projectPath: PROJECT, message: 'second', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));

    const preemptiveDone = emits.find(e => e.type === 'done');
    expect(preemptiveDone).toBeDefined();
    expect(preemptiveDone!.turnSeq).toBe(1);
    const starts = emits.filter(e => e.type === 'streaming_start');
    expect(starts.map(s => s.turnSeq)).toEqual([1, 2]);

    // Old turn's result finally drains — must be stamped with the OLD seq (1),
    // NOT the new activeTurnSeq (2), so the renderer's stale guard drops it.
    emits.length = 0;
    releaseResult!();
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'result')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });
    const staleResult = emits.find(e => e.type === 'result');
    expect(staleResult!.turnSeq).toBe(1);
    const staleDone = emits.find(e => e.type === 'done');
    expect(staleDone!.turnSeq).toBe(1);

    fakeQuery.close();
  });

  it('(30) result with terminal_reason background_requested carries wait.kind=background on result AND done', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1, terminal_reason: 'background_requested', background_tasks: [{}, {}] },
    ]);
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'done')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    const result = emits.find(e => e.type === 'result') as any;
    const done = emits.find(e => e.type === 'done') as any;
    expect(result.wait).toEqual({ kind: 'background', resumeInSeconds: null, taskCount: 2 });
    expect(done.wait).toEqual({ kind: 'background', resumeInSeconds: null, taskCount: 2 });
  });

  it('(31) ScheduleWakeup tool_use then completed result → wait.kind=scheduled and the sweep skips the scope', async () => {
    const fakeQuery = makeFakeQuery([
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tw1', name: 'ScheduleWakeup', input: { delaySeconds: 300 } }] },
      },
      { type: 'result', stop_reason: 'end_turn', num_turns: 1, terminal_reason: 'completed' },
    ], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'loop it', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'done')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    const done = emits.find(e => e.type === 'done') as any;
    expect(done.wait.kind).toBe('scheduled');
    expect(done.wait.resumeInSeconds).toBe(300);

    // Sweep far in the future of lastActivity but before the wakeup deadline:
    // the scope must NOT be suspended.
    const key = `${PROJECT} ${SCOPE}`;
    const session: any = (backend as any).sessions.get(key);
    session.lastActivityAt = 1000;
    session.wakeupDeadline = Date.now() + 300_000; // still pending
    emits.length = 0;
    // Way past the idle threshold but before the wakeup deadline → must skip.
    (backend as any)._sweepOnce(session.wakeupDeadline - 1);
    expect(emits.find(e => e.type === 'scope_suspended')).toBeUndefined();

    // Past the deadline (+grace already included) the sweep may reap it.
    (backend as any)._sweepOnce(session.wakeupDeadline + 1);
    expect(emits.find(e => e.type === 'scope_suspended')).toBeDefined();

    fakeQuery.close();
  });

  it('(32) interrupt emits done immediately, denies held approvals, and emits approval_resolved', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'work', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });

    // Hold an approval
    const gatePromise = capturedOptions.canUseTool('Bash', { command: 'rm -rf x' }, { toolUseID: 'tu-int', signal: new AbortController().signal });
    await new Promise(r => setTimeout(r, 5));
    expect(emits.find(e => e.type === 'approval_needed')).toBeDefined();

    emits.length = 0;
    backend.interrupt(PROJECT, SCOPE);

    // Held approval denied (query unblocked), card cleared, turn ended in the UI.
    const permResult = await gatePromise;
    expect(permResult.behavior).toBe('deny');
    expect(emits.find(e => e.type === 'approval_resolved')).toBeDefined();
    const done = emits.find(e => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.turnSeq).toBe(1);
    expect(fakeQuery.interruptSpy).toHaveBeenCalled();

    fakeQuery.close();
  });

  it('(32b) interrupt then send: the dead turn\'s late result is stamped with the OLD seq, not the new turn\'s', async () => {
    // Query yields nothing until we release the interrupted turn's result.
    let releaseResult: (() => void) | null = null;
    const resultGate = new Promise<void>((res) => { releaseResult = res; });
    async function* gen() {
      await resultGate;
      yield { type: 'result', stop_reason: 'end_turn', num_turns: 1 }; // late result of the interrupted turn
      await new Promise(() => {}); // hang
    }
    const iterator = gen();
    const fakeQuery: any = {
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]() { return iterator; },
    };
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });

    // Turn 1 in flight → user hits Stop → immediate done(1)
    backend.send({ projectPath: PROJECT, message: 'first', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));
    backend.interrupt(PROJECT, SCOPE);
    await new Promise(r => setTimeout(r, 10));
    expect(emits.filter(e => e.type === 'done').map(e => e.turnSeq)).toEqual([1]);

    // Follow-up send (bypass-send / queue drain) starts turn 2
    backend.send({ projectPath: PROJECT, message: 'second', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));
    const start2 = emits.filter(e => e.type === 'streaming_start').pop();
    expect(start2!.turnSeq).toBe(2);

    // The interrupted turn's result finally drains — it must carry seq 1
    // (stale-droppable), NOT seq 2, or the renderer would end the live turn
    // and the queue would drain into a still-running session.
    emits.length = 0;
    releaseResult!();
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'result')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });
    expect((emits.find(e => e.type === 'result') as any).turnSeq).toBe(1);
    expect((emits.find(e => e.type === 'done') as any).turnSeq).toBe(1);

    fakeQuery.close();
  });

  it('(32c) interrupt with NO live session still emits done(turnSeq=null) — Stop must always unstick the UI', async () => {
    const backend = new SdkBackend({ queryFn: vi.fn(), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    // No send ever happened (or the drain died and deleted the session):
    // the renderer may still believe the scope is streaming.
    backend.interrupt(PROJECT, SCOPE);
    const done = emits.find(e => e.type === 'done');
    expect(done).toBeDefined();
    // null is treated as "current" by the renderer's stale-turn guard — this
    // done can never be dropped.
    expect(done!.turnSeq).toBeNull();
    expect(done!.scope).toBe(SCOPE);
  });

  it('(32d) interrupt after the mapper saw the turn end still emits done — recovers a renderer that missed the turn-end', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ], { hang: true });
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'x', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'done')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    // Turn ended backend-side; a stranded renderer hits Stop anyway.
    emits.length = 0;
    backend.interrupt(PROJECT, SCOPE);
    const done = emits.find(e => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.turnSeq).toBe(1);

    fakeQuery.close();
  });

  it('(32e) send mid-turn then Stop: done is stamped with the NEW turnSeq, not the lagging activeTurnSeq', async () => {
    // Turn 1 stays in flight forever (its result never drains — worst case).
    const fakeQuery = makeFakeQuery([], { hang: true });
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });

    backend.send({ projectPath: PROJECT, message: 'first', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));
    // Chained send: turnSeq → 2, activeTurnSeq deliberately lags at 1.
    backend.send({ projectPath: PROJECT, message: 'second', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));

    emits.length = 0;
    backend.interrupt(PROJECT, SCOPE);
    const done = emits.find(e => e.type === 'done');
    expect(done).toBeDefined();
    // Renderer expects seq 2 (the last streaming_start). A done stamped with
    // the lagging seq 1 would be dropped as stale — Stop would do nothing.
    expect(done!.turnSeq).toBe(2);

    fakeQuery.close();
  });

  it('(32f) drain that ends mid-stream (runtime died without a result) emits a final done with the expected turnSeq', async () => {
    // One assistant frame arms streaming, then the stream just ENDS.
    async function* gen() {
      yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'partial…' }] } };
    }
    const iterator = gen();
    const fakeQuery: any = {
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]() { return iterator; },
    };
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'x', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'done')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    const done = emits.find(e => e.type === 'done');
    expect(done!.turnSeq).toBe(1);
    // Session torn down — nothing left for a follow-up Stop to find, which is
    // exactly why the done above must have been emitted.
    expect((backend as any).sessions.size).toBe(0);
  });

  it('(32g) drain crash after a chained send emits done with the CURRENT turnSeq, not the lagging activeTurnSeq', async () => {
    let releaseCrash: (() => void) | null = null;
    const crashGate = new Promise<void>((res) => { releaseCrash = res; });
    async function* gen(): AsyncGenerator<any> {
      await crashGate;
      throw new Error('runtime died');
    }
    const iterator = gen();
    const fakeQuery: any = {
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]() { return iterator; },
    };
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });

    backend.send({ projectPath: PROJECT, message: 'first', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));
    // Chained send leaves activeTurnSeq lagging at 1, renderer expects 2.
    backend.send({ projectPath: PROJECT, message: 'second', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));

    emits.length = 0;
    releaseCrash!();
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'error')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });
    const done = emits.find(e => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.turnSeq).toBe(2);
  });

  it('(32h) setSessionId on a streaming scope leaves the live query running (CLI parity: selecting a background-streaming chat must not kill its turn)', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working…' }] } },
    ], { hang: true });
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'x', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'assistant')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    emits.length = 0;
    backend.setSessionId(PROJECT, 'other-session', SCOPE);
    // Mirrors setSessionIdImpl (claude.ts): a streaming/busy scope is left
    // alone — no teardown, no synthetic done, the stream keeps flowing.
    expect(fakeQuery.closeSpy).not.toHaveBeenCalled();
    expect(emits.find(e => e.type === 'done')).toBeUndefined();
  });

  it('(32i) setSessionId on a scope awaiting tool approval leaves the gate and query intact', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let canUseTool: any;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      canUseTool = args.options.canUseTool;
      return fakeQuery;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'x', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => { const c = () => canUseTool ? r() : setTimeout(c, 5); setTimeout(c, 5); });

    // Hold a gate open (approval pending), then end the visible stream so the
    // scope is awaitingInput but not streaming.
    let resolved: any = null;
    void canUseTool('Bash', { command: 'ls' }, { tool_use_id: 'tu-1' }).then((r: any) => { resolved = r; });
    await new Promise(r => setTimeout(r, 10));

    emits.length = 0;
    backend.setSessionId(PROJECT, 'other-session', SCOPE);
    expect(fakeQuery.closeSpy).not.toHaveBeenCalled();
    expect(resolved).toBeNull(); // gate not deny-resolved by the select
    expect(emits.find(e => e.type === 'done')).toBeUndefined();
  });

  it('(33) session options carry the enriched spawn env and a stderr handler', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });

    expect(mockSpawnEnv).toHaveBeenCalled();
    expect(capturedOptions.env).toEqual({ PATH: '/enriched/bin', NODE_OPTIONS: '--max-old-space-size=1024' });
    expect(typeof capturedOptions.stderr).toBe('function');
    capturedOptions.stderr('not logged in\n');
    expect(emits.find(e => e.type === 'error' && String(e.text).includes('not logged in'))).toBeDefined();
    fakeQuery.close();
  });

  it('(34) drain crash emits error with fatal:true', async () => {
    async function* gen() { throw new Error('boom'); }
    const iterator = gen();
    const fakeQuery: any = {
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]() { return iterator; },
    };
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'x', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'error')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });
    const err = emits.find(e => e.type === 'error') as any;
    expect(err.fatal).toBe(true);
    expect(err.text).toContain('boom');
  });

  it('(36) send with a different model/effort/permMode recreates the session (resume-respawn, CLI parity)', async () => {
    const fakeQuery1 = makeFakeQuery([], { hang: true });
    const fakeQuery2 = makeFakeQuery([], { hang: true });
    let calls = 0;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedQueryArgs.push(args);
      calls++;
      return calls === 1 ? fakeQuery1 : fakeQuery2;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });

    backend.send({ projectPath: PROJECT, message: 'a', scope: SCOPE, permMode: 'default', model: 'model-a' });
    await new Promise(r => setTimeout(r, 10));
    // Same config → session reused, no new query
    backend.send({ projectPath: PROJECT, message: 'b', scope: SCOPE, permMode: 'default', model: 'model-a' });
    await new Promise(r => setTimeout(r, 10));
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Give the live session a session ID so the respawn can stash it for resume
    const key = `${PROJECT} ${SCOPE}`;
    ((backend as any).sessions.get(key) as any).sessionId = 'sess-model-a';

    // Changed model → old query closed, new query created with the new model + resume
    backend.send({ projectPath: PROJECT, message: 'c', scope: SCOPE, permMode: 'default', model: 'model-b' });
    await new Promise(r => setTimeout(r, 10));
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(fakeQuery1.closeSpy).toHaveBeenCalled();
    expect(capturedQueryArgs[1].options.model).toBe('model-b');
    expect(capturedQueryArgs[1].options.resume).toBe('sess-model-a');

    fakeQuery2.close();
  });

  it('(35) compact with no live session creates one on demand and pushes /compact', async () => {
    const pushed: any[] = [];
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      (async () => { for await (const m of args.prompt) pushed.push(m); })();
      return fakeQuery;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    // No send() first — mirrors the post-idle-sweep state.
    backend.compact({ projectPath: PROJECT, scope: SCOPE });
    await new Promise((r) => setTimeout(r, 20));

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(pushed.find((m) => m?.message?.content === '/compact')).toBeTruthy();
    fakeQuery.close();
  });

  it('(38) feature settings flow into SDK options and a settings change respawns the session', async () => {
    const settings: Record<string, unknown> = { claudeShowReasoning: true, claudeMaxBudgetUsd: 5, claude1MContext: true, claudeAgentProgressSummaries: false };
    mockReadSaiSetting.mockImplementation((key: string) => settings[key]);
    const fakeQuery1 = makeFakeQuery([], { hang: true });
    const fakeQuery2 = makeFakeQuery([], { hang: true });
    let calls = 0;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedQueryArgs.push(args);
      calls++;
      return calls === 1 ? fakeQuery1 : fakeQuery2;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'a', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));

    const opts = capturedQueryArgs[0].options;
    expect(opts.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(opts.maxBudgetUsd).toBe(5);
    expect(opts.betas).toEqual(['context-1m-2025-08-07']);
    expect(opts.promptSuggestions).toBe(true);
    expect(opts.agentProgressSummaries).toBeUndefined();

    // Toggling a feature setting respawns the session on the next send.
    settings.claudeShowReasoning = false;
    backend.send({ projectPath: PROJECT, message: 'b', scope: SCOPE, permMode: 'default' });
    await new Promise(r => setTimeout(r, 10));
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(capturedQueryArgs[1].options.thinking).toBeUndefined();

    mockReadSaiSetting.mockReset();
    mockReadSaiSetting.mockReturnValue(undefined);
    fakeQuery2.close();
  });

  it('(39) emits context_usage after a result when the query supports getContextUsage', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ], { hang: true });
    (fakeQuery as any).getContextUsage = vi.fn().mockResolvedValue({
      totalTokens: 42_000, maxTokens: 200_000, percentage: 21, model: 'opus',
      categories: [{ name: 'System prompt', tokens: 3000, color: '#abc' }],
    });
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (emits.some(e => e.type === 'context_usage')) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    const cu = emits.find(e => e.type === 'context_usage') as any;
    expect(cu.totalTokens).toBe(42_000);
    expect(cu.maxTokens).toBe(200_000);
    expect(cu.scope).toBe(SCOPE);
    fakeQuery.close();
  });

  it('(41) publishes rate-limit windows after a result when the runtime supports get_usage', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ], { hang: true });
    const rateLimits = {
      five_hour: { utilization: 34, resets_at: '2026-07-02T18:00:00Z' },
      seven_day: { utilization: 61, resets_at: '2026-07-06T00:00:00Z' },
      seven_day_opus: null,
    };
    (fakeQuery as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = vi.fn().mockResolvedValue({
      session: { total_cost_usd: 0.5 },
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: rateLimits,
    });
    const published: any[] = [];
    const backend = new SdkBackend({
      queryFn: vi.fn(() => fakeQuery),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
      publishUsage: (d) => published.push(d),
    });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE });
    await new Promise<void>((resolve) => {
      const check = () => { if (published.length > 0) resolve(); else setTimeout(check, 5); };
      setTimeout(check, 5);
    });

    expect(published[0]).toEqual(rateLimits);
    fakeQuery.close();
  });

  it('(42) does not publish usage when rate limits are unavailable, and throttles repeat fetches', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
      { type: 'result', stop_reason: 'end_turn', num_turns: 1 },
    ], { hang: true });
    const usageFn = vi.fn().mockResolvedValue({
      session: { total_cost_usd: 0 },
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null,
    });
    (fakeQuery as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = usageFn;
    const published: any[] = [];
    const backend = new SdkBackend({
      queryFn: vi.fn(() => fakeQuery),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
      publishUsage: (d) => published.push(d),
    });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE });
    await new Promise((r) => setTimeout(r, 30));

    // API-key session: fetched but never published; second result inside the
    // 30s window doesn't re-fetch.
    expect(usageFn).toHaveBeenCalledTimes(1);
    expect(published).toEqual([]);
    fakeQuery.close();
  });

  it('(40) commands_changed replaces the slash-command cache with slash-prefixed names', async () => {
    const fakeQuery = makeFakeQuery([
      { type: 'system', subtype: 'commands_changed', commands: [{ name: 'deploy', description: '' }, { name: 'lint', description: '' }] },
    ], { hang: true });
    const backend = new SdkBackend({ queryFn: vi.fn(() => fakeQuery), emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'go', scope: SCOPE });
    await new Promise(r => setTimeout(r, 20));
    expect(mockWriteCachedSlashCommands).toHaveBeenCalledWith(['/deploy', '/lint']);
    fakeQuery.close();
  });

  it('(37) send with a readable png attaches a real base64 image content block', async () => {
    mockReadFileSync.mockReturnValueOnce(Buffer.from('fake-png-bytes') as any);
    const pushed: any[] = [];
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      (async () => { for await (const m of args.prompt) pushed.push(m); })();
      return fakeQuery;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'look', scope: SCOPE, permMode: 'default', imagePaths: ['/tmp/shot.png'] });
    await new Promise((r) => setTimeout(r, 20));

    const userMsg = pushed.find((m) => m?.type === 'user');
    expect(Array.isArray(userMsg.message.content)).toBe(true);
    expect(userMsg.message.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from('fake-png-bytes').toString('base64') },
    });
    expect(userMsg.message.content[1]).toEqual({ type: 'text', text: 'look' });
    fakeQuery.close();
  });

  it('(41) start and send register the workspace as active in the registry', async () => {
    mockGetOrCreateWorkspace.mockClear();
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });

    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    expect(mockGetOrCreateWorkspace).toHaveBeenCalledWith(PROJECT);

    mockGetOrCreateWorkspace.mockClear();
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    expect(mockGetOrCreateWorkspace).toHaveBeenCalledWith(PROJECT);
    fakeQuery.close();
  });

  it('(42) suspendWorkspace closes every session for the workspace, stashes resume ids, and leaves other workspaces alone', async () => {
    const q1 = makeFakeQuery([], { hang: true });
    const q2 = makeFakeQuery([], { hang: true });
    const queries = [q1, q2];
    const queryFn = vi.fn(() => queries.shift()!);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    backend.send({ projectPath: '/other/project', message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 10));

    const key = `${PROJECT} ${SCOPE}`;
    const session: any = (backend as any).sessions.get(key);
    session.sessionId = 'sess-42';

    emits.length = 0;
    backend.suspendWorkspace(PROJECT);

    // The streaming turn is ended in the UI, the query closed, the session removed.
    expect(emits.find((e) => e.type === 'done' && e.projectPath === PROJECT)).toBeTruthy();
    expect(q1.closeSpy).toHaveBeenCalled();
    expect((backend as any).sessions.has(key)).toBe(false);
    expect((backend as any).pendingResume.get(key)).toBe('sess-42');

    // The other workspace's session is untouched.
    expect(q2.closeSpy).not.toHaveBeenCalled();
    expect((backend as any).sessions.has(`/other/project ${SCOPE}`)).toBe(true);
    q2.close();
  });

  it('(43) isWorkspaceBusy reflects streaming / awaiting-input / pending-wakeup sessions', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 10));

    const session: any = (backend as any).sessions.get(`${PROJECT} ${SCOPE}`);
    session.mapperState.streaming = true;
    expect(backend.isWorkspaceBusy(PROJECT)).toBe(true);
    expect(backend.isWorkspaceBusy('/other/project')).toBe(false);

    session.mapperState.streaming = false;
    session.awaitingInput = false;
    session.pendingWakeup = false;
    expect(backend.isWorkspaceBusy(PROJECT)).toBe(false);

    session.awaitingInput = true;
    expect(backend.isWorkspaceBusy(PROJECT)).toBe(true);

    session.awaitingInput = false;
    session.pendingWakeup = true;
    session.wakeupDeadline = null;
    expect(backend.isWorkspaceBusy(PROJECT)).toBe(true);
    session.wakeupDeadline = Date.now() - 1000; // expired wakeup no longer defers
    expect(backend.isWorkspaceBusy(PROJECT)).toBe(false);

    fakeQuery.close();
  });

  // ── Completion notification gating: only chat-kind scopes are a "turn end"
  //    for the user — task/orchestrator results must not fire the OS
  //    completion notification (tasks have their own opt-in path in App.tsx).

  function makeNotifySpy() {
    return {
      approval: vi.fn(),
      question: vi.fn(),
      planReview: vi.fn(),
      completion: vi.fn(),
    };
  }

  async function runTurnWithKind(kind: 'chat' | 'task' | 'orchestrator', scope: string) {
    const notify = makeNotifySpy();
    const fakeQuery = makeFakeQuery([
      { type: 'result', stop_reason: 'end_turn', num_turns: 1, duration_ms: 100 },
    ]);
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
      notify,
    });
    backend.start({ projectPath: PROJECT, scope, scopeCwd: PROJECT, kind });
    await collectUntilDone(backend, emits, { projectPath: PROJECT, message: 'go', scope, permMode: 'bypass' });
    // completion is scheduled with a 500ms setTimeout — wait past it.
    await new Promise((r) => setTimeout(r, 600));
    return notify;
  }

  it('(44) chat-kind result fires the completion notification', async () => {
    const notify = await runTurnWithKind('chat', 'chat');
    expect(notify.completion).toHaveBeenCalledTimes(1);
  });

  it('(45) task-kind result does NOT fire the completion notification', async () => {
    const notify = await runTurnWithKind('task', 'swarm-task-1');
    expect(notify.completion).not.toHaveBeenCalled();
  });

  it('(46) orchestrator result does NOT fire the completion notification', async () => {
    const notify = await runTurnWithKind('orchestrator', 'orchestrator-1');
    expect(notify.completion).not.toHaveBeenCalled();
  });

  // ── Stop-hook background_tasks: the runtime's own in-flight task ledger is
  //    the authoritative "paused waiting" signal. Repro from a live transcript
  //    (otto, 2026-07-05): an Agent tool_use with NO run_in_background flag was
  //    async-launched by the runtime; the turn's result was terminal_reason
  //    'completed' with nothing for the input sniff to see, so the turn
  //    classified 'none' — pill dropped, notify fired — while the reviewer
  //    subagent was still running.

  /** Run one turn where the Stop hook (captured from queryFn options) fires
   *  with the given background_tasks payload just before the result frame. */
  async function runTurnWithStopHook(backgroundTasks: unknown, frames?: any[]) {
    const notify = makeNotifySpy();
    let capturedOptions: any = null;

    const defaultFrames = [
      // Agent launch WITHOUT run_in_background — the input sniff must miss it.
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Agent', input: { description: 'Review Task 4', prompt: 'review it' } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: abc123' }] }] } },
      { type: 'result', stop_reason: 'end_turn', terminal_reason: 'completed', num_turns: 1, duration_ms: 100 },
    ];
    const pending = frames ?? defaultFrames;

    async function* gen() {
      for (const msg of pending) {
        if (msg.type === 'result') {
          // The runtime runs Stop hooks when the model stops, before the final
          // result frame is emitted — mirror that ordering.
          const stopHooks = capturedOptions?.hooks?.Stop?.flatMap((m: any) => m.hooks) ?? [];
          for (const h of stopHooks) {
            await h(
              { hook_event_name: 'Stop', stop_hook_active: false, ...(backgroundTasks !== undefined ? { background_tasks: backgroundTasks } : {}) },
              undefined,
              { signal: new AbortController().signal },
            );
          }
        }
        yield msg;
      }
    }
    const iterator = gen();
    const fakeQuery: any = {
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      [Symbol.asyncIterator]() { return iterator; },
    };

    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      capturedOptions = args.options;
      return fakeQuery;
    });
    const backend = new SdkBackend({
      queryFn,
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
      notify,
    });
    await collectUntilDone(backend, emits, { projectPath: PROJECT, message: 'go', scope: SCOPE, permMode: 'bypass' });
    await new Promise((r) => setTimeout(r, 600)); // past the 500ms notify delay
    return { notify, emits };
  }

  it('(47) Stop-hook in-flight tasks classify the turn as a background wait (launch flag never set)', async () => {
    const { notify } = await runTurnWithStopHook([
      { id: 'afdba032ce2118862', type: 'subagent', status: 'running', description: 'Review Task 4 (spec + quality)' },
    ]);
    const done = emits.find(e => e.type === 'done') as any;
    expect(done.wait?.kind).toBe('background');
    expect(done.wait?.taskCount).toBe(1);
    // Waits stay silent — no turn-end notification while the reviewer runs.
    expect(notify.completion).not.toHaveBeenCalled();
  });

  it('(48) Stop-hook empty background_tasks is a real end — the authoritative zero overrides the launch sniff', async () => {
    // The async-launch tool_result IS in the frames, but the ledger says the
    // launched task already finished before the turn ended.
    const { notify } = await runTurnWithStopHook([]);
    const done = emits.find(e => e.type === 'done') as any;
    expect(done.wait?.kind ?? 'none').toBe('none');
    expect(notify.completion).toHaveBeenCalledTimes(1);
  });

  it('(49) no Stop-hook ledger: the async-launch tool_result sniff still classifies a background wait', async () => {
    // Older runtime: hook input carries no background_tasks field at all, but
    // the Agent launch came back "Async agent launched successfully."
    const { notify } = await runTurnWithStopHook(undefined);
    const done = emits.find(e => e.type === 'done') as any;
    expect(done.wait?.kind).toBe('background');
    expect(notify.completion).not.toHaveBeenCalled();
  });

  it('(49b) no Stop-hook ledger and no launches is a real end', async () => {
    const { notify } = await runTurnWithStopHook(undefined, [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'all done' }] } },
      { type: 'result', stop_reason: 'end_turn', terminal_reason: 'completed', num_turns: 1, duration_ms: 50 },
    ]);
    const done = emits.find(e => e.type === 'done') as any;
    expect(done.wait?.kind ?? 'none').toBe('none');
    expect(notify.completion).toHaveBeenCalledTimes(1);
  });

  it('(50) resume turn that launches nothing still waits while tasks remain in flight', async () => {
    // Models the "Task 4 done; reviewer running." turn: woken by a task
    // notification, launches nothing, ends completed — but one task remains.
    const { notify } = await runTurnWithStopHook(
      [{ id: 't-rev', type: 'subagent', status: 'running', description: 'reviewer' }],
      [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Task 4 done; reviewer running.' }] } },
        { type: 'result', stop_reason: 'end_turn', terminal_reason: 'completed', num_turns: 1, duration_ms: 50 },
      ],
    );
    const done = emits.find(e => e.type === 'done') as any;
    expect(done.wait?.kind).toBe('background');
    expect(notify.completion).not.toHaveBeenCalled();
  });
});
