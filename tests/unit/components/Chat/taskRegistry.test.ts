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
});
