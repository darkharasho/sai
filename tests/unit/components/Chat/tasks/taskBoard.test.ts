import { describe, it, expect } from 'vitest';
import { deriveTaskBoard, agentToolUseIds, type BoardRuntime } from '../../../../../src/components/Chat/tasks/taskBoard';
import type { ChatMessage, ToolCall } from '../../../../../src/types';
import type { BackgroundTaskDetail } from '../../../../../electron/services/claudeBackend/backgroundTasks';

let n = 0;
const call = (input: unknown, name = 'sai_task', id?: string): ToolCall => ({
  id, type: 'mcp', name, input: typeof input === 'string' ? input : JSON.stringify(input),
});
const msg = (calls: ToolCall[], ts: number): ChatMessage => ({
  id: `m${++n}`, role: 'assistant', content: '', timestamp: ts, toolCalls: calls,
});
const create = (tasks: any[]) => call({ action: 'create', tasks });
const upd = (o: any) => call({ action: 'update', ...o });
const agentCall = (description: string, id: string) => call({ description, prompt: 'p' }, 'Agent', id);

const bg = (over: Partial<BackgroundTaskDetail>): BackgroundTaskDetail => ({
  id: 't1', description: 'd', kind: 'Explore', isShell: false, isAgent: true, status: 'running',
  startedAt: 0, endedAt: null, lastEventAt: 0, totalTokens: null, toolUses: null,
  lastToolName: null, summary: null, error: null, toolUseId: null, ...over,
});

const rt = (over: Partial<BoardRuntime> = {}): BoardRuntime => ({
  backgroundTasks: [], isStreaming: true, pendingQuestion: null, pendingApprovalToolUseId: null, agentInfo: new Map(), ...over,
});

describe('deriveTaskBoard', () => {
  it('agent card follows runtime status over model claim', () => {
    const messages = [
      msg([create([{ id: 'a', title: 'Research', steps: [] }])], 1),
      msg([upd({ id: 'a', status: 'running', agent: 'Research auth' })], 2),
      msg([agentCall('Research auth', 'toolu_A')], 3),
    ];
    const board = deriveTaskBoard(messages, rt({
      backgroundTasks: [bg({ id: 't1', description: 'Research auth', status: 'completed', endedAt: 9, summary: 'found it', toolUseId: 'toolu_A' })],
    }));
    expect(board.cards).toHaveLength(1);
    const c = board.cards[0];
    expect(c.status).toBe('done');
    expect(c.agent).toEqual({ description: 'Research auth', toolUseId: 'toolu_A', taskId: 't1' });
    expect(board.allDone).toBe(true);
    expect(agentToolUseIds(board)).toEqual(['toolu_A']);
  });

  it('agent card done from transcript finished flag when no live detail', () => {
    const messages = [
      msg([create([{ id: 'a', title: 'Research', steps: [] }])], 1),
      msg([upd({ id: 'a', status: 'running', agent: 'Research auth' })], 2),
      msg([agentCall('Research auth', 'toolu_A')], 3),
    ];
    const done = deriveTaskBoard(messages, rt({ agentInfo: new Map([['toolu_A', { finished: true }]]) }));
    expect(done.cards[0].status).toBe('done');

    const paused = deriveTaskBoard(messages, rt({ isStreaming: false, agentInfo: new Map([['toolu_A', { finished: false }]]) }));
    expect(paused.cards[0].status).toBe('paused');
    expect(paused.cards[0].result).toBeNull();
  });

  it('agent card with no detail and unfinished transcript is running while streaming, paused otherwise', () => {
    const messages = [
      msg([create([{ id: 'a', title: 'Research', steps: [] }])], 1),
      msg([upd({ id: 'a', status: 'running', agent: 'Research auth' })], 2),
      msg([agentCall('Research auth', 'toolu_A')], 3),
    ];
    expect(deriveTaskBoard(messages, rt({ isStreaming: true })).cards[0].status).toBe('running');
    expect(deriveTaskBoard(messages, rt({ isStreaming: false })).cards[0].status).toBe('paused');
  });

  it('agent call matches a background task without tool_use_id by description', () => {
    const messages = [
      msg([create([{ id: 'a', title: 'Research', steps: [] }])], 1),
      msg([upd({ id: 'a', status: 'running', agent: 'Research auth' })], 2),
      msg([agentCall('Research auth', 'toolu_A')], 3),
    ];
    const board = deriveTaskBoard(messages, rt({
      isStreaming: false,
      backgroundTasks: [
        bg({ id: 'h', description: 'Research auth', hidden: true }),
        bg({ id: 'other', description: 'Research auth', toolUseId: 'toolu_OTHER', startedAt: 1 }),
        bg({ id: 't1', description: 'Research auth', status: 'completed', toolUseId: null }),
      ],
    }));
    const declared = board.cards.filter((c) => c.source === 'declared');
    expect(declared).toHaveLength(1);
    expect(declared[0].status).toBe('done');
    expect(declared[0].agent).toEqual({ description: 'Research auth', toolUseId: 'toolu_A', taskId: 't1' });
    expect(board.cards.map((c) => c.id)).toEqual(['a', 'bg:other']); // no duplicate bg:t1, hidden never shown
  });

  it('failed and stopped background tasks map to failed with result', () => {
    const mk = (status: 'failed' | 'stopped') => {
      const messages = [
        msg([create([{ id: 'a', title: 'R', steps: [] }])], 1),
        msg([upd({ id: 'a', status: 'running', agent: 'R' })], 2),
        msg([agentCall('R', 'toolu_R')], 3),
      ];
      return deriveTaskBoard(messages, rt({
        backgroundTasks: [bg({ id: 't', description: 'R', status, error: status === 'failed' ? 'boom' : null, toolUseId: 'toolu_R', endedAt: 7 })],
      })).cards[0];
    };
    expect(mk('failed')).toMatchObject({ status: 'failed', result: 'boom', endedAt: 7 });
    expect(mk('stopped')).toMatchObject({ status: 'failed', result: 'Stopped' });

    const rtCard = deriveTaskBoard([], rt({ backgroundTasks: [bg({ id: 's', status: 'stopped' }), bg({ id: 'f', status: 'failed', error: 'nope' })] })).cards;
    expect(rtCard.find((c) => c.id === 'bg:s')).toMatchObject({ status: 'failed', result: 'Stopped' });
    expect(rtCard.find((c) => c.id === 'bg:f')).toMatchObject({ status: 'failed', result: 'nope' });
  });

  it('runtime cards are sorted by startedAt after declared cards', () => {
    const messages = [msg([create([{ id: 'a', title: 'A', steps: [] }])], 1)];
    const board = deriveTaskBoard(messages, rt({
      backgroundTasks: [bg({ id: 'late', startedAt: 30 }), bg({ id: 'early', startedAt: 10 }), bg({ id: 'mid', startedAt: 20 })],
    }));
    expect(board.cards.map((c) => c.id)).toEqual(['a', 'bg:early', 'bg:mid', 'bg:late']);
  });

  it('running inline card is paused when not streaming', () => {
    const messages = [
      msg([create([{ id: 'a', title: 'Edit', steps: ['one', 'two'] }])], 1),
      msg([upd({ id: 'a', status: 'running' })], 2),
    ];
    expect(deriveTaskBoard(messages, rt({ isStreaming: true })).cards[0].status).toBe('running');
    const board = deriveTaskBoard(messages, rt({ isStreaming: false }));
    expect(board.cards[0].status).toBe('paused');
    expect(board.allDone).toBe(false);
  });

  describe('waiting follows the tag of the pending tool call', () => {
    const ask = (id: string) => call({ questions: [{ question: 'Which db?', options: [] }] }, 'AskUserQuestion', id);
    const q = { toolUseId: 'toolu_Q', text: 'Which db?', options: ['pg', 'sqlite'] };
    const history = () => [
      msg([create([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])], 1),
      msg([upd({ id: 'a', status: 'running' })], 2),
      msg([ask('toolu_Q')], 3),
      msg([upd({ id: 'b', status: 'running' })], 4),
      msg([call({ command: 'rm -rf build' }, 'Bash', 'toolu_P')], 5),
    ];

    it('a pending question marks the card its call is tagged to, not the active one', () => {
      const board = deriveTaskBoard(history(), rt({ isStreaming: false, pendingQuestion: q }));
      const a = board.cards.find((c) => c.id === 'a')!;
      expect(a.status).toBe('waiting');
      expect(a.question).toEqual({ text: 'Which db?', options: ['pg', 'sqlite'] });
      expect(board.cards.find((c) => c.id === 'b')!).toMatchObject({ status: 'paused', question: null });
    });

    it('a pending approval marks the card its call is tagged to', () => {
      const board = deriveTaskBoard(history(), rt({ isStreaming: false, pendingApprovalToolUseId: 'toolu_P' }));
      expect(board.cards.find((c) => c.id === 'b')!).toMatchObject({ status: 'waiting', question: null });
      expect(board.cards.find((c) => c.id === 'a')!.status).toBe('paused');
    });

    it('a stored tag on the pending call wins', () => {
      const messages = history();
      messages[2] = { ...messages[2], toolCalls: [{ ...messages[2].toolCalls![0], taskId: null }] };
      const board = deriveTaskBoard(messages, rt({ isStreaming: false, pendingQuestion: q }));
      expect(board.cards.some((c) => c.status === 'waiting')).toBe(false);
    });

    it('an untagged pending call marks nothing', () => {
      const messages = [msg([create([{ id: 'a', title: 'A' }])], 1), msg([ask('toolu_Q')], 2)];
      const board = deriveTaskBoard(messages, rt({ pendingQuestion: q }));
      expect(board.cards[0]).toMatchObject({ status: 'queued', question: null });
    });
  });

  it('declared cards carry their batch-scoped tag; runtime cards their id; now starts null', () => {
    const board = deriveTaskBoard([msg([create([{ id: 'a', title: 'A' }])], 7)], rt({ backgroundTasks: [bg({ id: 'r' })] }));
    expect(board.cards.map((c) => [c.tag, c.now])).toEqual([['7:a', null], ['bg:r', null]]);
    expect(board.cards[0]).not.toHaveProperty('steps');
  });

  it('unmatched agent string yields declared card plus runtime card', () => {
    const messages = [
      msg([create([{ id: 'a', title: 'A', steps: [] }])], 1),
      msg([upd({ id: 'a', status: 'running', agent: 'X' })], 2),
    ];
    const board = deriveTaskBoard(messages, rt({
      isStreaming: false,
      backgroundTasks: [bg({ id: 't9', description: 'Y', startedAt: 5, toolUseId: 'toolu_Y' })],
    }));
    expect(board.cards).toHaveLength(2);
    const [declared, runtime] = board.cards;
    expect(declared.source).toBe('declared');
    expect(declared.agent?.toolUseId ?? null).toBeNull();
    expect(declared.status).toBe('paused'); // treated as inline
    expect(runtime).toMatchObject({
      id: 'bg:t9', source: 'runtime', title: 'Y', status: 'running',
      agent: { description: 'Y', toolUseId: 'toolu_Y', taskId: 't9' },
    });
  });

  it('fallback card from TodoWrite when no sai_task calls', () => {
    const todos = [
      { id: '1', content: 'Write tests', status: 'completed' },
      { id: '2', content: 'Implement', activeForm: 'Implementing', status: 'in_progress' },
      { id: '3', content: 'Ship', status: 'pending' },
    ];
    const messages = [msg([call({ todos }, 'TodoWrite')], 1)];
    const board = deriveTaskBoard(messages, rt());
    expect(board.cards).toHaveLength(1);
    const c = board.cards[0];
    expect(c).toMatchObject({ id: 'current-work', tag: 'current-work', source: 'fallback', title: 'Current work', status: 'running', now: null });
    expect(c).not.toHaveProperty('steps');
    expect(deriveTaskBoard(messages, rt({ isStreaming: false })).cards[0].status).toBe('paused');

    const allDone = deriveTaskBoard([msg([call({ todos: todos.map((t) => ({ ...t, status: 'completed' })) }, 'TodoWrite')], 1)], rt());
    expect(allDone.cards[0].status).toBe('done');
    expect(allDone.allDone).toBe(true);
  });

  it('no cards and no rail data when chat has neither', () => {
    const board = deriveTaskBoard([msg([call({ command: 'ls' }, 'Bash')], 1)], rt());
    expect(board.cards.length).toBe(0);
    expect(board.allDone).toBe(false);
    expect(agentToolUseIds(board)).toEqual([]);
  });

  it('hidden background tasks never become cards', () => {
    const board = deriveTaskBoard([], rt({ backgroundTasks: [bg({ id: 'h', hidden: true })] }));
    expect(board.cards).toHaveLength(0);
  });

  it('never throws on malformed data', () => {
    const junk = [null, { role: 'assistant', toolCalls: [{ name: 'Agent', input: 5 }, null] }] as any;
    expect(() => deriveTaskBoard(junk, rt({ backgroundTasks: [null as any, bg({ description: 7 as any })] }))).not.toThrow();
    expect(() => deriveTaskBoard(junk, null as any)).not.toThrow();
  });
  describe('agent description drift fallback', () => {
    const declare = (ts = 1) => [
      msg([create([{ id: 'a', title: 'List', steps: [] }])], ts),
      msg([upd({ id: 'a', status: 'running', agent: 'List tasks directory files' })], ts + 1),
    ];

    it('declared agent binds to a differently-described Agent call in the same batch, with no duplicate runtime card', () => {
      const messages = [...declare(), msg([agentCall('List files in the tasks directory', 'toolu_X')], 3)];
      const board = deriveTaskBoard(messages, rt({
        backgroundTasks: [bg({ id: 't9', description: 'List files in the tasks directory', toolUseId: 'toolu_X' })],
      }));
      expect(board.cards).toHaveLength(1);
      expect(board.cards[0].agent).toEqual({ description: 'List tasks directory files', toolUseId: 'toolu_X', taskId: 't9' });
    });

    it('fallback never steals an Agent call whose description exactly matches another declared card', () => {
      // Two calls carry card b's exact description; the exact map keeps the
      // latest, so the earlier one is only protected by the declaredDescs guard.
      const messages = [
        msg([create([{ id: 'a', title: 'A', steps: [] }, { id: 'b', title: 'B', steps: [] }])], 1),
        msg([upd({ id: 'a', status: 'running', agent: 'Drifted name' })], 2),
        msg([upd({ id: 'b', status: 'running', agent: 'Exact name' })], 3),
        msg([agentCall('Exact name', 'toolu_B1')], 4),
        msg([agentCall('Exact name', 'toolu_B2')], 5),
      ];
      const board = deriveTaskBoard(messages, rt());
      const byId = (id: string) => board.cards.find((c) => c.id === id)!;
      expect(byId('b').agent!.toolUseId).toBe('toolu_B2');
      expect(byId('a').agent!.toolUseId).toBeNull();
    });

    it('fallback is skipped when batchStartedAt is null', () => {
      const messages = [
        { ...declare()[0], timestamp: null as any },
        declare()[1],
        msg([agentCall('Different', 'toolu_X')], 3),
      ];
      const board = deriveTaskBoard(messages, rt());
      expect(board.batchStartedAt).toBeNull();
      expect(board.cards[0].agent!.toolUseId).toBeNull();
    });

    it('two drifting cards bind to in-batch calls in declaration order', () => {
      const messages = [
        msg([create([{ id: 'a', title: 'A', steps: [] }, { id: 'c', title: 'C', steps: [] }])], 1),
        msg([upd({ id: 'a', status: 'running', agent: 'Drift one' })], 2),
        msg([upd({ id: 'c', status: 'running', agent: 'Drift two' })], 3),
        msg([agentCall('Actual one', 'toolu_X')], 4),
        msg([agentCall('Actual two', 'toolu_Y')], 5),
      ];
      const board = deriveTaskBoard(messages, rt());
      expect(board.cards.map((c) => c.agent!.toolUseId)).toEqual(['toolu_X', 'toolu_Y']);
    });

    it('fallback ignores Agent calls from before the batch started', () => {
      const messages = [msg([agentCall('Something older', 'toolu_OLD')], 1), ...declare(5)];
      const board = deriveTaskBoard(messages, rt());
      expect(board.cards[0].agent!.toolUseId).toBeNull();
    });
  });

  describe('fallback card staleness', () => {
    const todos = [
      { id: '1', content: 'Write tests', status: 'completed' },
      { id: '2', content: 'Implement', status: 'in_progress' },
    ];
    const userMsg = (ts: number): ChatMessage => ({ id: `u${++n}`, role: 'user', content: 'hi', timestamp: ts });
    const old = () => [userMsg(0), msg([call({ todos }, 'TodoWrite')], 1), userMsg(2), msg([call({ command: 'ls' }, 'Bash')], 3)];

    it('old todo history + newer user message + not streaming → no card', () => {
      expect(deriveTaskBoard(old(), rt({ isStreaming: false })).cards).toHaveLength(0);
    });

    it('streaming keeps the card', () => {
      expect(deriveTaskBoard(old(), rt({ isStreaming: true })).cards.map((c) => c.id)).toEqual(['current-work']);
    });

    it('todos in the latest user turn show while not streaming', () => {
      const messages = [userMsg(0), msg([call({ todos }, 'TodoWrite')], 1)];
      expect(deriveTaskBoard(messages, rt({ isStreaming: false })).cards[0]).toMatchObject({ id: 'current-work', status: 'paused' });
    });

    it('all todos complete and not streaming → no card', () => {
      const done = todos.map((t) => ({ ...t, status: 'completed' }));
      expect(deriveTaskBoard([userMsg(0), msg([call({ todos: done }, 'TodoWrite')], 1)], rt({ isStreaming: false })).cards).toHaveLength(0);
    });
  });

});
