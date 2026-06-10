import { describe, it, expect } from 'vitest';
import { renderMermaidToSvg, type MermaidApi } from '../../../src/render/renderMermaid';

function fakeApi(svg = '<svg id="m"><g/></svg>'): MermaidApi {
  return {
    initialize: () => {},
    render: async (_id: string, _text: string) => ({ svg }),
  };
}

describe('renderMermaidToSvg', () => {
  it('returns the SVG produced by the injected mermaid api', async () => {
    const out = await renderMermaidToSvg('graph TD; A-->B', fakeApi('<svg>diagram</svg>'));
    expect(out).toBe('<svg>diagram</svg>');
  });

  it('passes the diagram text and a unique id to mermaid.render', async () => {
    const calls: Array<{ id: string; text: string }> = [];
    const api: MermaidApi = {
      initialize: () => {},
      render: async (id, text) => { calls.push({ id, text }); return { svg: '<svg/>' }; },
    };
    await renderMermaidToSvg('sequenceDiagram\nA->>B: hi', api);
    await renderMermaidToSvg('graph TD; X-->Y', api);
    expect(calls[0].text).toBe('sequenceDiagram\nA->>B: hi');
    expect(calls[1].text).toBe('graph TD; X-->Y');
    expect(calls[0].id).not.toBe(calls[1].id);
  });

  it('propagates a render error (caller decides how to surface it)', async () => {
    const api: MermaidApi = {
      initialize: () => {},
      render: async () => { throw new Error('Parse error on line 1'); },
    };
    await expect(renderMermaidToSvg('not a diagram', api)).rejects.toThrow(/parse error/i);
  });
});
