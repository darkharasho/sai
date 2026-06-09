import { describe, it, expect } from 'vitest';
import { SAI_TOOL_SCHEMA, toolsForToolset, SAI_TOOL_NAMES } from '../../../src/lib/saiTools';

describe('saiTools registry', () => {
  it('includes render_html and render_component in the chat toolset', () => {
    const names = toolsForToolset('chat').map((t) => t.name);
    expect(names).toContain('render_html');
    expect(names).toContain('render_component');
  });

  it('excludes chat-only tools from the orchestrator toolset', () => {
    const names = toolsForToolset('orchestrator').map((t) => t.name);
    expect(names).not.toContain('render_html');
  });

  it('every tool declares an object input_schema and a toolset', () => {
    for (const t of SAI_TOOL_SCHEMA) {
      expect(t.input_schema.type).toBe('object');
      expect(['chat', 'orchestrator', 'both']).toContain(t.toolset);
    }
  });

  it('render tool descriptions steer the model on when to use them', () => {
    const byName = Object.fromEntries(SAI_TOOL_SCHEMA.map((t) => [t.name, t.description]));
    // Should tell the model to render in-app for UI requests rather than writing files.
    expect(byName['render_html']).toMatch(/design|mock|preview|show/i);
    expect(byName['render_html']).toMatch(/in-app|inside the SAI app|live/i);
  });

  it('SAI_TOOL_NAMES is the set of all tool names', () => {
    expect(SAI_TOOL_NAMES.size).toBe(SAI_TOOL_SCHEMA.length);
    expect(SAI_TOOL_NAMES.has('render_html')).toBe(true);
    expect(SAI_TOOL_NAMES.has('render_component')).toBe(true);
  });
});

describe('Tier 1 chart/diff tools', () => {
  it('registers render_chart and render_diff as chat tools', () => {
    expect(SAI_TOOL_NAMES.has('render_chart')).toBe(true);
    expect(SAI_TOOL_NAMES.has('render_diff')).toBe(true);
    const chart = SAI_TOOL_SCHEMA.find((t) => t.name === 'render_chart')!;
    expect(chart.toolset).toBe('chat');
    expect(chart.input_schema.required).toContain('chart');
    expect(chart.input_schema.required).toContain('values');
    const diff = SAI_TOOL_SCHEMA.find((t) => t.name === 'render_diff')!;
    expect(diff.input_schema.required).toEqual(expect.arrayContaining(['before', 'after']));
  });
});
