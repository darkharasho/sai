import { describe, it, expect } from 'vitest';
import {
  effectiveTag, filterMessagesForTask, mergeFeed, nowLabel, taskChips,
} from '../../../../../src/components/Chat/tasks/taskFeed';
import { itemKey } from '../../../../../src/components/Chat/tasks/declaredCards';
import type { ChatMessage, ToolCall } from '../../../../../src/types';

const T1 = '100:t1';
const T2 = '100:t2';
const tool = (id: string | undefined, name: string, over: Partial<ToolCall> = {}): ToolCall => ({
  id, type: 'other', name, input: '{}', output: 'ok', ...over,
});
const asst = (id: string, ts: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: 'assistant', content: '', timestamp: ts, ...over,
});

describe('effectiveTag', () => {
  it('prefers a stored tag, including stored null, over the computed one', () => {
    expect(effectiveTag(T1, T2)).toBe(T1);
    expect(effectiveTag(null, T2)).toBeNull();
    expect(effectiveTag(undefined, T2)).toBe(T2);
    expect(effectiveTag(undefined, undefined)).toBeNull();
  });
});

describe('filterMessagesForTask', () => {
  it('filters a mixed message to the task\'s tool calls', () => {
    const m = asst('m1', 5, {
      content: 'switching over', reasoning: 'hmm', taskId: T1,
      toolCalls: [tool('a', 'Bash', { taskId: T1 }), tool('b', 'Read', { taskId: T2 }), tool('c', 'Grep', { taskId: T2 })],
    });
    const input = [m];
    const snapshot = JSON.parse(JSON.stringify(input));

    const t2 = filterMessagesForTask(input, T2, new Map());
    expect(t2).toHaveLength(1);
    expect(t2[0].toolCalls!.map((c) => c.id)).toEqual(['b', 'c']);
    expect(t2[0].content).toBe('');
    expect(t2[0].reasoning).toBe('');

    const t1 = filterMessagesForTask(input, T1, new Map());
    expect(t1[0].content).toBe('switching over');
    expect(t1[0].reasoning).toBe('hmm');
    expect(t1[0].toolCalls!.map((c) => c.id)).toEqual(['a']);

    expect(filterMessagesForTask(input, '100:t3', new Map())).toEqual([]);
    // Never mutates its input; returns new objects.
    expect(input).toEqual(snapshot);
    expect(t1[0]).not.toBe(m);
  });

  it('keeps items whose only tag is computed (legacy)', () => {
    const legacy = asst('m1', 1, { content: 'legacy text', toolCalls: [tool(undefined, 'Bash'), tool('x', 'Read')] });
    const stampedNull = asst('m2', 2, { content: 'stamped untagged', taskId: null });
    const computed = new Map<string, string | null>([
      [itemKey('m1'), T1],
      [itemKey('m1', undefined, 0), T1],
      [itemKey('m1', 'x', 1), T2],
      // Stored null wins over a computed tag.
      [itemKey('m2'), T1],
    ]);
    const out = filterMessagesForTask([legacy, stampedNull], T1, computed);
    expect(out.map((m) => m.id)).toEqual(['m1']);
    expect(out[0].content).toBe('legacy text');
    expect(out[0].toolCalls!.map((c) => c.name)).toEqual(['Bash']);
  });

  it('keeps a user message tagged to the task', () => {
    const u: ChatMessage = { id: 'u1', role: 'user', content: 'pg please', timestamp: 3, taskId: T1 };
    expect(filterMessagesForTask([u], T1, new Map()).map((m) => m.content)).toEqual(['pg please']);
  });
});

describe('mergeFeed', () => {
  it('mergeFeed interleaves by timestamp', () => {
    const tagged = [asst('a', 10), asst('b', 30), asst('c', 30)];
    const transcript = [asst('x', 5), asst('y', 30), asst('z', 40)];
    expect(mergeFeed(tagged, transcript).map((m) => m.id)).toEqual(['x', 'a', 'b', 'c', 'y', 'z']);
    expect(mergeFeed(tagged, null).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('nowLabel', () => {
  it('nowLabel marks a running tool with an ellipsis', () => {
    const feed = [asst('m1', 1, { toolCalls: [tool('a', 'Bash', { input: JSON.stringify({ command: 'npx vitest run' }), output: undefined })] })];
    expect(nowLabel(feed)).toBe('$ npx vitest run…');
  });

  it('uses the latest line, without an ellipsis once it finished', () => {
    const feed = [
      asst('m1', 1, { content: 'Running the tests' }),
      asst('m2', 2, { toolCalls: [tool('a', 'Read', { input: JSON.stringify({ file_path: '/x/y/app.ts' }) })] }),
    ];
    expect(nowLabel(feed)).toBe('read app.ts');
  });

  it('ignores sai_task bookkeeping calls', () => {
    const feed = [
      asst('m1', 1, { content: 'Starting the login form' }),
      asst('m2', 2, { toolCalls: [tool('a', 'mcp__sai__sai_task', { input: JSON.stringify({ action: 'update', id: 't1', status: 'running' }) })] }),
    ];
    expect(nowLabel(feed)).toBe('Starting the login form');
  });

  it('is null for an empty feed', () => {
    expect(nowLabel([])).toBeNull();
  });
});

describe('taskChips', () => {
  const card = (id: string, tag: string, title: string): any => ({ id, tag, title });
  const cards = [card('t1', T1, 'One'), card('t2', T2, 'Two')];

  it('chips the first message of each run; untagged items do not reset the run', () => {
    const msgs = [
      asst('a', 1, { content: 'x', taskId: T1 }),
      asst('b', 2, { content: 'y', taskId: null }),
      asst('c', 3, { content: 'z', taskId: T1 }),
      asst('d', 4, { content: 'w', taskId: T2 }),
    ];
    const chips = taskChips(msgs, cards, new Map());
    expect([...chips.entries()]).toEqual([
      ['a', { title: 'One', colorIndex: 0 }],
      ['d', { title: 'Two', colorIndex: 1 }],
    ]);
  });

  it('ignores sai_task calls and empty text, and uses computed tags for legacy items', () => {
    const msgs = [
      asst('a', 1, { toolCalls: [tool('s1', 'mcp__sai__sai_task', { taskId: T2 })] }),
      asst('b', 2, { content: 'x' }),
    ];
    const chips = taskChips(msgs, cards, new Map([[itemKey('a'), T2], [itemKey('b'), T2]]));
    expect([...chips.keys()]).toEqual(['b']);
  });

  it('no chip for a tag outside the current batch, but it still counts as the previous tag', () => {
    const msgs = [
      asst('a', 1, { content: 'x', taskId: '50:old' }),
      asst('b', 2, { content: 'y', taskId: T1 }),
    ];
    expect([...taskChips(msgs, cards, new Map()).keys()]).toEqual(['b']);
    expect(taskChips(msgs, [], new Map()).size).toBe(0);
  });
});
