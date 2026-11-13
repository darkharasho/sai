import { describe, it, expect } from 'vitest';
import { stampTaskTags } from '../../../../../src/components/Chat/tasks/taskTags';
import { taskTag } from '../../../../../src/components/Chat/tasks/declaredCards';
import type { ChatMessage, ToolCall } from '../../../../../src/types';

const sai = (input: unknown, id?: string): ToolCall => ({ type: 'mcp', name: 'sai_task', id, input: JSON.stringify(input) });
const msg = (id: string, calls?: ToolCall[], content = '', ts = 100): ChatMessage => ({
  id, role: 'assistant', content, timestamp: ts, toolCalls: calls,
});
const create = sai({ action: 'create', tasks: [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }] }, 'c1');
const start = (id: string, task: string) => sai({ action: 'update', id: task, status: 'running' }, id);
const T1 = taskTag(100, 't1');
const T2 = taskTag(100, 't2');

describe('stampTaskTags', () => {
  it('stamps a new tool call with the active task', () => {
    const prev = [msg('m1', [create, start('u1', 't1')]), ];
    const stamped = stampTaskTags([], prev);
    const next = [...stamped, msg('m2', [{ type: 'bash', name: 'Bash', id: 'b1', input: '{}' }])];
    const out = stampTaskTags(stamped, next);
    expect(out[1].toolCalls![0].taskId).toBe(T1);
  });

  it('does not rewrite an existing tag when later history would change it', () => {
    const base = stampTaskTags([], [msg('m1', [create, start('u1', 't1')])]);
    const withText = stampTaskTags(base, [...base, msg('m2', undefined, 'hello')]);
    expect(withText[1].taskId).toBe(T1);
    const next = [...withText, msg('m3', [sai({ action: 'create', tasks: [{ id: 'z', title: 'Z' }] }, 'c2')], '', 500)];
    const out = stampTaskTags(withText, next);
    expect(out[1].taskId).toBe(T1);
    expect(out[0]).toBe(withText[0]);
  });

  it('session load is not stamped', () => {
    const prev = [msg('a'), msg('b')];
    const next = [msg('x', undefined, 'hi'), msg('y', undefined, 'yo')];
    const out = stampTaskTags(prev, next);
    expect(out).toBe(next);
    expect(out.map((m) => m.taskId)).toEqual([undefined, undefined]);
  });

  it('stamps a multi-message drain in order', () => {
    const base = stampTaskTags([], [msg('m0', [create, start('u1', 't1')])]);
    const next = [
      ...base,
      msg('m1', undefined, 'one'),
      msg('m2', [start('u2', 't2')]),
      msg('m3', undefined, 'three'),
    ];
    const out = stampTaskTags(base, next);
    expect([out[1].taskId, out[2].toolCalls![0].taskId, out[3].taskId]).toEqual([T1, T2, T2]);
  });

  it('result replacement keeps the tag', () => {
    const prev = [{ ...msg('m1', undefined, 'old'), taskId: T1 }];
    const next = [{ ...prev[0], content: 'new' }];
    const out = stampTaskTags(prev, next);
    expect(out).toBe(next);
    expect(out[0].taskId).toBe(T1);
  });

  it('returns the same reference when nothing is new', () => {
    const prev = stampTaskTags([], [msg('m1', undefined, 'a')]);
    const next = [{ ...prev[0], content: 'ab' }];
    expect(stampTaskTags(prev, next)).toBe(next);
  });

  it('does not mutate the input messages and writes null as stamped', () => {
    const next = [msg('m1', undefined, 'plain')];
    const out = stampTaskTags([], next);
    expect(next[0].taskId).toBeUndefined();
    expect(out[0].taskId).toBeNull();
  });
});
