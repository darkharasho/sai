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
} = vi.hoisted(() => ({
  mockApproveImpl: vi.fn().mockResolvedValue(true),
  mockAnswerQuestionImpl: vi.fn().mockResolvedValue(true),
  mockAnswerPlanReviewImpl: vi.fn().mockResolvedValue(true),
  mockAlwaysAllowImpl: vi.fn().mockResolvedValue(true),
  mockGenerateCommitMessageImpl: vi.fn().mockResolvedValue('msg'),
  mockGenerateTitleImpl: vi.fn().mockResolvedValue('title'),
  mockGetAvailableClaudeModels: vi.fn().mockReturnValue({ models: [], detected: false }),
}));

vi.mock('../../../electron/services/claude', () => ({
  approveImpl: mockApproveImpl,
  answerQuestionImpl: mockAnswerQuestionImpl,
  answerPlanReviewImpl: mockAnswerPlanReviewImpl,
  alwaysAllowImpl: mockAlwaysAllowImpl,
  generateCommitMessageImpl: mockGenerateCommitMessageImpl,
  generateTitleImpl: mockGenerateTitleImpl,
  getAvailableClaudeModels: mockGetAvailableClaudeModels,
}));

// Import after mocks are set up
import { SdkBackend } from '../../../electron/services/claudeBackend/sdkBackend';

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
    expect(approvalEmit!.command).toBeUndefined();

    const approveResult = await backend.approve({ projectPath: PROJECT, toolUseId: 'tu2', approved: false, scope: SCOPE });
    expect(approveResult).toBe(true);

    const permResult = await resultPromise;
    expect(permResult).toEqual({ behavior: 'deny', message: 'User denied tool use' });

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

  it('(12) approve returns false when toolUseId not found in pendingApprovals', async () => {
    const backend = new SdkBackend({
      queryFn: vi.fn(() => makeFakeQuery([])),
      emit: (p) => emits.push(p),
      resolveClaudePath: () => undefined,
    });

    const result = await backend.approve({ projectPath: PROJECT, toolUseId: 'nonexistent', approved: true, scope: SCOPE });
    expect(result).toBe(false);
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

  it('(13) AskUserQuestion tool_use in assistant message emits question_needed; answerQuestion emits question_answered + pushes follow-up input', async () => {
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

    backend.send({ projectPath: PROJECT, message: 'start', scope: SCOPE });

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

  it('(14) ExitPlanMode tool_use in assistant message emits plan_review_needed; answerPlanReview(approved=true) emits plan_review_answered + pushes follow-up input', async () => {
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

    backend.send({ projectPath: PROJECT, message: 'start', scope: SCOPE });

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
});
