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
});
