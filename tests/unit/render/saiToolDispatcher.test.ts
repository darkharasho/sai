import { describe, it, expect, beforeEach } from 'vitest';
import { renderStore } from '../../../src/render/renderStore';
import { dispatchSaiRenderTool } from '../../../src/render/saiToolDispatcher';

beforeEach(() => renderStore._resetForTests());

describe('dispatchSaiRenderTool', () => {
  it('render_html upserts an html entry and returns ok with the renderId', () => {
    const res = dispatchSaiRenderTool('render_html', { html: '<b>hi</b>', title: 'T' }, 'rid-1');
    expect(res.ok).toBe(true);
    const e = renderStore.get('rid-1');
    expect(e?.kind).toBe('html');
    expect(e?.payload).toEqual({ html: '<b>hi</b>' });
    expect(e?.width).toBe(360); // default
  });

  it('render_html rejects missing html', () => {
    const res = dispatchSaiRenderTool('render_html', {}, 'rid-2');
    expect(res).toEqual({ ok: false, error: 'render_html requires a non-empty "html" string' });
    expect(renderStore.get('rid-2')).toBeUndefined();
  });

  it('render_component upserts a component entry for a known key', () => {
    const res = dispatchSaiRenderTool('render_component', { component: 'WorkspaceSquircle', props: { state: 'busy-done' } }, 'rid-3');
    expect(res.ok).toBe(true);
    expect(renderStore.get('rid-3')?.payload).toEqual({ component: 'WorkspaceSquircle', props: { state: 'busy-done' } });
  });

  it('render_component rejects unknown component and lists valid keys', () => {
    const res = dispatchSaiRenderTool('render_component', { component: 'Nope' }, 'rid-4');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('unknown component: Nope');
    expect(res.error).toContain('WorkspaceSquircle');
  });

  it('rejects an unknown tool name', () => {
    const res = dispatchSaiRenderTool('render_potato', {}, 'rid-5');
    expect(res).toEqual({ ok: false, error: 'unknown tool: render_potato' });
  });

  it('render_chart upserts an html entry built from chart input', () => {
    const res = dispatchSaiRenderTool(
      'render_chart',
      { chart: 'bar', labels: ['A', 'B'], values: [1, 2], title: 'Counts' },
      'rid-chart',
    );
    expect(res.ok).toBe(true);
    const e = renderStore.get('rid-chart');
    expect(e?.kind).toBe('html');
    expect(String(e?.payload.html)).toContain('<svg');
    expect(e?.title).toBe('Counts');
  });

  it('render_chart rejects a labels/values mismatch with an error result', () => {
    const res = dispatchSaiRenderTool('render_chart', { chart: 'bar', labels: ['A'], values: [1, 2] }, 'rid-bad');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/labels and values/i);
    expect(renderStore.get('rid-bad')).toBeUndefined();
  });

  it('render_diff rejects empty before/after strings', () => {
    const res = dispatchSaiRenderTool('render_diff', { before: '', after: '<i>y</i>' }, 'rid-empty');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/non-empty/i);
    expect(renderStore.get('rid-empty')).toBeUndefined();
  });

  it('render_diff upserts an html entry containing both snippets', () => {
    const res = dispatchSaiRenderTool('render_diff', { before: '<i>x</i>', after: '<i>y</i>' }, 'rid-diff');
    expect(res.ok).toBe(true);
    const e = renderStore.get('rid-diff');
    expect(e?.kind).toBe('html');
    expect(String(e?.payload.html)).toContain('<i>x</i>');
    expect(String(e?.payload.html)).toContain('<i>y</i>');
  });

  it('render_chart/render_diff default the title when none is given', () => {
    dispatchSaiRenderTool('render_chart', { chart: 'bar', labels: ['A'], values: [1] }, 'rid-ct');
    expect(renderStore.get('rid-ct')?.title).toBe('Chart');
    dispatchSaiRenderTool('render_diff', { before: 'a', after: 'b' }, 'rid-dt');
    expect(renderStore.get('rid-dt')?.title).toBe('Diff');
  });

  it('render_mermaid upserts a mermaid entry with the diagram payload', () => {
    const res = dispatchSaiRenderTool('render_mermaid', { diagram: 'graph TD; A-->B', title: 'Flow' }, 'rid-mmd');
    expect(res.ok).toBe(true);
    const e = renderStore.get('rid-mmd');
    expect(e?.kind).toBe('mermaid');
    expect(e?.payload).toEqual({ diagram: 'graph TD; A-->B' });
    expect(e?.title).toBe('Flow');
  });

  it('render_mermaid rejects a missing/empty diagram', () => {
    const res = dispatchSaiRenderTool('render_mermaid', { diagram: '' }, 'rid-mmd2');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/diagram/i);
    expect(renderStore.get('rid-mmd2')).toBeUndefined();
  });

  it('render_theme upserts a theme entry with components + vars', () => {
    const res = dispatchSaiRenderTool('render_theme', { vars: { '--accent': '#f00' }, components: ['WorkspaceSquircle'], title: 'T' }, 'rid-th');
    expect(res.ok).toBe(true);
    const e = renderStore.get('rid-th');
    expect(e?.kind).toBe('theme');
    expect(e?.payload).toEqual({ components: ['WorkspaceSquircle'], vars: { '--accent': '#f00' } });
    expect(e?.title).toBe('T');
  });

  it('render_theme defaults components to the full registry when omitted', () => {
    const res = dispatchSaiRenderTool('render_theme', { vars: { '--accent': '#f00' } }, 'rid-th2');
    expect(res.ok).toBe(true);
    const e = renderStore.get('rid-th2');
    expect((e?.payload as { components: string[] }).components).toContain('WorkspaceSquircle');
  });

  it('render_theme rejects a missing/non-object vars', () => {
    const res = dispatchSaiRenderTool('render_theme', { vars: 'nope' }, 'rid-th3');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/vars/i);
    expect(renderStore.get('rid-th3')).toBeUndefined();
  });

  it('render_theme includes props in the payload when provided', () => {
    dispatchSaiRenderTool('render_theme', { vars: { '--a': '1' }, components: ['WorkspaceSquircle'], props: { state: 'busy-done' } }, 'rid-thp');
    expect((renderStore.get('rid-thp')?.payload as { props?: unknown }).props).toEqual({ state: 'busy-done' });
  });
});
