import { describe, it, expect, beforeEach } from 'vitest';
import { renderStore, type RenderEntry } from '../../../src/render/renderStore';

beforeEach(() => renderStore._resetForTests());

describe('renderStore', () => {
  it('upserts an entry and exposes it by id', () => {
    const entry: RenderEntry = { renderId: 'r1', kind: 'html', payload: { html: '<b>hi</b>' }, title: 'T', width: 360, status: 'rendering' };
    renderStore.upsert(entry);
    expect(renderStore.get('r1')).toEqual(entry);
  });

  it('merges status updates onto an existing entry', () => {
    renderStore.upsert({ renderId: 'r1', kind: 'html', payload: { html: 'x' }, title: 'T', width: 360, status: 'rendering' });
    renderStore.patch('r1', { status: 'ready' });
    expect(renderStore.get('r1')?.status).toBe('ready');
    expect(renderStore.get('r1')?.payload).toEqual({ html: 'x' });
  });

  it('notifies subscribers on change', () => {
    let count = 0;
    const unsub = renderStore.subscribe(() => { count++; });
    renderStore.upsert({ renderId: 'r1', kind: 'html', payload: { html: 'x' }, title: 'T', width: 360, status: 'rendering' });
    expect(count).toBe(1);
    unsub();
    renderStore.patch('r1', { status: 'ready' });
    expect(count).toBe(1);
  });

  it('tracks the active (most recently upserted) render id', () => {
    renderStore.upsert({ renderId: 'a', kind: 'html', payload: { html: '' }, title: '', width: 360, status: 'ready' });
    renderStore.upsert({ renderId: 'b', kind: 'html', payload: { html: '' }, title: '', width: 360, status: 'ready' });
    expect(renderStore.activeId()).toBe('b');
  });
});
