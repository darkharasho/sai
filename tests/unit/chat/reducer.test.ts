import { describe, it, expect } from 'vitest';
import { emptyChatState, reduceChat, reduceMany, stateFromMessages } from '../../../src/lib/chat/reducer';
import type { ChatState } from '../../../src/lib/chat/types';
import { e, assistant, delta, text, toolUse, toolResult } from './helpers';

const claude = () => emptyChatState({ provider: 'claude' });

describe('reduceChat: assistant text', () => {
  it('appends text deltas into one assistant bubble', () => {
    const s = reduceMany(emptyChatState({ provider: 'claude' }), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'assistant', turnSeq: 1, message: { content: [{ type: 'text', text: 'Hel', delta: true }] } }),
      e(3, { type: 'assistant', turnSeq: 1, message: { content: [{ type: 'text', text: 'lo', delta: true }] } }),
    ]);
    expect(s.messages).toEqual([expect.objectContaining({ id: 'm2', role: 'assistant', content: 'Hello', timestamp: 1002, startedAt: 1001 })]);
  });

  it('final-tagged frame replaces accumulated delta text (claude)', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, delta('Hel'))),
      e(3, assistant(1, delta('lo wor'))),
      e(4, assistant(1, text('Hello world', { final: true }))),
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ id: 'm2', content: 'Hello world' });
  });

  it('claude full non-final frame after text starts a new bubble', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, delta('first'))),
      e(3, assistant(1, text('second'))),
    ]);
    expect(s.messages.map(m => [m.id, m.content])).toEqual([['m2', 'first'], ['m3', 'second']]);
    // The previous bubble is stamped with its duration from the turn start.
    expect(s.messages[0]).toMatchObject({ durationMs: 1003 - 1001, completedAt: 1003 });
    expect(s.messages[1].durationMs).toBeUndefined();
  });

  it('gemini non-delta full text replaces the last text bubble', () => {
    const s = reduceMany(emptyChatState({ provider: 'gemini' }), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, text('Hel'))),
      e(3, assistant(1, text('Hello'))),
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ id: 'm2', content: 'Hello' });
  });

  it('streaming_start forces a new bubble even when last is mergeable text', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, delta('one'))),
      e(3, { type: 'streaming_start', turnSeq: 1 }),
      e(4, assistant(1, delta('two'))),
      e(5, assistant(1, delta('!'))),
    ]);
    expect(s.messages.map(m => [m.id, m.content])).toEqual([['m2', 'one'], ['m4', 'two!']]);
    expect(s.messages[1].startedAt).toBe(1003);
  });
});

describe('reduceChat: tools', () => {
  it('tool_use creates a tool card; later same id+turnSeq updates input in place', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('t1', 'TodoWrite', { todos: [1] }))),
      e(3, assistant(1, toolUse('t1', 'TodoWrite', { todos: [1, 2] }))),
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].id).toBe('m2');
    expect(s.messages[0].toolCalls).toEqual([{
      id: 't1', turnSeq: 1, type: 'todo', name: 'TodoWrite',
      input: JSON.stringify({ todos: [1, 2] }, null, 2), startedAt: 1002,
    }]);
  });

  it('codex item_0 in a later turn creates a new card, not an update', () => {
    const s = reduceMany(emptyChatState({ provider: 'codex' }), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('item_0', 'Bash', 'ls'))),
      e(3, { type: 'done', turnSeq: 1 }),
      e(4, { type: 'streaming_start', turnSeq: 2 }),
      e(5, assistant(2, toolUse('item_0', 'Bash', 'pwd'))),
    ]);
    const cards = s.messages.flatMap(m => m.toolCalls ?? []);
    expect(cards.map(c => [c.turnSeq, c.input])).toEqual([[1, 'ls'], [2, 'pwd']]);
  });

  it('tool_result fills output, liveOutput false, durationMs = ts - startedAt', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('t1', 'Bash', { command: 'ls' }))),
      e(3, toolResult(1, 't1', [{ type: 'text', text: 'a.txt' }]), 1500),
    ]);
    expect(s.messages[0].toolCalls![0]).toMatchObject({ output: 'a.txt', liveOutput: false, durationMs: 1500 - 1002 });
    expect(s.turn.nextSegmentStart).toBe(1500);
  });

  it('partial tool_result accumulates cumulative and chunked output without duplication', () => {
    const s0 = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('t1', 'Bash', 'x'))),
      e(3, toolResult(1, 't1', 'ab', true)),
      e(4, toolResult(1, 't1', 'abcd', true)),   // cumulative
      e(5, toolResult(1, 't1', 'ef', true)),     // chunk
      e(6, toolResult(1, 't1', 'ef', true)),     // duplicate chunk
    ]);
    expect(s0.messages[0].toolCalls![0]).toMatchObject({ output: 'abcdef', liveOutput: true });
  });

  it('partial tool_result never reopens a settled card', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('t1', 'Bash', 'x'))),
      e(3, toolResult(1, 't1', 'done')),
      e(4, toolResult(1, 't1', 'late', true)),
    ]);
    expect(s.messages[0].toolCalls![0]).toMatchObject({ output: 'done', liveOutput: false });
  });

  it('tool_result with a different turnSeq does not touch the card', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, toolUse('t1', 'Bash', 'x'))),
      e(3, toolResult(2, 't1', 'other turn')),
    ]);
    expect(s.messages[0].toolCalls![0].output).toBeUndefined();
  });
});

describe('reduceChat: reasoning and hints', () => {
  it('reasoning_delta builds a reasoningLive row; text output finalizes it with reasoningDurationMs', () => {
    let s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'reasoning_delta', text: 'Let me ' }),
      e(3, { type: 'reasoning_delta', text: 'think' }),
    ]);
    expect(s.messages).toEqual([expect.objectContaining({ id: 'm2', role: 'assistant', content: '', reasoning: 'Let me think', reasoningLive: true, timestamp: 1002 })]);
    expect(s.turn.reasoningActive).toBe(true);
    s = reduceChat(s, e(4, assistant(1, delta('Answer')), 2002));
    expect(s.turn.reasoningActive).toBe(false);
    expect(s.messages[0].reasoningLive).toBeUndefined();
    expect(s.messages[0].reasoningDurationMs).toBe(1000);
    expect(s.messages[1]).toMatchObject({ id: 'm4', content: 'Answer' });
  });

  it('thinking_tokens sets reasoningTokens on live row, else streamHint "thinking · 1.2k tokens"', () => {
    const base = reduceChat(claude(), e(1, { type: 'streaming_start', turnSeq: 1 }));
    const hinted = reduceChat(base, e(2, { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 1234 }));
    expect(hinted.streamHint).toBe('thinking · 1.2k tokens');
    const small = reduceChat(base, e(2, { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 12 }));
    expect(small.streamHint).toBe('thinking · 12 tokens');

    const live = reduceMany(hinted, [
      e(3, { type: 'reasoning_delta', text: 'hmm' }),
      e(4, { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 900 }),
    ]);
    expect(live.streamHint).toBeNull();
    expect(live.messages[0]).toMatchObject({ reasoningLive: true, reasoningTokens: 900 });
  });
});

describe('reduceChat: errors and results', () => {
  it('API-error-looking text replaces a trailing pure-text bubble with an error row', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, delta('partial'))),
      e(3, assistant(1, text('API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Slow down"}}'))),
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ id: 'e3', role: 'system', content: 'Slow down', timestamp: 1003 });
    expect(s.messages[0].error).toMatchObject({ status: 429, title: 'Rate limit exceeded' });
  });

  it('result.result replaces last assistant content, or appends m<seq> when none', () => {
    const replaced = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, assistant(1, delta('draft'))),
      e(3, { type: 'result', turnSeq: 1, result: 'Final' }),
    ]);
    expect(replaced.messages).toEqual([expect.objectContaining({ id: 'm2', content: 'Final' })]);

    const appended = reduceMany(claude(), [
      e(1, { type: 'user_message', clientId: 'u1', text: 'hi', origin: 'desktop' }),
      e(2, { type: 'streaming_start', turnSeq: 1 }),
      e(3, { type: 'result', turnSeq: 1, result: 'Only result' }),
    ]);
    expect(appended.messages[1]).toEqual(expect.objectContaining({ id: 'm3', role: 'assistant', content: 'Only result', timestamp: 1003, startedAt: 1002 }));
    expect(appended.turn.nextSegmentStart).toBeNull();
  });

  it('done stamps durationMs/completedAt on unstamped text bubbles since turn start', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'assistant', message: { content: [text('old reply')] } }), // before the turn, unstamped
      e(2, { type: 'streaming_start', turnSeq: 1 }, 2000),
      e(3, assistant(1, delta('a')), 2100),
      e(4, assistant(1, toolUse('t1', 'Bash', 'x')), 2200),
      e(5, assistant(1, delta('b')), 2300),
      e(6, { type: 'done', turnSeq: 1 }, 5000),
    ]);
    const [old, a, , b] = s.messages;
    // Opening a new bubble stamps the most recent unstamped text bubble (ChatPanel parity).
    expect(old).toMatchObject({ durationMs: 100, completedAt: 2100 });
    expect(a).toMatchObject({ durationMs: 200, completedAt: 2200 });
    expect(b).toMatchObject({ durationMs: 3000, completedAt: 5000 });
    expect(s.turn.streaming).toBe(false);
    expect(s.turn.startedAt).toBeNull();
    expect(s.turn.startIndex).toBeNull();
  });

  it('done leaves unstamped bubbles from before the turn start alone', () => {
    const old = { id: 'h1', role: 'assistant' as const, content: 'history', timestamp: 1 };
    const s = reduceMany(stateFromMessages([old], { provider: 'claude' }), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'reasoning_delta', text: 'hmm' }),
      e(3, { type: 'done', turnSeq: 1 }),
    ]);
    expect(s.messages[0]).toEqual(old);
  });
});

describe('reduceChat: client events', () => {
  it('user_message uses clientId as id; replaying the same entry seq is a no-op', () => {
    const entry = e(1, { type: 'user_message', clientId: 'cli-1', text: 'hello', images: ['a.png'], origin: 'desktop', taskId: 'b:t1' });
    const s = reduceChat(claude(), entry);
    expect(s.messages).toEqual([{ id: 'cli-1', role: 'user', content: 'hello', timestamp: 1001, images: ['a.png'], taskId: 'b:t1' }]);
    expect(s.lastSeq).toBe(1);
    expect(reduceChat(s, entry)).toBe(s);
    // No clientId (remote echo): id comes from the seq.
    const r = reduceChat(s, e(2, { type: 'user_message', text: 'from phone', origin: 'remote' }));
    expect(r.messages[1]).toEqual({ id: 'm2', role: 'user', content: 'from phone', timestamp: 1002 });
  });

  it('cleared empties messages; local_note appends a system row', () => {
    let s = reduceMany(claude(), [
      e(1, { type: 'user_message', clientId: 'u1', text: 'hi', origin: 'desktop' }),
      e(2, { type: 'cleared' }),
    ]);
    expect(s.messages).toEqual([]);
    s = reduceChat(s, e(3, { type: 'local_note', noteId: 'help-1', content: 'Commands…' }));
    expect(s.messages).toEqual([{ id: 'help-1', role: 'system', content: 'Commands…', timestamp: 1003 }]);
    const err = { title: 'Boom', message: 'fake' };
    s = reduceChat(s, e(4, { type: 'local_note', noteId: 'n2', content: 'fake', error: err }));
    expect(s.messages[1]).toEqual({ id: 'n2', role: 'system', content: 'fake', timestamp: 1004, error: err });
  });

  it('is deterministic: same entries twice give deep-equal states', () => {
    const entries = [
      e(1, { type: 'user_message', clientId: 'u1', text: 'go', origin: 'desktop' }),
      e(2, { type: 'streaming_start', turnSeq: 1 }),
      e(3, { type: 'reasoning_delta', text: 'think' }),
      e(4, assistant(1, delta('Hi'), toolUse('t1', 'Read', { file_path: '/a' }))),
      e(5, toolResult(1, 't1', 'contents')),
      e(6, assistant(1, delta('Done'))),
      e(7, { type: 'result', turnSeq: 1, result: 'Done.' }),
      e(8, { type: 'done', turnSeq: 1 }),
    ];
    const a: ChatState = reduceMany(claude(), entries);
    const b: ChatState = reduceMany(claude(), entries);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe('reduceChat: waiting, follow-up and question state', () => {
  const bgWait = { kind: 'background', resumeInSeconds: null, taskCount: 2 };

  it('done with background wait sets waiting and ends streaming', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'done', turnSeq: 1, wait: bgWait }),
    ]);
    expect(s.turn.streaming).toBe(false);
    expect(s.waiting).toEqual({ kind: 'background', taskCount: 2, since: 1002 });
  });

  it('scheduled wait keeps resumeInSeconds; kind none sets nothing', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'done', turnSeq: 1, wait: { kind: 'scheduled', resumeInSeconds: 90, taskCount: null } }),
    ]);
    expect(s.waiting).toEqual({ kind: 'scheduled', resumeInSeconds: 90, since: 1002 });
    const none = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'done', turnSeq: 1, wait: { kind: 'none', resumeInSeconds: null, taskCount: null } }),
    ]);
    expect(none.waiting).toBeNull();
  });

  it('stale done with wait is ignored', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 2 }),
      e(2, { type: 'done', turnSeq: 1, wait: bgWait }),
    ]);
    expect(s.waiting).toBeNull();
    expect(s.turn.streaming).toBe(true);
  });

  it('done with turnSeq null and a wait is never stale', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 2 }),
      e(2, { type: 'done', turnSeq: null, wait: bgWait }),
    ]);
    expect(s.waiting).toMatchObject({ kind: 'background' });
  });

  it('streaming_start clears waiting and followUp', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'done', turnSeq: 1, wait: bgWait }),
      e(3, { type: 'followup', state: 'following', waitingFor: 'CI' }),
    ]);
    expect(s.waiting).not.toBeNull();
    expect(s.followUp).toEqual({ state: 'following', waitingFor: 'CI' });
    const next = reduceChat(s, e(4, { type: 'streaming_start', turnSeq: 2 }));
    expect(next.waiting).toBeNull();
    expect(next.followUp).toBeNull();
  });

  it('result, a non-wait done, user_message and cleared clear waiting', () => {
    const waiting = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'done', turnSeq: 1, wait: bgWait }),
    ]);
    expect(reduceChat(waiting, e(3, { type: 'result', turnSeq: null })).waiting).toBeNull();
    expect(reduceChat(waiting, e(3, { type: 'done', turnSeq: null })).waiting).toBeNull();
    expect(reduceChat(waiting, e(3, { type: 'user_message', text: 'hi' })).waiting).toBeNull();
    expect(reduceChat(waiting, e(3, { type: 'cleared' })).waiting).toBeNull();
  });

  it('followup none clears followUp', () => {
    const s = reduceChat(claude(), e(1, { type: 'followup', state: 'stalled' }));
    expect(s.followUp).toEqual({ state: 'stalled' });
    expect(reduceChat(s, e(2, { type: 'followup', state: 'none', turnSeq: 0 })).followUp).toBeNull();
  });

  it('question_needed then question_answered toggles awaitingQuestion', () => {
    let s = reduceChat(claude(), e(1, { type: 'question_needed', toolUseId: 'q1' }));
    expect(s.awaitingQuestion).toBe(true);
    s = reduceChat(s, e(2, { type: 'question_answered', toolUseId: 'q1', answers: {} }));
    expect(s.awaitingQuestion).toBe(false);
    s = reduceChat(s, e(3, { type: 'plan_review_needed', toolUseId: 'p1' }));
    expect(s.awaitingQuestion).toBe(true);
    s = reduceChat(s, e(4, { type: 'plan_review_answered', toolUseId: 'p1', approved: true }));
    expect(s.awaitingQuestion).toBe(false);
    s = reduceChat(s, e(5, { type: 'question_needed', toolUseId: 'q2' }));
    expect(reduceChat(s, e(6, { type: 'streaming_start', turnSeq: 1 })).awaitingQuestion).toBe(false);
    expect(reduceChat(s, e(6, { type: 'cleared' })).awaitingQuestion).toBe(false);
  });
});
