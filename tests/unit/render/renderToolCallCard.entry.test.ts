import { describe, it, expect } from 'vitest';
import { entryFromToolCall } from '../../../src/components/Chat/RenderToolCallCard';
import type { ToolCall } from '../../../src/types';

function tc(name: string, input: unknown): ToolCall {
  return { id: 't1', name, input: JSON.stringify(input) } as ToolCall;
}

describe('entryFromToolCall — chart/diff', () => {
  it('builds an html entry from a sai_render_chart call', () => {
    const built = entryFromToolCall(tc('sai_render_chart', { chart: 'bar', labels: ['A'], values: [3] }));
    expect(built?.entry.kind).toBe('html');
    expect(String(built?.entry.payload.html)).toContain('<svg');
  });

  it('builds an html entry from a sai_render_diff call', () => {
    const built = entryFromToolCall(tc('sai_render_diff', { before: '<i>x</i>', after: '<i>y</i>' }));
    expect(String(built?.entry.payload.html)).toContain('<i>x</i>');
    expect(String(built?.entry.payload.html)).toContain('<i>y</i>');
  });

  it('returns null for a chart call with mismatched lengths (cannot render)', () => {
    const built = entryFromToolCall(tc('sai_render_chart', { chart: 'bar', labels: ['A'], values: [1, 2] }));
    expect(built).toBeNull();
  });
});

describe('entryFromToolCall — render_theme defaults', () => {
  it('render_theme with no components defaults to the full registry', () => {
    const built = entryFromToolCall(tc('sai_render_theme', { vars: { '--a': '1' } }));
    const comps = (built?.entry.payload as { components: string[] }).components;
    expect(comps.length).toBeGreaterThan(0);
    expect(comps).toContain('WorkspaceSquircle');
  });
});
