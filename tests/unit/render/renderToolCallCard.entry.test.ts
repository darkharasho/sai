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

it('builds a form entry from a sai_render_form call', () => {
  const built = entryFromToolCall(tc('sai_render_form', { html: '<button>go</button>' }));
  expect(built?.entry.kind).toBe('form');
  expect(String(built?.entry.payload.html)).toContain('<button>go</button>');
});

it('returns null for a form call with empty html', () => {
  const built = entryFromToolCall(tc('sai_render_form', { html: '' }));
  expect(built).toBeNull();
});

it('builds a confirm form with two buttons', () => {
  const built = entryFromToolCall(tc('sai_confirm', { message: 'Proceed?' }));
  expect(built?.entry.kind).toBe('form');
  expect((String(built?.entry.payload.html).match(/<button/g) || []).length).toBe(2);
  expect(String(built?.entry.payload.html)).toContain('data-sai-value="true"');
  expect(String(built?.entry.payload.html)).toContain('data-sai-value="false"');
});

it('builds a choose form with one button per option', () => {
  const built = entryFromToolCall(tc('sai_choose', { message: 'Pick', options: ['Red', 'Green', 'Blue'] }));
  expect(built?.entry.kind).toBe('form');
  expect((String(built?.entry.payload.html).match(/<button/g) || []).length).toBe(3);
  expect(String(built?.entry.payload.html)).toContain('>Red</button>');
});

it('returns null for choose with no options', () => {
  expect(entryFromToolCall(tc('sai_choose', { message: 'Pick', options: [] }))).toBeNull();
});

it('returns null for confirm with no message', () => {
  expect(entryFromToolCall(tc('sai_confirm', {}))).toBeNull();
});
