import { describe, it, expect } from 'vitest';
import { buildPendingQuestionAnswer, buildPendingQuestionAnswerFromTranscript } from '../../../src/lib/pendingQuestionAnswer';
import type { ChatMessage } from '../../../src/types';

function ask(id: string, input: unknown): ChatMessage {
  return {
    id: `m-${id}`,
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [{ id, type: 'question', name: 'AskUserQuestion', input: JSON.stringify(input) }],
  };
}

describe('buildPendingQuestionAnswer', () => {
  it('maps text to a single single-select question as the Other answer', () => {
    const msgs = [ask('q1', { questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] })];
    expect(buildPendingQuestionAnswer(msgs, 'my custom answer')).toEqual({
      toolUseId: 'q1',
      answers: { 'Pick one': 'my custom answer' },
    });
  });

  it('wraps the text in an array for a multiSelect question', () => {
    const msgs = [ask('q1', { questions: [{ question: 'Pick some', multiSelect: true, options: [{ label: 'A' }] }] })];
    expect(buildPendingQuestionAnswer(msgs, 'free text')).toEqual({
      toolUseId: 'q1',
      answers: { 'Pick some': ['free text'] },
    });
  });

  it('applies the text to every question, respecting each multiSelect shape', () => {
    const msgs = [ask('q1', {
      questions: [
        { question: 'Q1', options: [{ label: 'A' }] },
        { question: 'Q2', multiSelect: true, options: [{ label: 'B' }] },
      ],
    })];
    expect(buildPendingQuestionAnswer(msgs, 'x')).toEqual({
      toolUseId: 'q1',
      answers: { Q1: 'x', Q2: ['x'] },
    });
  });

  it('returns null for an already-answered card', () => {
    const msgs = [ask('q1', {
      questions: [{ question: 'Pick one', options: [{ label: 'A' }] }],
      answers: { 'Pick one': 'A' },
    })];
    expect(buildPendingQuestionAnswer(msgs, 'hi')).toBeNull();
  });

  it('returns null when no AskUserQuestion tool call is present', () => {
    const msgs: ChatMessage[] = [{ id: 'm1', role: 'assistant', content: 'hello', timestamp: 1 }];
    expect(buildPendingQuestionAnswer(msgs, 'hi')).toBeNull();
  });

  it('returns null for blank or whitespace-only text', () => {
    const msgs = [ask('q1', { questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] })];
    expect(buildPendingQuestionAnswer(msgs, '   ')).toBeNull();
    expect(buildPendingQuestionAnswer(msgs, '')).toBeNull();
  });

  it('skips a tool call with malformed input JSON', () => {
    const bad: ChatMessage = {
      id: 'm-bad', role: 'assistant', content: '', timestamp: 1,
      toolCalls: [{ id: 'bad', type: 'question', name: 'AskUserQuestion', input: '{not json' }],
    };
    expect(buildPendingQuestionAnswer([bad], 'hi')).toBeNull();
  });

  it('picks the most recent unanswered card when several exist', () => {
    const msgs = [
      ask('old', { questions: [{ question: 'Old', options: [{ label: 'A' }] }] }),
      ask('new', { questions: [{ question: 'New', options: [{ label: 'B' }] }] }),
    ];
    expect(buildPendingQuestionAnswer(msgs, 'z')).toEqual({
      toolUseId: 'new',
      answers: { New: 'z' },
    });
  });
});

function tool(toolUseId: string, toolInput: unknown) {
  return { role: 'tool' as const, toolName: 'AskUserQuestion', toolUseId, toolInput: toolInput as Record<string, unknown> };
}

describe('buildPendingQuestionAnswerFromTranscript', () => {
  it('maps text to a single question (object toolInput)', () => {
    const msgs = [tool('q1', { questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] })];
    expect(buildPendingQuestionAnswerFromTranscript(msgs, 'custom')).toEqual({
      toolUseId: 'q1',
      answers: { 'Pick one': 'custom' },
    });
  });

  it('wraps multiSelect answers in an array and applies to all questions', () => {
    const msgs = [tool('q1', {
      questions: [
        { question: 'Q1', options: [{ label: 'A' }] },
        { question: 'Q2', multiSelect: true, options: [{ label: 'B' }] },
      ],
    })];
    expect(buildPendingQuestionAnswerFromTranscript(msgs, 'x')).toEqual({
      toolUseId: 'q1',
      answers: { Q1: 'x', Q2: ['x'] },
    });
  });

  it('returns null for an already-answered card', () => {
    const msgs = [tool('q1', {
      questions: [{ question: 'Pick one', options: [{ label: 'A' }] }],
      answers: { 'Pick one': 'A' },
    })];
    expect(buildPendingQuestionAnswerFromTranscript(msgs, 'hi')).toBeNull();
  });

  it('returns null when no AskUserQuestion message is present', () => {
    const msgs = [{ role: 'tool' as const, toolName: 'Read', toolUseId: 't', toolInput: {} }];
    expect(buildPendingQuestionAnswerFromTranscript(msgs, 'hi')).toBeNull();
  });

  it('returns null for blank text', () => {
    const msgs = [tool('q1', { questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] })];
    expect(buildPendingQuestionAnswerFromTranscript(msgs, '  ')).toBeNull();
  });

  it('picks the most recent unanswered card', () => {
    const msgs = [
      tool('old', { questions: [{ question: 'Old', options: [{ label: 'A' }] }] }),
      tool('new', { questions: [{ question: 'New', options: [{ label: 'B' }] }] }),
    ];
    expect(buildPendingQuestionAnswerFromTranscript(msgs, 'z')).toEqual({
      toolUseId: 'new',
      answers: { New: 'z' },
    });
  });
});
