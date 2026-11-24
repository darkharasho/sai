import { describe, it, expect, vi } from 'vitest';
import { createCanvasStore } from '../../../src/canvas/canvasStore';

const P = '/ws/.sai/canvas/plan.md';

function setup() {
  const writes: Array<{ path: string; content: string }> = [];
  let t = 0;
  let failNext = false;
  const store = createCanvasStore({
    writeFile: async (path, content) => {
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      writes.push({ path, content });
    },
    now: () => ++t,
  });
  return { store, writes, failWrite: () => (failNext = true) };
}

/** Agent creates the canvas and it is delivered to chat `c`. */
async function seeded(initial: string) {
  const s = setup();
  await s.store.onDiskChange(P, initial, true);
  s.store.markDelivered(P, 'c');
  return s;
}

describe('canvasStore', () => {
  it('ignores echo of own write', async () => {
    const { store, writes } = setup();
    await store.userWrite(P, 'A\n');
    expect(writes).toHaveLength(1);
    await store.onDiskChange(P, 'A\n', true);
    expect(writes).toHaveLength(1);
    expect(store.get(P)?.lastEditor).toBe('user');
  });

  it('merge-back restores user tick once', async () => {
    const { store, writes } = await seeded('- [ ] a\n\nx\n');
    await store.userWrite(P, '- [x] a\n\nx\n');
    await store.onDiskChange(P, '- [x] a\n\nx\n', false); // echo
    expect(writes).toHaveLength(1);
    await store.onDiskChange(P, '- [ ] a\n\ny\n', true);
    expect(writes).toHaveLength(2);
    expect(writes[1].content).toContain('- [x] a');
    expect(writes[1].content).toContain('y');
    expect(writes[1].content).not.toContain('x\n\n');
    await store.onDiskChange(P, writes[1].content, true);
    expect(writes).toHaveLength(2);
    expect(store.get(P)?.content).toBe(writes[1].content);
    // The tick was never delivered, so it is still pending; the agent's y is not.
    const msg = store.pendingMessage(P, 'c')!;
    expect(msg).toContain('☑ "a"');
    expect(msg).not.toContain('edited block');
  });

  it('agent edits never pending', async () => {
    const { store } = await seeded('# T\n\nx\n');
    await store.onDiskChange(P, '# T\n\ny\n\nz\n', true);
    expect(store.pendingMessage(P, 'c')).toBeNull();
    expect(store.hasPending(P, 'c')).toBe(false);
    expect(store.get(P)?.lastEditor).toBe('agent');
  });

  it('external edit without agent is user', async () => {
    const { store, writes } = await seeded('- [ ] a\n');
    await store.onDiskChange(P, '- [x] a\n', false);
    expect(writes).toHaveLength(0);
    expect(store.get(P)?.lastEditor).toBe('user');
    expect(store.pendingMessage(P, 'c')).toContain('☑');
    expect(store.hasPending(P, 'c')).toBe(true);
  });

  it('first message to new chat is full content', async () => {
    const { store } = await seeded('- [ ] a\n');
    await store.onDiskChange(P, '- [x] a\n', false);
    const msg = store.pendingMessage(P, 'other')!;
    expect(msg).toContain('[Canvas update] .sai/canvas/plan.md');
    expect(msg).toContain('current content below');
    expect(msg).toContain('- [x] a');
  });

  it('delete clears state', async () => {
    const { store } = await seeded('- [ ] a\n');
    await store.onDiskChange(P, '- [x] a\n', false);
    await store.onDiskChange(P, null, false);
    expect(store.get(P)).toBeUndefined();
    expect(store.hasPending(P, 'c')).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('emits included then cleared by markDelivered', async () => {
    const { store } = await seeded('# T\n');
    store.userEmit(P, 'pick', { color: 'red' });
    const msg = store.pendingMessage(P, 'c')!;
    expect(msg).toContain('html "pick" sent: {"color":"red"}');
    store.markDelivered(P, 'c');
    expect(store.pendingMessage(P, 'c')).toBeNull();
  });

  it('R1: delivered edits are not re-reported after an agent write', async () => {
    const { store } = await seeded('- [ ] a\n\nx\n');
    await store.userWrite(P, '- [x] a\n\nx\n');
    store.markDelivered(P, 'c');
    await store.onDiskChange(P, '- [x] a\n\ny\n', true);
    expect(store.pendingMessage(P, 'c')).toBeNull();
    await store.onDiskChange(P, '- [x] a\n\ny\n\nnew stuff\n', false);
    const msg = store.pendingMessage(P, 'c')!;
    expect(msg).toContain('- + block 3: new stuff');
    expect(msg).not.toContain('☑');
    expect(msg).not.toContain('edited block');
  });

  it('R2: first sight is not a user edit', async () => {
    const { store } = setup();
    await store.onDiskChange(P, '# T\n', false);
    expect(store.get(P)?.lastEditor).toBe('user');
    expect(store.hasPending(P, 'c')).toBe(false);
    expect(store.takeAgentTouched()).toEqual([]);
  });

  it('R2: agent-live first sight is agent-touched once', async () => {
    const { store } = setup();
    await store.onDiskChange(P, '# T\n', true);
    expect(store.get(P)?.lastEditor).toBe('agent');
    expect(store.hasPending(P, 'c')).toBe(false);
    expect(store.takeAgentTouched()).toEqual([P]);
    expect(store.takeAgentTouched()).toEqual([]);
  });

  it('coalesced echo: only the later of two writes observed', async () => {
    const { store, writes } = await seeded('# T\n');
    await store.userWrite(P, '# T\n\na\n');
    await store.userWrite(P, '# T\n\nab\n');
    await store.onDiskChange(P, '# T\n\nab\n', true);
    expect(writes).toHaveLength(2);
    expect(store.get(P)?.lastEditor).toBe('user');
    expect(store.get(P)?.content).toBe('# T\n\nab\n');
    // The older entry was dropped too: seeing it later is a real (agent) change.
    await store.onDiskChange(P, '# T\n\na\n', true);
    expect(store.get(P)?.lastEditor).toBe('agent');
  });

  it('never-seen chat with no user edits has nothing pending', async () => {
    const { store } = await seeded('# T\n');
    await store.onDiskChange(P, '# T\n\nmore\n', true);
    expect(store.pendingMessage(P, 'other')).toBeNull();
    expect(store.hasPending(P, 'other')).toBe(false);
  });

  async function conflicted() {
    const s = await seeded('# T\n\nx\n');
    await s.store.userWrite(P, '# T\n\nmine\n');
    await s.store.onDiskChange(P, '# T\n\nagent\n', true);
    return s;
  }

  it('records a conflict keeping the user text', async () => {
    const { store, writes } = await conflicted();
    expect(store.get(P)?.conflicts).toEqual([{ index: 1, ours: 'mine', theirs: 'agent' }]);
    expect(writes.at(-1)!.content).toBe('# T\n\nmine\n');
  });

  it('resolveConflict theirs writes the agent block and drops the conflict', async () => {
    const { store, writes } = await conflicted();
    const n = writes.length;
    await store.resolveConflict(P, 1, 'theirs');
    expect(writes).toHaveLength(n + 1);
    expect(writes.at(-1)!.content).toBe('# T\n\nagent\n');
    expect(store.get(P)?.content).toBe('# T\n\nagent\n');
    expect(store.get(P)?.conflicts).toEqual([]);
    expect(store.get(P)?.lastEditor).toBe('user');
    await store.onDiskChange(P, '# T\n\nagent\n', true); // echo
    expect(writes).toHaveLength(n + 1);
  });

  it('resolveConflict ours just drops the conflict; unknown index is a no-op', async () => {
    const { store, writes } = await conflicted();
    const n = writes.length;
    await store.resolveConflict(P, 7, 'theirs');
    expect(store.get(P)?.conflicts).toHaveLength(1);
    await store.resolveConflict(P, 1, 'ours');
    expect(store.get(P)?.conflicts).toEqual([]);
    expect(store.get(P)?.content).toBe('# T\n\nmine\n');
    expect(writes).toHaveLength(n);
  });

  it('R8: repeated stale agent writes keep restoring an undelivered tick', async () => {
    const { store, writes } = await seeded('- [ ] a\n\nx\n');
    await store.userWrite(P, '- [x] a\n\nx\n');
    await store.onDiskChange(P, '- [x] a\n\nx\n', false); // echo
    await store.onDiskChange(P, '- [ ] a\n\ny\n', true); // D1
    expect(writes.at(-1)!.content).toBe('- [x] a\n\ny\n');
    const n = writes.length;
    await store.onDiskChange(P, '- [ ] a\n\nz\n', true); // D2 built from D1, still unticked
    expect(writes).toHaveLength(n + 1);
    expect(writes.at(-1)!.content).toBe('- [x] a\n\nz\n');
    expect(store.get(P)?.content).toBe('- [x] a\n\nz\n');
  });

  it('R8: agent untick of a delivered tick stands', async () => {
    const { store, writes } = await seeded('- [ ] a\n\nx\n');
    await store.userWrite(P, '- [x] a\n\nx\n');
    store.markDelivered(P, 'c');
    const n = writes.length;
    await store.onDiskChange(P, '- [ ] a\n\nx\n', true);
    expect(writes).toHaveLength(n);
    expect(store.get(P)?.content).toBe('- [ ] a\n\nx\n');
    expect(store.pendingMessage(P, 'c')).toBeNull();
  });

  it('R9: conflicts re-anchor when the user inserts a block before them', async () => {
    const { store, writes } = await conflicted();
    await store.userWrite(P, '# T\n\nnew\n\nmine\n');
    expect(store.get(P)?.conflicts).toEqual([{ index: 2, ours: 'mine', theirs: 'agent' }]);
    await store.resolveConflict(P, 2, 'theirs');
    expect(writes.at(-1)!.content).toBe('# T\n\nnew\n\nagent\n');
    expect(store.get(P)?.conflicts).toEqual([]);
  });

  it('R9: a conflict whose block the user removed is dropped', async () => {
    const { store } = await conflicted();
    await store.onDiskChange(P, '# T\n', false);
    expect(store.get(P)?.conflicts).toEqual([]);
  });

  it('R9: earlier conflicts survive a later agent write that keeps their block', async () => {
    const { store } = await conflicted();
    await store.onDiskChange(P, '# T2\n\nmine\n', true);
    expect(store.get(P)?.conflicts).toEqual([{ index: 1, ours: 'mine', theirs: 'agent' }]);
  });

  it('echo matches the newest copy: A->B->A then an agent write of B is real', async () => {
    const { store, writes } = await seeded('# T\n');
    await store.userWrite(P, '- [ ] a\n'); // A
    await store.userWrite(P, '- [x] a\n'); // B
    await store.userWrite(P, '- [ ] a\n'); // A again
    await store.onDiskChange(P, '- [ ] a\n', false); // only the final write observed
    store.markDelivered(P, 'c'); // the agent has seen A
    const n = writes.length;
    await store.onDiskChange(P, '- [x] a\n', true); // agent ticks
    expect(store.get(P)?.content).toBe('- [x] a\n');
    expect(store.get(P)?.lastEditor).toBe('agent');
    expect(writes).toHaveLength(n);
  });

  it('a non-echo change clears unobserved SAI writes', async () => {
    const { store } = await seeded('h\n\nx\n');
    await store.userWrite(P, 'H\n\nx\n'); // never observed
    await store.onDiskChange(P, 'Z\n', false); // disk moved past it
    store.markDelivered(P, 'c'); // the agent has seen Z
    await store.onDiskChange(P, 'H\n\nx\n', true); // agent writes exactly the old SAI content
    expect(store.get(P)?.content).toBe('H\n\nx\n');
    expect(store.get(P)?.lastEditor).toBe('agent');
  });

  it('a throwing subscriber does not abort merge-back', async () => {
    const { store, writes } = await seeded('- [ ] a\n\nx\n');
    await store.userWrite(P, '- [x] a\n\nx\n');
    await store.onDiskChange(P, '- [x] a\n\nx\n', false); // echo
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let other = 0;
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => other++);
    await store.onDiskChange(P, '- [ ] a\n\ny\n', true);
    expect(writes.at(-1)!.content).toBe('- [x] a\n\ny\n');
    expect(other).toBe(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('autoSend defaults on and can be toggled; subscribers fire', async () => {
    const { store } = setup();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    await store.onDiskChange(P, '# T\n', false);
    expect(store.get(P)?.autoSend).toBe(true);
    store.setAutoSend(P, false);
    expect(store.get(P)?.autoSend).toBe(false);
    expect(calls).toBe(2);
    off();
    store.setAutoSend(P, true);
    expect(calls).toBe(2);
  });

  it('get returns a stable snapshot until the canvas changes', async () => {
    const { store } = setup();
    await store.onDiskChange(P, '# T\n', false);
    const a = store.get(P);
    expect(store.get(P)).toBe(a);
    expect(store.list()).toBe(store.list());
    await store.onDiskChange(P, '# U\n', false);
    expect(store.get(P)).not.toBe(a);
  });

  it('userWrite rejection propagates but state stays updated', async () => {
    const { store, writes, failWrite } = await seeded('# T\n');
    failWrite();
    await expect(store.userWrite(P, '# T\n\nx\n')).rejects.toThrow('disk full');
    expect(store.get(P)?.content).toBe('# T\n\nx\n');
    expect(store.get(P)?.lastEditor).toBe('user');
    // The per-path chain is not poisoned: the next write goes through.
    await store.userWrite(P, '# T\n\nxy\n');
    expect(writes.at(-1)!.content).toBe('# T\n\nxy\n');
  });

  it('serializes a watcher event behind an in-flight merge-back', async () => {
    const writes: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = createCanvasStore({
      writeFile: async (_p, c) => {
        writes.push(c);
        if (writes.length === 2) await gate;
      },
      now: () => 0,
    });
    await store.onDiskChange(P, '- [ ] a\n\nx\n', true);
    store.markDelivered(P, 'c');
    await store.userWrite(P, '- [x] a\n\nx\n');
    const agent = store.onDiskChange(P, '- [ ] a\n\ny\n', true);
    const echo = store.onDiskChange(P, '- [x] a\n\ny\n', true);
    await Promise.resolve();
    release();
    await Promise.all([agent, echo]);
    expect(writes).toEqual(['- [x] a\n\nx\n', '- [x] a\n\ny\n']);
    expect(store.get(P)?.content).toBe('- [x] a\n\ny\n');
  });
});
