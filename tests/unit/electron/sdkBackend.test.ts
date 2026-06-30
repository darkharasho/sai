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
 */
function makeFakeQuery(messages: any[]): FakeQuery {
  const interruptSpy = vi.fn().mockResolvedValue(undefined);
  const closeSpy = vi.fn();

  let resolve: (() => void) | null = null;
  let closed = false;
  const pending: any[] = [...messages];

  async function* gen() {
    for (const msg of pending) {
      if (closed) return;
      yield msg;
    }
  }

  const iterator = gen();

  const fakeQuery: FakeQuery = {
    interruptSpy,
    closeSpy,
    interrupt: interruptSpy,
    close: closeSpy,
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
    // Make a query that never yields (hangs until closed)
    const fakeQuery = makeFakeQuery([]);
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
    const fakeQuery = makeFakeQuery([]);
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
});
