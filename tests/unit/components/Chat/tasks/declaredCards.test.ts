import { describe, it, expect } from 'vitest';
import { deriveDeclaredCards, itemKey, taskTag } from '../../../../../src/components/Chat/tasks/declaredCards';
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

  it('attributes assistant messages to the last-tagged card, including agent cards', () => {
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
    // An agent card is tagged too; the renderer prefers its transcript when it has one.
    expect(by.c.messageIds).toEqual(['wc']);
    expect(by.c.agent).toEqual({ description: 'sub', toolUseId: null, taskId: null });
    expect(r.activeCardId).toBe('c');
  });

  it('a bare update re-tags without changing the card', () => {
    const base = [
      msg([call(create([{ id: 'a', title: 'A', steps: ['1'] }, { id: 'b', title: 'B', steps: ['1'] }]))], 1, '', 'm0'),
      msg([call(upd({ id: 'a', status: 'running' }))], 2, '', 'ra'),
      msg(undefined, 3, 'work a', 'wa'),
      msg([call(upd({ id: 'b' }))], 4, '', 'tb'),
      msg(undefined, 5, 'work b', 'wb'),
    ];
    const r = deriveDeclaredCards(base);
    const by = Object.fromEntries(r.cards.map((c) => [c.id, c]));
    expect(by.a.messageIds).toEqual(['wa']);
    expect(by.b.messageIds).toEqual(['wb']);
    expect(by.a.status).toBe('running');
    expect(by.b.status).toBe('queued'); // re-tagging alone does not start it
    expect(r.activeCardId).toBe('b');
  });

  it('tags the card on update and untags it when it finishes', () => {
    const start = [
      msg([call(create([{ id: 'a', title: 'A', steps: ['1'] }]))], 1),
      msg([call(upd({ id: 'a', status: 'running' }))], 2),
    ];
    expect(deriveDeclaredCards(start).activeCardId).toBe('a');
    expect(deriveDeclaredCards([...start, msg([call(upd({ id: 'a', status: 'done' }))], 3)]).activeCardId).toBeNull();
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
    // Tags are keyed per item, so compare everything but the tag map.
    const strip = ({ tags: _t, ...rest }: ReturnType<typeof deriveDeclaredCards>) => rest;
    expect(strip(deriveDeclaredCards(bad))).toEqual(strip(deriveDeclaredCards(good)));
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
      expect(r.activeCardId).toBeNull();
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
  describe('per-item tags', () => {
    const user = (ts: number, extra: Partial<ChatMessage> = {}): ChatMessage =>
      ({ id: `u${++n}`, role: 'user', content: 'hi', timestamp: ts, ...extra });
    const two = () => msg([call(create([{ id: 't1', title: 'One', steps: ['a'] }, { id: 't2', title: 'Two', steps: ['b'] }]))], 100);

    it('tags the sai_task switch call with the task it switches to', () => {
      const sw = call(upd({ id: 't2', status: 'running' }));
      sw.id = 'tu-sw';
      const m = msg([sw], 101);
      const r = deriveDeclaredCards([two(), m]);
      expect(r.tags.get(itemKey(m.id, 'tu-sw'))).toBe(taskTag(100, 't2'));
      expect(r.activeTag).toBe(taskTag(100, 't2'));
    });

    it('per-item granularity', () => {
      const bash: ToolCall = { id: 'b1', type: 'terminal_command', name: 'Bash', input: '{}' };
      const sw = { ...call(upd({ id: 't2', status: 'running' })), id: 's1' };
      const read: ToolCall = { id: 'r1', type: 'file_read', name: 'Read', input: '{}' };
      const m = msg([bash, sw, read], 102, 'doing');
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), m]);
      expect(r.tags.get(itemKey(m.id))).toBe(taskTag(100, 't1'));
      expect(r.tags.get(itemKey(m.id, 'b1'))).toBe(taskTag(100, 't1'));
      expect(r.tags.get(itemKey(m.id, 's1'))).toBe(taskTag(100, 't2'));
      expect(r.tags.get(itemKey(m.id, 'r1'))).toBe(taskTag(100, 't2'));
    });

    it('falls back to the call index for id-less tool calls', () => {
      const read: ToolCall = { type: 'file_read', name: 'Read', input: '{}' };
      const m = msg([call(upd({ id: 't1', status: 'running' })), read], 101);
      const r = deriveDeclaredCards([two(), m]);
      expect(itemKey(m.id, undefined, 1)).toBe(`${m.id}#1`);
      expect(r.tags.get(`${m.id}#1`)).toBe(taskTag(100, 't1'));
      expect(r.tags.get(`${m.id}#0`)).toBe(taskTag(100, 't1'));
    });

    it('user message clears the active task', () => {
      const u = user(102);
      const t = msg(undefined, 103, 'text');
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), u, t]);
      expect(r.tags.get(itemKey(u.id))).toBeNull();
      expect(r.tags.get(itemKey(t.id))).toBeNull();
      expect(r.activeTag).toBeNull();
      expect(r.activeCardId).toBeNull();
    });

    it('reply to a tagged pending question keeps the task', () => {
      const ask: ToolCall = { id: 'q1', type: 'question', name: 'AskUserQuestion', input: '{}' };
      const u = user(103);
      const t = msg(undefined, 104, 'text');
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), msg([ask], 102), u, t]);
      expect(r.tags.get(itemKey(u.id))).toBe(taskTag(100, 't1'));
      expect(r.tags.get(itemKey(t.id))).toBe(taskTag(100, 't1'));
    });

    it('an answered question does not capture the next user message', () => {
      const ask: ToolCall = { id: 'q1', type: 'question', name: 'AskUserQuestion', input: '{}', output: 'answered' };
      const u = user(103);
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), msg([ask], 102), u]);
      expect(r.tags.get(itemKey(u.id))).toBeNull();
    });

    it('done clears; switching moves', () => {
      const fin = { ...call(upd({ id: 't1', status: 'done' })), id: 'f1' };
      const m = msg([fin], 102);
      const t = msg(undefined, 103, 'text');
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), m, t]);
      expect(r.tags.get(itemKey(m.id, 'f1'))).toBe(taskTag(100, 't1'));
      expect(r.tags.get(itemKey(t.id))).toBeNull();
      const s = msg(undefined, 104, 'more');
      const r2 = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), msg([call(upd({ id: 't2', status: 'running' }))], 102), s]);
      expect(r2.tags.get(itemKey(s.id))).toBe(taskTag(100, 't2'));
    });

    it('create does not change the active task', () => {
      const c = { ...call(create([{ id: 't3', title: 'Three' }])), id: 'c3' };
      const m = msg([c], 102);
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), m]);
      expect(r.tags.get(itemKey(m.id, 'c3'))).toBe(taskTag(100, 't1'));
      expect(r.activeCardId).toBe('t1');
    });

    it('system rows are null and never change active', () => {
      const sys: ChatMessage = { id: 'sys1', role: 'system', content: 'note', timestamp: 102 };
      const t = msg(undefined, 103, 'text');
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), sys, t]);
      expect(r.tags.get('sys1')).toBeNull();
      expect(r.tags.get(itemKey(t.id))).toBe(taskTag(100, 't1'));
    });

    it('batch-scoped tags', () => {
      const ta = msg(undefined, 3, 'a text');
      const tb = msg(undefined, 13, 'b text');
      const r = deriveDeclaredCards([
        msg([call(create([{ id: 't1', title: 'A' }]))], 1),
        msg([call(upd({ id: 't1', status: 'running' }))], 2),
        ta,
        msg([call(upd({ id: 't1', status: 'done' }))], 4),
        user(5),
        msg([call(create([{ id: 't1', title: 'B' }]))], 11),
        msg([call(upd({ id: 't1', status: 'running' }))], 12),
        tb,
      ]);
      const a = r.tags.get(itemKey(ta.id));
      const b = r.tags.get(itemKey(tb.id));
      expect(a).not.toBe(b);
      expect(a!.startsWith('1:')).toBe(true);
      expect(b!.startsWith('11:')).toBe(true);
      expect(r.cards[0].messageIds).toEqual([tb.id]);
    });

    it('stored tags win', () => {
      const t: ChatMessage = { ...msg(undefined, 102, 'text'), taskId: null };
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), t]);
      expect(r.tags.get(itemKey(t.id))).toBeNull();
      expect(r.activeCardId).toBe('t1');
    });

    it('a stored string tag on a user message makes it active', () => {
      const u = user(102, { taskId: taskTag(100, 't2') });
      const t = msg(undefined, 103, 'text');
      const r = deriveDeclaredCards([two(), u, t]);
      expect(r.tags.get(itemKey(u.id))).toBe(taskTag(100, 't2'));
      expect(r.tags.get(itemKey(t.id))).toBe(taskTag(100, 't2'));
      expect(r.activeCardId).toBe('t2');
    });

    it('a stored tag on a tool call wins', () => {
      const read: ToolCall = { id: 'r1', type: 'file_read', name: 'Read', input: '{}', taskId: taskTag(100, 't2') };
      const m = msg([read], 102);
      const r = deriveDeclaredCards([two(), msg([call(upd({ id: 't1', status: 'running' }))], 101), m]);
      expect(r.tags.get(itemKey(m.id, 'r1'))).toBe(taskTag(100, 't2'));
    });

    it('steps optional', () => {
      let r!: ReturnType<typeof deriveDeclaredCards>;
      expect(() => { r = deriveDeclaredCards([msg([call(create([{ id: 't1', title: 'No steps' }]))], 1)]); }).not.toThrow();
      expect(r.cards).toHaveLength(1);
      expect(r.cards[0].steps).toEqual([]);
      expect(r.cards[0].totalCount).toBe(0);
    });
  });
});
