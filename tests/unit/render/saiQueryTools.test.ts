import { describe, it, expect } from 'vitest';
import { inspectElement } from '../../../src/render/saiQueryTools';
import { handleSaiQueryToolRequest } from '../../../src/render/saiQueryTools';

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

describe('handleSaiQueryToolRequest', () => {
  it('returns null for a tool it does not own (so App can fall through)', async () => {
    const r = await handleSaiQueryToolRequest({ tool: 'render_html', input: {} }, {});
    expect(r).toBeNull();
  });

  it('handles inspect_element by returning the inspect result', async () => {
    const el = document.createElement('div');
    el.id = 'q';
    document.body.appendChild(el);
    const r = await handleSaiQueryToolRequest({ tool: 'inspect_element', input: { selector: '#q' } }, {});
    expect(r).not.toBeNull();
    expect((r as any).found).toBe(true);
    document.body.removeChild(el);
  });

  it('handles capture_app by returning an __mcpImage from the injected captureRegion', async () => {
    const captureRegion = async () => 'AAAA';
    const r = await handleSaiQueryToolRequest({ tool: 'capture_app', input: {} }, { captureRegion });
    expect(r).toMatchObject({ ok: true, __mcpImage: { base64: 'AAAA', mimeType: 'image/png' } });
  });

  it('capture_app returns an error result when capture yields nothing', async () => {
    const captureRegion = async () => null;
    const r = await handleSaiQueryToolRequest({ tool: 'capture_app', input: {} }, { captureRegion });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/capture/i);
  });

  it('capture_app with a selector captures that element rect', async () => {
    const el = document.createElement('div');
    el.id = 'shot';
    document.body.appendChild(el);
    let passedRect: any = null;
    const captureRegion = async (rect: any) => { passedRect = rect; return 'BBBB'; };
    const r = await handleSaiQueryToolRequest({ tool: 'capture_app', input: { selector: '#shot' } }, { captureRegion });
    expect((r as any).__mcpImage.base64).toBe('BBBB');
    expect(passedRect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
    document.body.removeChild(el);
  });
});
