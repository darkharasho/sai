import { describe, it, expect } from 'vitest';
import { buildChartHtml } from '../../../src/render/builtinRenderers';
import { buildDiffHtml } from '../../../src/render/builtinRenderers';

describe('buildChartHtml', () => {
  it('renders a bar chart with one <rect> per value and the labels', () => {
    const html = buildChartHtml({
      chart: 'bar',
      labels: ['A', 'B', 'C'],
      values: [1, 2, 4],
    });
    expect(html).toContain('<svg');
    expect((html.match(/<rect/g) || []).length).toBe(3);
    expect(html).toContain('>A<');
    expect(html).toContain('>C<');
  });

  it('renders a line chart as a single <polyline> through every point', () => {
    const html = buildChartHtml({ chart: 'line', labels: ['x', 'y'], values: [3, 6] });
    expect(html).toContain('<polyline');
    const pts = html.match(/points="([^"]+)"/);
    expect(pts).not.toBeNull();
    expect(pts![1].trim().split(/\s+/).length).toBe(2);
  });

  it('escapes HTML-special characters in labels', () => {
    const html = buildChartHtml({ chart: 'bar', labels: ['<b>'], values: [1] });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('throws on a values/labels length mismatch', () => {
    expect(() => buildChartHtml({ chart: 'bar', labels: ['A'], values: [1, 2] })).toThrow(
      /labels and values/i,
    );
  });
});

describe('buildDiffHtml', () => {
  it('embeds both snippets and labels them', () => {
    const html = buildDiffHtml({ before: '<p>old</p>', after: '<p>new</p>' });
    expect(html).toContain('<p>old</p>');
    expect(html).toContain('<p>new</p>');
    expect(html).toContain('Before');
    expect(html).toContain('After');
  });

  it('honours a stacked layout', () => {
    const side = buildDiffHtml({ before: 'a', after: 'b' });
    const stacked = buildDiffHtml({ before: 'a', after: 'b', layout: 'stacked' });
    expect(side).toContain('grid-template-columns');
    expect(stacked).not.toContain('grid-template-columns');
  });

  it('uses custom labels when provided', () => {
    const html = buildDiffHtml({ before: 'a', after: 'b', beforeLabel: 'v1', afterLabel: 'v2' });
    expect(html).toContain('v1');
    expect(html).toContain('v2');
  });
});
