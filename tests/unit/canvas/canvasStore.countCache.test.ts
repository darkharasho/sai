import { describe, it, expect, vi } from 'vitest';
import * as diff from '../../../src/canvas/canvasDiff';
import { createCanvasStore } from '../../../src/canvas/canvasStore';

vi.mock('../../../src/canvas/canvasDiff', async (orig) => {
  const m = await orig<typeof import('../../../src/canvas/canvasDiff')>();
  return { ...m, countUserEdits: vi.fn(m.countUserEdits) };
});

const P = '/ws/.sai/canvas/plan.md';

describe('pendingChangeCount caching', () => {
  it('re-diffs only when the content or the chat\'s seen snapshot changes; emits are added live', async () => {
    const store = createCanvasStore({ writeFile: async () => {}, now: () => Date.now() });
    await store.onDiskChange(P, '- [ ] a\n', true);
    store.markDelivered(P, 'c');
    await store.userWrite(P, '- [x] a\n');
    const count = vi.mocked(diff.countUserEdits);
    count.mockClear();
    expect(store.pendingChangeCount(P, 'c')).toBe(1);
    expect(store.pendingChangeCount(P, 'c')).toBe(1);
    store.userEmit(P, 'w', 1);
    expect(store.pendingChangeCount(P, 'c')).toBe(2);
    expect(count).toHaveBeenCalledTimes(1);
    // Delivery moves the chat's seen snapshot: recount.
    store.markDelivered(P, 'c');
    expect(store.pendingChangeCount(P, 'c')).toBe(0);
    expect(count).toHaveBeenCalledTimes(2);
    // New content: recount.
    await store.userWrite(P, '- [ ] a\n');
    expect(store.pendingChangeCount(P, 'c')).toBe(1);
    expect(count).toHaveBeenCalledTimes(3);
  });
});
