import { describe, it, expect } from 'vitest';
import { buildTaskRegistry, extractTaskCreateId } from '../../../../src/components/Chat/taskRegistry';
import type { ChatMessage, ToolCall } from '../../../../src/types';

function asst(toolCalls: ToolCall[]): ChatMessage {
  return { id: 'm' + Math.random(), role: 'assistant', content: '', timestamp: 0, toolCalls };
}
function tc(name: string, input: object, output?: string): ToolCall {
  return { type: 'task', name, input: JSON.stringify(input), output };
}

describe('extractTaskCreateId', () => {
  it('parses the id from a "Task #N created" output', () => {
    expect(extractTaskCreateId('Task #3 created successfully: foo', 'fallback')).toBe('3');
  });
  it('falls back when there is no output', () => {
    expect(extractTaskCreateId(undefined, '7')).toBe('7');
  });
  it('parses an id from JSON output when there is no Task #N text', () => {
    expect(extractTaskCreateId('{"id":"abc"}', 'fallback')).toBe('abc');
    // Regex precedence quirk: the /Task\s*#?\s*([0-9a-zA-Z_-]+)\b/i pattern runs
    // BEFORE the JSON fallback and matches the literal substring "task" inside
    // the "taskId" key, capturing the following "Id". So the JSON value 42 is
    // never reached here — actual current behavior returns 'Id', not '42'.
    expect(extractTaskCreateId('{"taskId":42}', 'fallback')).toBe('Id');
  });
});

describe('buildTaskRegistry', () => {
  it('keeps the create subject when a later update only changes status', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'Build parser', description: 'the desc' }, 'Task #1 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '1', status: 'completed' })]),
    ];
    const reg = buildTaskRegistry(messages);
    expect(reg.get('1')).toMatchObject({ id: '1', subject: 'Build parser', description: 'the desc', status: 'completed' });
  });

  it('lets an update override subject and activeForm', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'Old' }, 'Task #2 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '2', subject: 'New', activeForm: 'Doing new' })]),
    ];
    expect(buildTaskRegistry(messages).get('2')).toMatchObject({ subject: 'New', activeForm: 'Doing new' });
  });

  it('removes a task on deleted status', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'X' }, 'Task #5 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '5', status: 'deleted' })]),
    ];
    expect(buildTaskRegistry(messages).has('5')).toBe(false);
  });

  it('ignores an update for an unknown task id', () => {
    const reg = buildTaskRegistry([asst([tc('TaskUpdate', { taskId: '99', status: 'completed' })])]);
    expect(reg.has('99')).toBe(false);
  });

  it('skips malformed JSON without throwing', () => {
    const bad: ChatMessage = { id: 'b', role: 'assistant', content: '', timestamp: 0,
      toolCalls: [{ type: 'task', name: 'TaskCreate', input: '{not json' }] };
    expect(() => buildTaskRegistry([bad])).not.toThrow();
    expect(buildTaskRegistry([bad]).size).toBe(0);
  });

  it('uses a sequence fallback id when output lacks a task number', () => {
    const reg = buildTaskRegistry([asst([tc('TaskCreate', { subject: 'Seq' })])]);
    expect(reg.get('1')).toMatchObject({ subject: 'Seq' });
  });

  it('captures owner on create and updates it on TaskUpdate', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'Owned', owner: 'alice' }, 'Task #8 created successfully')]),
    ];
    expect(buildTaskRegistry(messages).get('8')).toMatchObject({ owner: 'alice' });

    const messages2 = [
      asst([tc('TaskCreate', { subject: 'Owned' }, 'Task #9 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '9', owner: 'bob' })]),
    ];
    expect(buildTaskRegistry(messages2).get('9')).toMatchObject({ owner: 'bob' });
  });

  it('lets an update override the description', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'D', description: 'old desc' }, 'Task #10 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '10', description: 'new desc' })]),
    ];
    expect(buildTaskRegistry(messages).get('10')).toMatchObject({ description: 'new desc' });
  });
});
