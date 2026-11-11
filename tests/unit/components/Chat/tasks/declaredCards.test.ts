import { describe, it, expect } from 'vitest';
import { deriveDeclaredCards } from '../../../../../src/components/Chat/tasks/declaredCards';
import type { ChatMessage, ToolCall } from '../../../../../src/types';

let n = 0;
const call = (input: unknown, name = 'sai_task'): ToolCall => ({
  type: 'mcp', name, input: typeof input === 'string' ? input : JSON.stringify(input),
});
const msg = (calls: ToolCall[] | undefined, ts: number, content = '', id?: string): ChatMessage => ({
  id: id ?? `m${++n}`, role: 'assistant', content, timestamp: ts, toolCalls: calls,
});
const create = (tasks: any[]) => ({ action: 'create', tasks });
const upd = (o: any) => ({ action: 'update', ...o });

describe('deriveDeclaredCards', () => {
  it('create makes queued cards with pending steps', () => {
    const r = deriveDeclaredCards([msg([call(create([
      { id: 'a', title: 'A', steps: ['1', '2', '3'] }, { id: 'b', title: 'B', steps: ['x', 'y'] },
    ]))], 100)]);
    expect(r.cards.map((c) => c.status)).toEqual(['queued', 'queued']);
    expect(r.cards.map((c) => c.totalCount)).toEqual([3, 2]);
    expect(r.cards[0].steps.every((s) => s.state === 'pending')).toBe(true);
    expect(r.batchStartedAt).toBe(100);
  });

  it('create accepts a per-task agent string', () => {
    const r = deriveDeclaredCards([msg([call(create([
      { id: 'a', title: 'A', steps: ['1'] },
      { id: 'b', title: 'B', steps: ['x'], agent: 'List files' },
      { id: 'c', title: 'C', steps: ['y'], agent: 42 },
    ]))], 100)]);
    expect(r.cards.map((c) => c.agent?.description ?? null)).toEqual([null, 'List files', null]);
    expect(r.cards[1].agent).toEqual({ description: 'List files', toolUseId: null, taskId: null });
  });

  it('running with step marks earlier steps done', () => {
    const steps = ['s0', 's1', 's2', 's3', 's4'];
    const r = deriveDeclaredCards([
      msg([call(create([{ id: 'a', title: 'A', steps }]))], 1),
      msg([call(upd({ id: 'a', status: 'running', step: 2 }))], 2),
    ]);
    const c = r.cards[0];
    expect(c.doneCount).toBe(2);
    expect(c.currentLabel).toBe('s2');
    expect(c.status).toBe('running');
    expect(c.startedAt).toBe(2);
  });

  it('done sets result and endedAt; failed keeps steps', () => {
    const r = deriveDeclaredCards([
      msg([call(create([{ id: 'a', title: 'A', steps: ['1', '2'] }, { id: 'b', title: 'B', steps: ['1', '2'] }]))], 1),
      msg([call(upd({ id: 'a', status: 'done', note: 'ok' })), call(upd({ id: 'b', status: 'running', step: 1 })), call(upd({ id: 'b', status: 'failed' }))], 5),
    ]);
    const [a, b] = r.cards;
    expect(a.status).toBe('done'); expect(a.doneCount).toBe(2); expect(a.result).toBe('ok'); expect(a.endedAt).toBe(5);
    expect(b.status).toBe('failed'); expect(b.result).toBe('Failed'); expect(b.doneCount).toBe(1); expect(b.steps[1].state).toBe('current');
  });

  it('create after all done starts a new batch; create while one running appends', () => {
    const base = [
      msg([call(create([{ id: 'a', title: 'A', steps: ['1'] }]))], 1),
      msg([call(upd({ id: 'a', status: 'running' }))], 2),
      msg([call(create([{ id: 'b', title: 'B', steps: ['1'] }]))], 3),
    ];
    expect(deriveDeclaredCards(base).cards.map((c) => c.id)).toEqual(['a', 'b']);
    const r = deriveDeclaredCards([
      ...base,
      msg([call(upd({ id: 'a', status: 'done' })), call(upd({ id: 'b', status: 'done' }))], 4),
      msg([call(create([{ id: 'c', title: 'C', steps: ['1'] }]))], 9),
    ]);
    expect(r.cards.map((c) => c.id)).toEqual(['c']);
    expect(r.batchStartedAt).toBe(9);
  });

  it('attributes assistant messages to the active inline card only', () => {
    const r = deriveDeclaredCards([
      msg([call(create([{ id: 'a', title: 'A', steps: ['1'] }, { id: 'b', title: 'B', steps: ['1'] }, { id: 'c', title: 'C', steps: ['1'] }]))], 1, '', 'm0'),
      msg(undefined, 2, 'before', 'pre'),
      msg([call(upd({ id: 'a', status: 'running' }))], 3, '', 'ra'),
      msg(undefined, 4, 'work a', 'wa'),
      msg([call(upd({ id: 'a', status: 'running', step: 0 }))], 5, '', 'ra2'),
      msg([call({ action: 'update', id: 'b', status: 'running' })], 6, '', 'rb'),
      msg([{ type: 'file_read', name: 'Read', input: '{}' }], 7, '', 'wb'),
      msg([call(upd({ id: 'c', status: 'running', agent: 'x' })), call(upd({ id: 'c', agent: 'sub' }))], 8, '', 'rc'),
      msg(undefined, 9, 'after c', 'wc'),
    ]);
    const by = Object.fromEntries(r.cards.map((c) => [c.id, c]));
    expect(by.a.messageIds).toEqual(['wa']);
    expect(by.b.messageIds).toEqual(['wb']);
    expect(by.c.messageIds).toEqual([]);
    expect(by.c.agent).toEqual({ description: 'sub', toolUseId: null, taskId: null });
    expect(r.activeInlineId).toBeNull();
  });

  it('clears activeInlineId when the card finishes', () => {
    const r = deriveDeclaredCards([
      msg([call(create([{ id: 'a', title: 'A', steps: ['1'] }]))], 1),
      msg([call(upd({ id: 'a', status: 'running' }))], 2),
    ]);
    expect(r.activeInlineId).toBe('a');
  });

  it('ignores malformed calls without throwing', () => {
    const good = [
      msg([call(create([{ id: 'a', title: 'A', steps: ['1', '2'] }]))], 1),
      msg([call(upd({ id: 'a', status: 'running', step: 1 }))], 2),
    ];
    const bad = [
      msg([call(create([{ id: 'a', title: 'A', steps: ['1', '2'] }]))], 1),
      msg([
        call(upd({ id: 'zzz', status: 'done' })),
        call(create([{ id: 'a', title: 'dup', steps: ['q'] }])),
        call(create([{ id: 'd', title: 42, steps: [] }])),
        call('{bad json'),
        call(upd({ id: 'a', status: 'running', step: 99, note: 5, agent: 7 })),
      ], 2),
    ];
    expect(deriveDeclaredCards(bad)).toEqual(deriveDeclaredCards(good));
  });

  it('drops non-string step labels', () => {
    const r = deriveDeclaredCards([
      msg([call(create([{ id: 'a', title: 'A', steps: ['1', 2, null] }]))], 1),
      msg([call(upd({ id: 'a', add_steps: ['x', {}] }))], 2),
    ]);
    expect(r.cards[0].steps.map((s) => s.label)).toEqual(['1', 'x']);
  });

  describe('abandoned batch', () => {
    const userMsg = (ts: number): ChatMessage => ({ id: `u${++n}`, role: 'user', content: 'next thing', timestamp: ts });
    const first = () => [
      msg([call(create([{ id: 'a', title: 'A', steps: ['1'] }]))], 1),
      msg([call(upd({ id: 'a', status: 'running' }))], 2),
    ];

    it('a user message after a never-finished inline card lets the next create start a new batch', () => {
      const r = deriveDeclaredCards([...first(), userMsg(3), msg([call(create([{ id: 'b', title: 'B', steps: ['x'] }]))], 4)]);
      expect(r.cards.map((c) => c.id)).toEqual(['b']);
      expect(r.batchStartedAt).toBe(4);
      expect(r.activeInlineId).toBeNull();
    });

    it('without a user message the create appends to the running batch', () => {
      const r = deriveDeclaredCards([...first(), msg([call(create([{ id: 'b', title: 'B', steps: ['x'] }]))], 4)]);
      expect(r.cards.map((c) => c.id)).toEqual(['a', 'b']);
      expect(r.batchStartedAt).toBe(1);
    });

    it('a user message only counts since the last sai_task call', () => {
      const r = deriveDeclaredCards([
        ...first(), userMsg(3),
        msg([call(upd({ id: 'a', status: 'running', step: 0 }))], 4),
        msg([call(create([{ id: 'b', title: 'B', steps: ['x'] }]))], 5),
      ]);
      expect(r.cards.map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('an unfinished agent card keeps the batch open across a user message', () => {
      const r = deriveDeclaredCards([
        msg([call(create([{ id: 'a', title: 'A', steps: ['1'], agent: 'Research' }]))], 1),
        userMsg(2),
        msg([call(create([{ id: 'b', title: 'B', steps: ['x'] }]))], 3),
      ]);
      expect(r.cards.map((c) => c.id)).toEqual(['a', 'b']);
      expect(r.batchStartedAt).toBe(1);
    });
  });
});
