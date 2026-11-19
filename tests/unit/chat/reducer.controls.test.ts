import { describe, it, expect } from 'vitest';
import { emptyChatState, reduceChat, reduceMany, persistableState, stateFromMessages } from '../../../src/lib/chat/reducer';
import type { ChatMessage } from '../../../src/types';
import { e, assistant, delta, toolUse, toolResult } from './helpers';

const claude = () => emptyChatState({ provider: 'claude' });
const codex = () => emptyChatState({ provider: 'codex' });

const approval = (extra: Record<string, unknown> = {}) => ({
  type: 'approval_needed', toolName: 'Bash', toolUseId: 't1', command: 'rm -rf x', description: 'Run', input: { command: 'rm -rf x' }, ...extra,
});

describe('approvals and prompts', () => {
  it('approval_needed sets pendingApproval (provider-gated for codex); approval_resolved clears it', () => {
    const s = reduceChat(claude(), e(1, approval()));
    expect(s.pendingApproval).toEqual({ toolName: 'Bash', toolUseId: 't1', command: 'rm -rf x', description: 'Run', input: { command: 'rm -rf x' } });
    expect(reduceChat(s, e(2, { type: 'approval_resolved' })).pendingApproval).toBeNull();

    // A Codex approval never renders in a Claude chat, and vice versa.
    expect(reduceChat(claude(), e(1, approval({ provider: 'codex' }))).pendingApproval).toBeNull();
    expect(reduceChat(codex(), e(1, approval())).pendingApproval).toBeNull();
    const c = reduceChat(codex(), e(1, approval({ provider: 'codex', requestHandle: 'h1', kind: 'command', availableDecisions: ['accept'] })));
    expect(c.pendingApproval).toMatchObject({ provider: 'codex', requestHandle: 'h1', kind: 'command', availableDecisions: ['accept'] });
  });

  it('tool_result clears pendingApproval', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('t1', 'Bash', 'x'))),
      e(3, approval()),
      e(4, toolResult(1, 't1', 'ok')),
    ]);
    expect(s.pendingApproval).toBeNull();
  });

  it('sudo-prompt / sudo-resolved set and clear pendingSudo', () => {
    const s = reduceChat(claude(), e(1, { type: 'sudo-prompt', promptId: 'p1', toolUseId: 't1', command: 'sudo ls', error: 'Incorrect password' }));
    expect(s.pendingSudo).toEqual({ promptId: 'p1', toolUseId: 't1', command: 'sudo ls', error: 'Incorrect password' });
    expect(reduceChat(s, e(2, { type: 'sudo-resolved' })).pendingSudo).toBeNull();
  });

  it('question_answered merges answers into the tool input JSON', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('q1', 'AskUserQuestion', { questions: [{ question: 'Pick?' }] }))),
      e(3, { type: 'question_answered', toolUseId: 'q1', answers: { 'Pick?': 'A' } }),
    ]);
    expect(JSON.parse(s.messages[0].toolCalls![0].input)).toEqual({ questions: [{ question: 'Pick?' }], answers: { 'Pick?': 'A' } });
  });

  it('plan_review_answered stamps "Plan approved"/"Plan rejected" output', () => {
    const base = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('p1', 'ExitPlanMode', { plan: 'x' }))),
    ]);
    expect(reduceChat(base, e(3, { type: 'plan_review_answered', toolUseId: 'p1', approved: true })).messages[0].toolCalls![0].output).toBe('Plan approved');
    expect(reduceChat(base, e(3, { type: 'plan_review_answered', toolUseId: 'p1', approved: false })).messages[0].toolCalls![0].output).toBe('Plan rejected');
  });

  it('user_input_needed / resolved only for codex with a matching requestHandle', () => {
    const q = { type: 'user_input_needed', provider: 'codex', requestHandle: 'h1', questions: [{ id: 'q', header: 'H', prompt: 'P' }], autoResolutionMs: 5000 };
    expect(reduceChat(claude(), e(1, q)).pendingCodexUserInput).toBeNull();
    const s = reduceChat(codex(), e(1, q));
    expect(s.pendingCodexUserInput).toEqual({ provider: 'codex', requestHandle: 'h1', questions: q.questions, autoResolutionMs: 5000 });
    expect(reduceChat(s, e(2, { type: 'user_input_resolved', provider: 'codex', requestHandle: 'other' })).pendingCodexUserInput).not.toBeNull();
    expect(reduceChat(s, e(2, { type: 'user_input_resolved', provider: 'codex', requestHandle: 'h1' })).pendingCodexUserInput).toBeNull();

    const m = reduceChat(codex(), e(1, { type: 'mcp_elicitation_needed', provider: 'codex', requestHandle: 'h2', serverName: 'srv', message: 'Fill', mode: 'form', requestedSchema: { type: 'object' } }));
    expect(m.pendingCodexMcpElicitation).toEqual({ provider: 'codex', requestHandle: 'h2', mode: 'form', serverName: 'srv', message: 'Fill', requestedSchema: { type: 'object' } });
    expect(reduceChat(m, e(2, { type: 'mcp_elicitation_resolved', provider: 'codex', requestHandle: 'h2' })).pendingCodexMcpElicitation).toBeNull();
  });
});

describe('hints and notes', () => {
  it('api_retry, task_progress, status compacting set streamHint; real text clears it', () => {
    let s = reduceChat(claude(), e(1, { type: 'streaming_start', turnSeq: 1 }));
    s = reduceChat(s, e(2, { type: 'system', subtype: 'api_retry', retry_delay_ms: 2500, attempt: 2, max_retries: 5 }));
    expect(s.streamHint).toBe('api error · retrying 2/5 in 3s');
    s = reduceChat(s, e(3, { type: 'system', subtype: 'task_progress', description: 'Analyzing auth' }));
    expect(s.streamHint).toBe('agent · Analyzing auth');
    s = reduceChat(s, e(4, { type: 'system', subtype: 'status', status: 'compacting' }));
    expect(s.streamHint).toBe('compacting context…');
    expect(reduceChat(s, e(5, { type: 'system', subtype: 'status', status: null })).streamHint).toBeNull();
    expect(reduceChat(s, e(5, assistant(1, delta('Hi')))).streamHint).toBeNull();
  });

  it('prompt_suggestion sets promptSuggestion; streaming_start clears it', () => {
    const s = reduceChat(claude(), e(1, { type: 'prompt_suggestion', suggestion: '  run the tests  ' }));
    expect(s.promptSuggestion).toBe('run the tests');
    expect(reduceChat(s, e(2, { type: 'prompt_suggestion', suggestion: '   ' })).promptSuggestion).toBe('run the tests');
    expect(reduceChat(s, e(2, { type: 'streaming_start', turnSeq: 1 })).promptSuggestion).toBeNull();
  });

  it('context_compacted appends "Context auto-compacted." note', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'system', subtype: 'context_compacted' }),
      e(2, { type: 'system', subtype: 'compact', summary: 'Summary text' }),
    ]);
    expect(s.messages).toEqual([
      { id: 'c1', role: 'system', content: 'Context auto-compacted.', timestamp: 1001 },
      { id: 'c2', role: 'system', content: 'Context auto-compacted. Summary: Summary text', timestamp: 1002 },
    ]);
  });
});

describe('client state', () => {
  it('settings_changed merges; queue_added/removed/cleared maintain order', () => {
    let s = reduceChat(claude(), e(1, { type: 'settings_changed', settings: { model: 'opus', effort: 'high' } }));
    s = reduceChat(s, e(2, { type: 'settings_changed', settings: { effort: 'max' } }));
    expect(s.settings).toEqual({ provider: 'claude', model: 'opus', effort: 'max' });

    const item = (clientId: string) => ({ clientId, text: clientId, queuedAt: 1 });
    s = reduceMany(s, [
      e(3, { type: 'queue_added', item: item('a') }),
      e(4, { type: 'queue_added', item: item('b') }),
      e(5, { type: 'queue_added', item: item('c') }),
      e(6, { type: 'queue_added', item: item('b') }), // idempotent re-add
      e(7, { type: 'queue_removed', clientId: 'b' }),
    ]);
    expect(s.queue.map(q => q.clientId)).toEqual(['a', 'c']);
    expect(reduceChat(s, e(8, { type: 'queue_cleared' })).queue).toEqual([]);
  });

  it('queue_promoted moves an item to the front; unknown ids are a no-op', () => {
    const item = (clientId: string) => ({ clientId, text: clientId, queuedAt: 1 });
    let s = reduceMany(claude(), [
      e(1, { type: 'queue_added', item: item('a') }),
      e(2, { type: 'queue_added', item: item('b') }),
      e(3, { type: 'queue_added', item: item('c') }),
      e(4, { type: 'queue_promoted', clientId: 'c' }),
    ]);
    expect(s.queue.map(q => q.clientId)).toEqual(['c', 'a', 'b']);
    s = reduceChat(s, e(5, { type: 'queue_promoted', clientId: 'zz' }));
    expect(s.queue.map(q => q.clientId)).toEqual(['c', 'a', 'b']);
  });

  it('a queued send waits in the queue, not the transcript; its drain puts the bubble at the end', () => {
    let s = reduceMany(claude(), [
      e(1, { type: 'user_message', clientId: 'u1', text: 'first', origin: 'desktop' }),
      e(2, { type: 'streaming_start', turnSeq: 1 }),
      e(3, { type: 'user_message', clientId: 'u2', text: 'second', origin: 'desktop', taskId: 't-9' }),
      e(4, { type: 'queue_added', item: { clientId: 'u2', text: 'second', queuedAt: 1, taskId: 't-9', images: ['data:x'] } }),
      e(5, assistant(1, { type: 'text', text: 'reply' })),
    ]);
    // Held: the queue strip shows it, the transcript doesn't.
    expect(s.messages.map(m => m.id)).toEqual(['u1', expect.any(String)]);
    expect(s.messages[1].role).toBe('assistant');
    expect(s.queue.map(q => q.clientId)).toEqual(['u2']);
    s = reduceMany(s, [
      e(6, { type: 'done', turnSeq: 1 }),
      // The drain: the next turn starts (sync backend), then the item leaves the queue as sent.
      e(7, { type: 'streaming_start', turnSeq: 2 }),
      e(8, { type: 'queue_removed', clientId: 'u2', sent: true }),
    ]);
    expect(s.queue).toEqual([]);
    const last = s.messages[s.messages.length - 1];
    expect(last).toMatchObject({ id: 'u2', role: 'user', content: 'second', taskId: 't-9', images: ['data:x'], timestamp: 1008 });
    // The new turn's output lands after the bubble.
    s = reduceChat(s, e(9, assistant(2, { type: 'text', text: 'reply 2' })));
    expect(s.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('a queued item removed by the user never reaches the transcript', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'user_message', clientId: 'u2', text: 'second', origin: 'desktop' }),
      e(2, { type: 'queue_added', item: { clientId: 'u2', text: 'second', queuedAt: 1 } }),
      e(3, { type: 'queue_removed', clientId: 'u2' }),
    ]);
    expect(s.messages).toEqual([]);
    expect(s.queue).toEqual([]);
  });

  it('watcher_snapshot upserts by url on the owning message', () => {
    const snap = (url: string, phase: string) => ({ url, kind: 'run', phase, capturedAt: 1, data: {} });
    let s = reduceMany(claude(), [
      e(1, { type: 'user_message', clientId: 'u1', text: 'hi', origin: 'desktop' }),
      e(2, { type: 'local_note', noteId: 'n1', content: 'x' }),
      e(3, { type: 'watcher_snapshot', messageId: 'n1', snapshot: snap('https://a', 'queued') }),
      e(4, { type: 'watcher_snapshot', messageId: 'n1', snapshot: snap('https://b', 'queued') }),
      e(5, { type: 'watcher_snapshot', messageId: 'n1', snapshot: snap('https://a', 'success') }),
    ]);
    expect(s.messages[0].githubWatchers).toBeUndefined();
    expect(s.messages[1].githubWatchers).toEqual([snap('https://b', 'queued'), snap('https://a', 'success')]);
    const before = s.messages;
    s = reduceChat(s, e(6, { type: 'watcher_snapshot', messageId: 'n1', snapshot: snap('https://a', 'success') }));
    expect(s.messages).toBe(before);
  });

  it('persistableState strips reasoningLive and liveOutput and ends the turn', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('t1', 'Bash', 'x'))),
      e(3, toolResult(1, 't1', 'partial', true)),
      e(4, { type: 'reasoning_delta', text: 'hmm' }),
      e(5, approval()),
      e(6, { type: 'sudo-prompt', promptId: 'p', toolUseId: 't1', command: 'sudo x' }),
    ]);
    const p = persistableState(s);
    expect(p.turn.streaming).toBe(false);
    expect(p.pendingApproval).toBeNull();
    expect(p.pendingSudo).toBeNull();
    expect('liveOutput' in p.messages[0].toolCalls![0]).toBe(false);
    expect(p.messages[0].toolCalls![0].output).toBe('partial');
    expect('reasoningLive' in p.messages[1]).toBe(false);
    expect(p.messages[1].reasoning).toBe('hmm');
    // The input state is not mutated.
    expect(s.messages[1].reasoningLive).toBe(true);
    expect(s.turn.streaming).toBe(true);
  });

  it('stateFromMessages keeps message ids and sets lastSeq 0', () => {
    const msgs: ChatMessage[] = [
      { id: 'abc', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'def', role: 'assistant', content: 'yo', timestamp: 2 },
    ];
    const s = stateFromMessages(msgs, { provider: 'codex', model: 'gpt' });
    expect(s.messages.map(m => m.id)).toEqual(['abc', 'def']);
    expect(s.lastSeq).toBe(0);
    expect(s.settings).toEqual({ provider: 'codex', model: 'gpt' });
    expect(s.turn.streaming).toBe(false);
    // The first logged entry (seq 1) applies on top.
    expect(reduceChat(s, e(1, { type: 'user_message', clientId: 'u', text: 'next', origin: 'desktop' })).messages).toHaveLength(3);
  });
});
