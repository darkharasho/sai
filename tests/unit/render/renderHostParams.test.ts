import { describe, it, expect } from 'vitest';
import { parseRenderHostParams } from '../../../src/render/renderHostParams';

describe('parseRenderHostParams', () => {
  it('reads a single component into a one-element array + props', () => {
    const p = parseRenderHostParams('?render-host=1&component=WorkspaceSquircle&props=' + encodeURIComponent('{"state":"idle"}'));
    expect(p.components).toEqual(['WorkspaceSquircle']);
    expect(p.props).toEqual({ state: 'idle' });
  });
  it('reads components[] + vars + width', () => {
    const p = parseRenderHostParams('?render-host=1&components=' + encodeURIComponent('["A","B"]') + '&vars=' + encodeURIComponent('{"--x":"1"}') + '&width=400');
    expect(p.components).toEqual(['A', 'B']);
    expect(p.vars).toEqual({ '--x': '1' });
    expect(p.width).toBe(400);
  });
  it('tolerates malformed json (returns empties)', () => {
    const p = parseRenderHostParams('?render-host=1&components=oops&props=oops&vars=oops');
    expect(p.components).toEqual([]);
    expect(p.props).toEqual({});
    expect(p.vars).toEqual({});
  });
});
