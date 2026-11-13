// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskBoard } from '../../../../../src/components/Chat/tasks/useTaskBoard';
import type { BackgroundTaskDetail } from '../../../../../electron/services/claudeBackend/backgroundTasks';

const task = (over: Partial<BackgroundTaskDetail>): BackgroundTaskDetail => ({
  id: 'bg1', description: 'work', kind: 'task', isShell: false, isAgent: true,
  status: 'running', startedAt: 0, endedAt: null, lastEventAt: 0,
  totalTokens: null, toolUses: null, lastToolName: null, summary: null, error: null, toolUseId: null,
  ...over,
});

let fetchFn: ReturnType<typeof vi.fn>;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  fetchFn = vi.fn().mockResolvedValue(null);
  (window as any).sai = { claudeSubagentTranscript: fetchFn };
});
afterEach(() => { vi.restoreAllMocks(); });

const boardOf = (tasks: BackgroundTaskDetail[], isStreaming = true) =>
  renderHook(() => useTaskBoard({
    enabled: true, messages: [], claudeSessionId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    backgroundTasks: tasks, isStreaming, awaitingQuestion: false, pendingApprovalToolUseId: null,
  }));

describe('useTaskBoard streamFallback', () => {
  it('reports a shell task, carrying its detail', async () => {
    const { result } = boardOf([task({ id: 'bg1', kind: 'shell', isShell: true, description: 'npm test' })]);
    await flush();
    const card = result.current.board.cards[0];
    expect(card.id).toBe('bg:bg1');
    expect(result.current.feed(card)).toBeNull();
    expect(result.current.streamFallback(card)).toMatchObject({ reason: 'shell', detail: { id: 'bg1' } });
  });

  it('reports a non-shell task with no Agent tool_use id as no-agent', async () => {
    const { result } = boardOf([task({ id: 'bg2', kind: 'review-changes', toolUseId: null })]);
    await flush();
    const card = result.current.board.cards[0];
    expect(result.current.streamFallback(card)).toMatchObject({ reason: 'no-agent', detail: { id: 'bg2' } });
  });

  it('reports an agent-backed card whose finished transcript is missing', async () => {
    const { result } = boardOf([task({ id: 'bg3', toolUseId: 'toolu_a', status: 'completed', endedAt: 10 })]);
    await flush();
    const card = result.current.board.cards[0];
    expect(card.status).toBe('done');
    expect(result.current.feed(card)).toBeNull();
    expect(result.current.streamFallback(card)).toMatchObject({ reason: 'missing', detail: { id: 'bg3' } });
  });

  it('streams the chat output the model tagged onto an inline card', async () => {
    const msgs: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1, toolCalls: [{ id: 't0', name: 'sai_task', input: JSON.stringify({ action: 'create', tasks: [{ id: 'x', title: 'X', steps: ['one'] }] }) }] },
      { id: 'm1', role: 'assistant', content: '', timestamp: 2, toolCalls: [{ id: 't1', name: 'sai_task', input: JSON.stringify({ action: 'update', id: 'x', status: 'running' }) }] },
      { id: 'm2', role: 'assistant', content: 'doing the thing', timestamp: 3 },
    ];
    const { result } = renderHook(() => useTaskBoard({
      enabled: true, messages: msgs, claudeSessionId: null,
      backgroundTasks: [], isStreaming: true, awaitingQuestion: false, pendingApprovalToolUseId: null,
    }));
    await flush();
    const card = result.current.board.cards[0];
    expect(card.id).toBe('x');
    // The sai_task switch call (m1) files under the task too; the renderer hides it.
    expect(result.current.feed(card)!.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.current.feed(card)!.map((m) => m.content)).toEqual(['', 'doing the thing']);
    expect(result.current.streamFallback(card)).toBeNull();
    expect(card.now).toBe('doing the thing');
  });

  it('falls back to tagged output when an agent card has no transcript on disk', async () => {
    const msgs: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1, toolCalls: [{ id: 't0', name: 'sai_task', input: JSON.stringify({ action: 'create', tasks: [{ id: 'y', title: 'Y', steps: ['one'], agent: 'go do it' }] }) }] },
      { id: 'm1', role: 'assistant', content: '', timestamp: 2, toolCalls: [{ id: 't1', name: 'sai_task', input: JSON.stringify({ action: 'update', id: 'y', status: 'running' }) }] },
      { id: 'm2', role: 'assistant', content: 'did it inline instead', timestamp: 3 },
    ];
    const { result } = renderHook(() => useTaskBoard({
      enabled: true, messages: msgs, claudeSessionId: null,
      backgroundTasks: [], isStreaming: true, awaitingQuestion: false, pendingApprovalToolUseId: null,
    }));
    await flush();
    const card = result.current.board.cards[0];
    expect(card.agent).toMatchObject({ description: 'go do it', toolUseId: null, taskId: null });
    expect(result.current.feed(card)!.map((m) => m.content)).toEqual(['', 'did it inline instead']);
  });

  it('returns no fallback while an agent transcript is merely still loading', async () => {
    const { result } = boardOf([task({ id: 'bg4', toolUseId: 'toolu_b', status: 'running' })]);
    await flush();
    const card = result.current.board.cards[0];
    expect(result.current.feed(card)).toEqual([]);
    expect(result.current.streamFallback(card)).toBeNull();
  });
});

const json = (v: unknown) => JSON.stringify(v);
const sai = (id: string, input: unknown, taskId?: string | null) => ({ id, type: 'mcp', name: 'sai_task', input: json(input), output: 'ok', ...(taskId !== undefined ? { taskId } : {}) });
const hook = (messages: any[], over: Record<string, unknown> = {}) => renderHook(() => useTaskBoard({
  enabled: true, messages, claudeSessionId: null, backgroundTasks: [], isStreaming: true,
  awaitingQuestion: false, pendingApprovalToolUseId: null, ...over,
} as any));

describe('useTaskBoard feeds', () => {
  it('mixed legacy and stamped history', async () => {
    // Batch A (legacy: never stamped): t1 created, run, text, done.
    const a: any[] = [
      { id: 'a0', role: 'assistant', content: '', timestamp: 10, toolCalls: [sai('c0', { action: 'create', tasks: [{ id: 't1', title: 'Old one' }] })] },
      { id: 'a1', role: 'assistant', content: '', timestamp: 11, toolCalls: [sai('c1', { action: 'update', id: 't1', status: 'running' })] },
      { id: 'a2', role: 'assistant', content: 'old work', timestamp: 12, toolCalls: [{ id: 'b0', type: 'terminal', name: 'Bash', input: json({ command: 'ls' }), output: 'x' }] },
      { id: 'a3', role: 'assistant', content: '', timestamp: 13, toolCalls: [sai('c2', { action: 'update', id: 't1', status: 'done' })] },
    ];
    // The chat is reopened and continued: batch B is stamped at arrival and reuses id t1.
    const B = 30;
    const tB = `${B}:t1`;
    const b: any[] = [
      { id: 'u1', role: 'user', content: 'next', timestamp: 20, taskId: null },
      { id: 'b0', role: 'assistant', content: '', timestamp: B, taskId: null, toolCalls: [sai('c3', { action: 'create', tasks: [{ id: 't1', title: 'New one' }, { id: 't2', title: 'Other' }] }, null)] },
      { id: 'b1', role: 'assistant', content: '', timestamp: 31, taskId: null, toolCalls: [sai('c4', { action: 'update', id: 't1', status: 'running' }, tB)] },
      { id: 'b2', role: 'assistant', content: 'new work', timestamp: 32, taskId: tB, toolCalls: [{ id: 'b9', type: 'file_read', name: 'Read', input: json({ file_path: '/r/app.ts' }), output: 'x', taskId: tB }] },
    ];
    const { result } = hook([...a, ...b]);
    await flush();
    const cards = result.current.board.cards;
    expect(cards.map((c) => c.title)).toEqual(['New one', 'Other']);
    expect(cards[0].tag).toBe(tB);
    expect(result.current.feed(cards[0])!.map((m) => m.id)).toEqual(['b1', 'b2']);
    expect(result.current.feed(cards[1])).toEqual([]);
    expect(cards[0].now).toBe('read app.ts');
  });

  it('approval on a tagged tool call marks that card waiting', async () => {
    const msgs: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1, toolCalls: [sai('c0', { action: 'create', tasks: [{ id: 'x', title: 'X' }, { id: 'y', title: 'Y' }] })] },
      { id: 'm1', role: 'assistant', content: '', timestamp: 2, toolCalls: [sai('c1', { action: 'update', id: 'y', status: 'running' })] },
      { id: 'm2', role: 'assistant', content: '', timestamp: 3, toolCalls: [{ id: 'toolu_P', type: 'terminal', name: 'Bash', input: json({ command: 'rm -rf dist' }) }] },
    ];
    const { result } = hook(msgs, { isStreaming: false, pendingApprovalToolUseId: 'toolu_P' });
    await flush();
    const byId = (id: string) => result.current.board.cards.find((c) => c.id === id)!;
    expect(byId('y').status).toBe('waiting');
    expect(byId('x').status).toBe('queued');
    expect(byId('y').now).toBe('$ rm -rf dist…');
  });

  it('todos are one per card', async () => {
    const msgs: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1, toolCalls: [sai('c0', { action: 'create', tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }] })] },
      { id: 'm1', role: 'assistant', content: '', timestamp: 2, toolCalls: [
        sai('c1', { action: 'update', id: 'a', status: 'done' }),
        sai('c2', { action: 'update', id: 'b', status: 'failed' }),
        sai('c3', { action: 'update', id: 'c', status: 'running' }),
      ] },
    ];
    const { result } = hook(msgs);
    await flush();
    expect(result.current.todos).toEqual([
      { id: 'a', content: 'A', status: 'completed' },
      { id: 'b', content: 'B', status: 'completed' },
      { id: 'c', content: 'C', status: 'in_progress' },
      { id: 'd', content: 'D', status: 'pending' },
    ]);
    expect(hook([]).result.current.todos).toBeUndefined();
  });

  it('a TodoWrite-only chat leaves todos undefined so the composer keeps its own TodoWrite ring', async () => {
    const todoList = [
      { id: '1', content: 'Write tests', status: 'completed' },
      { id: '2', content: 'Implement', status: 'in_progress' },
    ];
    const todoOnly: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1, toolCalls: [{ id: 'tw', type: 'other', name: 'TodoWrite', input: json({ todos: todoList }), output: 'ok' }] },
    ];
    const { result } = hook(todoOnly);
    await flush();
    expect(result.current.board.cards.map((c) => c.id)).toEqual(['current-work']);
    expect(result.current.todos).toBeUndefined();

    const withTasks: any[] = [
      ...todoOnly,
      { id: 'm1', role: 'assistant', content: '', timestamp: 2, toolCalls: [sai('c0', { action: 'create', tasks: [{ id: 'a', title: 'A' }] })] },
    ];
    const tasked = hook(withTasks);
    await flush();
    expect(tasked.result.current.todos).toEqual([{ id: 'a', content: 'A', status: 'pending' }]);
  });

  it('runtime cards never override the composer todos', async () => {
    const todoOnly: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1, toolCalls: [{ id: 'tw', type: 'other', name: 'TodoWrite', input: json({ todos: [{ id: '1', content: 'X', status: 'pending' }] }), output: 'ok' }] },
    ];
    const withShell = hook(todoOnly, { backgroundTasks: [task({ id: 'bg1', kind: 'shell', isShell: true, description: 'npm run dev' })] });
    await flush();
    expect(withShell.result.current.board.cards.length).toBeGreaterThan(1);
    expect(withShell.result.current.todos).toBeUndefined();
    const shellOnly = hook([], { backgroundTasks: [task({ id: 'bg1', kind: 'shell', isShell: true, description: 'npm run dev' })] });
    await flush();
    expect(shellOnly.result.current.board.cards).toHaveLength(1);
    expect(shellOnly.result.current.todos).toBeUndefined();
    const declaredPlusShell = hook([
      { id: 'm1', role: 'assistant', content: '', timestamp: 2, toolCalls: [sai('c0', { action: 'create', tasks: [{ id: 'a', title: 'A' }] })] },
    ], { backgroundTasks: [task({ id: 'bg1', kind: 'shell', isShell: true, description: 'npm run dev' })] });
    await flush();
    expect(declaredPlusShell.result.current.todos).toEqual([{ id: 'a', content: 'A', status: 'pending' }]);
  });

  it('an agent-backed card interleaves its transcript with its tagged chat items', async () => {
    const ts = (ms: number) => new Date(ms).toISOString();
    fetchFn.mockResolvedValue({
      agentId: 'ag', finished: false, nextOffset: 2,
      messages: [
        { type: 'assistant', uuid: 's1', timestamp: ts(2500), message: { content: [{ type: 'text', text: 'agent reading' }] } },
        { type: 'assistant', uuid: 's2', timestamp: ts(4000), message: { content: [{ type: 'tool_use', id: 'k', name: 'Grep', input: { pattern: 'auth' } }] } },
      ],
    });
    const msgs: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1000, toolCalls: [sai('c0', { action: 'create', tasks: [{ id: 'r', title: 'Research', agent: 'Research auth' }] })] },
      { id: 'm1', role: 'assistant', content: '', timestamp: 2000, toolCalls: [sai('c1', { action: 'update', id: 'r', status: 'running' }), { id: 'toolu_A', type: 'other', name: 'Agent', input: json({ description: 'Research auth', prompt: 'p' }), output: 'launched' }] },
      { id: 'm2', role: 'assistant', content: 'waiting on the agent', timestamp: 3000 },
    ];
    const { result } = renderHook(() => useTaskBoard({
      enabled: true, messages: msgs, claudeSessionId: '0f8fad5b-d9cb-469f-a165-70867728950e', backgroundTasks: [],
      isStreaming: true, awaitingQuestion: false, pendingApprovalToolUseId: null,
    }));
    await flush();
    await flush();
    const card = result.current.board.cards[0];
    expect(card.agent?.toolUseId).toBe('toolu_A');
    expect(result.current.feed(card)!.map((m) => m.id)).toEqual(['m1', 's1', 'm2', 's2']);
    expect(card.now).toBe('search auth…');
  });
});
