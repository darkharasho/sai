import { describe, it, expect } from 'vitest';
import { transcriptToChatMessages } from '../../../../../src/components/Chat/tasks/transcript';

const asst = (uuid: string, content: unknown) => ({ type: 'assistant', uuid, message: { role: 'assistant', content } });
const user = (uuid: string, content: unknown) => ({ type: 'user', uuid, message: { role: 'user', content } });

describe('transcriptToChatMessages', () => {
  it('converts assistant text and tool_use into one ChatMessage', () => {
    const out = transcriptToChatMessages([
      asst('u1', [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b.ts' } }]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('u1');
    expect(out[0].content).toBe('hi');
    expect(out[0].toolCalls![0]).toMatchObject({ id: 't1', type: 'file_read', name: 'Read' });
  });

  it('fills tool output from a later tool_result', () => {
    const use = asst('u1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]);
    let out = transcriptToChatMessages([use, user('u2', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }])]);
    expect(out[0].toolCalls![0].output).toBe('ok');
    out = transcriptToChatMessages([use, user('u2', [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }] }])]);
    expect(out[0].toolCalls![0].output).toBe('ok');
  });

  it('tolerates non-object message and non-string inputs', () => {
    const out = transcriptToChatMessages([
      { type: 'assistant', uuid: 'a', message: null },
      asst('b', [{ type: 'tool_use', id: 't', name: 'Bash', input: 42 }]),
    ]);
    expect(Array.isArray(out)).toBe(true);
    expect(out[0].toolCalls![0].input).toBe('');
  });

  it('keeps plain user text as a user message', () => {
    const out = transcriptToChatMessages([user('u', 'do it')]);
    expect(out).toEqual([expect.objectContaining({ id: 'u', role: 'user', content: 'do it' })]);
  });
});
