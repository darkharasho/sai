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

  it('SAI_TOOL_NAMES is the set of all tool names', () => {
    expect(SAI_TOOL_NAMES.has('render_html')).toBe(true);
  });
});
