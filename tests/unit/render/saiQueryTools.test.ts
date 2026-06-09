import { describe, it, expect } from 'vitest';
import { inspectElement } from '../../../src/render/saiQueryTools';

describe('inspectElement', () => {
  it('returns found:false for a selector that matches nothing', () => {
    const r = inspectElement({ selector: '.does-not-exist' });
    expect(r.found).toBe(false);
    expect(r.rect).toBeUndefined();
  });

  it('returns the rect and a default set of computed styles for a match', () => {
    const el = document.createElement('div');
    el.id = 'target';
    el.style.display = 'flex';
    el.style.color = 'rgb(1, 2, 3)';
    document.body.appendChild(el);

    const r = inspectElement({ selector: '#target' });
    expect(r.found).toBe(true);
    expect(r.rect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
    expect(r.computed?.display).toBe('flex');
    expect(r.computed?.color).toBe('rgb(1, 2, 3)');
    expect(r.computed).toHaveProperty('flex-shrink');

    document.body.removeChild(el);
  });

  it('returns only the requested props when props[] is given', () => {
    const el = document.createElement('span');
    el.id = 'only';
    el.style.opacity = '0.5';
    document.body.appendChild(el);

    const r = inspectElement({ selector: '#only', props: ['opacity'] });
    expect(Object.keys(r.computed ?? {})).toEqual(['opacity']);
    expect(r.computed?.opacity).toBe('0.5');

    document.body.removeChild(el);
  });

  it('returns an error for an invalid selector instead of throwing', () => {
    const r = inspectElement({ selector: '###' });
    expect(r.found).toBe(false);
    expect(r.error).toMatch(/selector/i);
  });
});
