import { describe, it, expect } from 'vitest';
import { prepareCanvasDiagram, RESULT_CLASSES } from '../../../src/canvas/canvasMermaid';

const ACCENT = '#d4a017';

describe('prepareCanvasDiagram', () => {
  it('prepends the SAI theme directive and appends pass/fail/current classDefs to a flowchart', () => {
    const out = prepareCanvasDiagram('flowchart LR\n  A --> B\n  class A pass\n', ACCENT);
    expect(out.startsWith('%%{init:')).toBe(true);
    expect(out).toContain('flowchart LR\n  A --> B\n  class A pass\n');
    for (const c of RESULT_CLASSES) expect(out).toMatch(new RegExp(`^\\s*classDef ${c} `, 'm'));
    expect(out).toContain(`stroke:${ACCENT}`);
  });

  it('works for `graph TD` and leading comments/blank lines', () => {
    const out = prepareCanvasDiagram('\n%% shop\ngraph TD\nA:::fail --> B\n', ACCENT);
    expect(out).toMatch(/^\s*classDef fail /m);
  });

  it('never redefines a class the source already defines', () => {
    const src = 'graph TD\nA --> B\nclassDef pass fill:#000\n';
    const out = prepareCanvasDiagram(src, ACCENT);
    expect(out.match(/classDef pass/g)).toHaveLength(1);
    expect(out).toMatch(/^\s*classDef fail /m);
    expect(out).toMatch(/^\s*classDef current /m);
  });

  it('leaves a source with its own init directive unthemed, but still adds classes', () => {
    const src = '%%{init: {"theme":"forest"}}%%\ngraph TD\nA --> B\n';
    const out = prepareCanvasDiagram(src, ACCENT);
    expect(out.startsWith(src)).toBe(true);
    expect(out.match(/%%\{init/g)).toHaveLength(1);
    expect(out).toMatch(/^\s*classDef pass /m);
  });

  it('non-flowchart diagrams get the theme only (classDef is flowchart syntax)', () => {
    const src = 'sequenceDiagram\nA->>B: hi\n';
    const out = prepareCanvasDiagram(src, ACCENT);
    expect(out.endsWith(src)).toBe(true);
    expect(out).not.toContain('classDef');
  });

  it('an unusable accent falls back to the default', () => {
    expect(prepareCanvasDiagram('graph TD\nA\n', 'url(x);fill:red')).not.toContain('url(');
  });

  it('YAML frontmatter stays at char 0: the theme directive goes after it, classDefs still added', () => {
    const src = '---\ntitle: Shop flow\n---\nflowchart LR\n  A --> B\n  class A pass\n';
    const out = prepareCanvasDiagram(src, ACCENT);
    expect(out.startsWith('---\ntitle: Shop flow\n---\n%%{init:')).toBe(true);
    expect(out).toContain('flowchart LR\n  A --> B\n  class A pass\n');
    for (const c of RESULT_CLASSES) expect(out).toMatch(new RegExp(`^\\s*classDef ${c} `, 'm'));
  });

  it('frontmatter with its own config: keeps its theme (no directive), still adds classes', () => {
    const src = '---\nconfig:\n  theme: forest\n---\ngraph TD\nA --> B\n';
    const out = prepareCanvasDiagram(src, ACCENT);
    expect(out.startsWith(src)).toBe(true);
    expect(out).not.toContain('%%{init');
    expect(out).toMatch(/^\s*classDef pass /m);
  });

  it('an unclosed frontmatter-looking start is left alone apart from the theme', () => {
    const src = '---\nnot closed\ngraph TD\n';
    expect(() => prepareCanvasDiagram(src, ACCENT)).not.toThrow();
  });
});
