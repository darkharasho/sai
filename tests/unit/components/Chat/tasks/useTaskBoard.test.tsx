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
    backgroundTasks: tasks, isStreaming, awaitingQuestion: false, focusId: null,
  }));

describe('useTaskBoard streamFallback', () => {
  it('reports a shell task, carrying its detail', async () => {
    const { result } = boardOf([task({ id: 'bg1', kind: 'shell', isShell: true, description: 'npm test' })]);
    await flush();
    const card = result.current.board.cards[0];
    expect(card.id).toBe('bg:bg1');
    expect(result.current.streamMessages(card)).toBeNull();
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
    expect(result.current.streamMessages(card)).toBeNull();
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
      backgroundTasks: [], isStreaming: true, awaitingQuestion: false, focusId: null,
    }));
    await flush();
    const card = result.current.board.cards[0];
    expect(card.id).toBe('x');
    expect(result.current.streamMessages(card)!.map((m) => m.content)).toEqual(['doing the thing']);
    expect(result.current.streamFallback(card)).toBeNull();
    expect(result.current.tails.get('x')!.length).toBeGreaterThan(0);
  });

  it('falls back to tagged output when an agent card has no transcript on disk', async () => {
    const msgs: any[] = [
      { id: 'm0', role: 'assistant', content: '', timestamp: 1, toolCalls: [{ id: 't0', name: 'sai_task', input: JSON.stringify({ action: 'create', tasks: [{ id: 'y', title: 'Y', steps: ['one'], agent: 'go do it' }] }) }] },
      { id: 'm1', role: 'assistant', content: '', timestamp: 2, toolCalls: [{ id: 't1', name: 'sai_task', input: JSON.stringify({ action: 'update', id: 'y', status: 'running' }) }] },
      { id: 'm2', role: 'assistant', content: 'did it inline instead', timestamp: 3 },
    ];
    const { result } = renderHook(() => useTaskBoard({
      enabled: true, messages: msgs, claudeSessionId: null,
      backgroundTasks: [], isStreaming: true, awaitingQuestion: false, focusId: null,
    }));
    await flush();
    const card = result.current.board.cards[0];
    expect(card.agent).toMatchObject({ description: 'go do it', toolUseId: null, taskId: null });
    expect(result.current.streamMessages(card)!.map((m) => m.content)).toEqual(['did it inline instead']);
  });

  it('returns no fallback while an agent transcript is merely still loading', async () => {
    const { result } = boardOf([task({ id: 'bg4', toolUseId: 'toolu_b', status: 'running' })]);
    await flush();
    const card = result.current.board.cards[0];
    expect(result.current.streamMessages(card)).toEqual([]);
    expect(result.current.streamFallback(card)).toBeNull();
  });
});
