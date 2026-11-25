import { describe, it, expect } from 'vitest';
import { describeUserEdits, buildCanvasUpdateMessage, splitCanvasUpdates } from '../../../src/canvas/canvasDiff';

describe('describeUserEdits', () => {
  it('ticks', () => {
    expect(describeUserEdits('- [ ] Load save\n', '- [x] Load save\n')).toEqual(['☑ "Load save"']);
  });
  it('unticks', () => {
    expect(describeUserEdits('- [x] Load save\n', '- [ ] Load save\n')).toEqual(['☐ "Load save"']);
  });
  it('note', () => {
    const seen = '- [ ] Open shop\n- [ ] Buy\n';
    const cur = '- [ ] Open shop\n  > crashed here\n- [ ] Buy\n';
    expect(describeUserEdits(seen, cur)).toEqual(['note on "Open shop": crashed here']);
  });
  it('added and removed items', () => {
    const seen = '- [ ] A\n- [ ] B\n';
    const cur = '- [ ] A\n- [ ] C\n';
    expect(describeUserEdits(seen, cur)).toEqual(['+ item "C"', '− item "B"']);
  });
  it('mermaid edit', () => {
    const seen = '# T\n\n```mermaid flow\nA-->B\n```\n';
    const cur = '# T\n\n```mermaid flow\nA-->C\n```\n';
    expect(describeUserEdits(seen, cur)).toEqual(['diagram "flow": edited']);
  });
  it('D4: mermaid edit without label uses the nearest preceding heading', () => {
    const seen = '# Plan\n\nintro\n\n## Shop flow\n\ntext\n\n```mermaid\nA-->B\n```\n';
    const cur = '# Plan\n\nintro\n\n## Shop flow\n\ntext\n\n```mermaid\nA-->C\n```\n';
    expect(describeUserEdits(seen, cur)).toEqual(['diagram "Shop flow": edited']);
  });
  it('D4: mermaid edit with no title and no heading before it falls back to block N', () => {
    const seen = 'intro\n\n```mermaid\nA-->B\n```\n\n# Later\n';
    const cur = 'intro\n\n```mermaid\nA-->C\n```\n\n# Later\n';
    expect(describeUserEdits(seen, cur)).toEqual(['diagram "block 2": edited']);
  });
  it('D4: html edit without label uses the nearest preceding heading', () => {
    const seen = '# T\n\nShop UI\n-------\n\n```html\n<b>a</b>\n```\n';
    const cur = '# T\n\nShop UI\n-------\n\n```html\n<b>b</b>\n```\n';
    expect(describeUserEdits(seen, cur)).toEqual(['html "Shop UI": edited']);
  });
  it('paragraph edit', () => {
    expect(describeUserEdits('# T\n\nhello world\n', '# T\n\nhello   brave\nworld\n')).toEqual([
      'edited block 2: hello brave world',
    ]);
  });
  it('truncates edited text to 80 chars', () => {
    const long = 'word '.repeat(40);
    const [line] = describeUserEdits('# T\n\nshort\n', `# T\n\n${long}\n`);
    expect(line).toBe('edited block 2: ' + long.replace(/\s+/g, ' ').trim().slice(0, 80));
  });
  it('added block', () => {
    expect(describeUserEdits('# T\n', '# T\n\nnew para\n')).toEqual(['+ block 2: new para']);
  });
  it('removed block', () => {
    expect(describeUserEdits('# T\n\nbye\n', '# T\n')).toEqual(['− block 2']);
  });
  it('indexes: edited/added use current, removed uses seen', () => {
    const seen = '# T\n\nold intro\n\nkeep me\n\ngone soon\n\ntail text\n';
    const cur = '# T\n\nbrand new\n\nold intro\n\nkeep me\n\ntail text changed\n';
    expect(describeUserEdits(seen, cur)).toEqual(['+ block 2: brand new', '− block 4', 'edited block 5: tail text changed']);
  });
  it('insertion at slot 0', () => {
    expect(describeUserEdits('# T\n', 'first\n\n# T\n')).toEqual(['+ block 1: first']);
  });
  it('two untitled diagrams under one heading get distinct edit lines', () => {
    const seen = '## Shop flow\n\n```mermaid\nA-->B\n```\n\n```mermaid\nC-->D\n```\n';
    const cur = '## Shop flow\n\n```mermaid\nA-->X\n```\n\n```mermaid\nC-->Y\n```\n';
    expect(describeUserEdits(seen, cur)).toEqual(['diagram "Shop flow (block 2)": edited', 'diagram "Shop flow (block 3)": edited']);
  });
  it('two untitled html blocks under one heading get distinct edit lines', () => {
    const seen = '## Shop flow\n\n```html\n<b>a</b>\n```\n\n```html\n<i>a</i>\n```\n';
    const cur = '## Shop flow\n\n```html\n<b>b</b>\n```\n\n```html\n<i>b</i>\n```\n';
    expect(describeUserEdits(seen, cur)).toEqual(['html "Shop flow (block 2)": edited', 'html "Shop flow (block 3)": edited']);
  });
  it('html block edit', () => {
    const seen = '# T\n\n```html pick\n<b>a</b>\n```\n';
    const cur = '# T\n\n```html pick\n<b>b</b>\n```\n';
    expect(describeUserEdits(seen, cur)).toEqual(['html "pick": edited']);
  });
  it('kind change', () => {
    const seen = '# T\n\n- [ ] a\n';
    const cur = '# T\n\n- a\n';
    expect(describeUserEdits(seen, cur)).toEqual(['edited block 2: - a']);
  });
  it('checklist whitespace-only change', () => {
    expect(describeUserEdits('- [ ] a\n- [ ] b\n', '- [ ] a\n\n- [ ] b\n')).toEqual([]);
  });
  it('duplicate-text tick', () => {
    expect(describeUserEdits('- [ ] Test\n- [ ] Test\n', '- [ ] Test\n- [x] Test\n')).toEqual(['☑ "Test"']);
  });
  it('nested tick, add and remove', () => {
    const seen = '- [ ] p\n  - [ ] c1\n  - [ ] c2\n';
    const cur = '- [ ] p\n  - [x] c1\n  - [ ] c3\n';
    expect(describeUserEdits(seen, cur)).toEqual(['☑ "c1"', '+ item "c3"', '− item "c2"']);
  });
  it('item added already checked', () => {
    expect(describeUserEdits('- [ ] a\n', '- [ ] a\n- [x] b\n')).toEqual(['+ item "b"', '☑ "b"']);
  });
  it('item edited and ticked keeps checked state', () => {
    expect(describeUserEdits('- [ ] old\n', '- [x] new\n')).toEqual(['+ item "new"', '☑ "new"', '− item "old"']);
  });
  it('changed note counts as new note', () => {
    const seen = '- [ ] a\n  > one\n';
    const cur = '- [ ] a\n  > two\n';
    expect(describeUserEdits(seen, cur)).toEqual(['note on "a": two']);
  });
  it('fallback: reordered items still reported', () => {
    expect(describeUserEdits('- [ ] a\n- [ ] b\n', '- [ ] b\n- [ ] a\n')).toEqual(['edited block 1: - [ ] b - [ ] a']);
  });
  it('no change', () => {
    expect(describeUserEdits('# T\n\n- [ ] a\n', '# T\n\n- [ ] a\n')).toEqual([]);
  });
});

describe('buildCanvasUpdateMessage', () => {
  const relPath = '.sai/canvas/plan.md';
  it('one line', () => {
    expect(buildCanvasUpdateMessage({ relPath, lines: ['☑ "A"'], emits: [] })).toBe(
      '[Canvas update] .sai/canvas/plan.md\nThe user edited the canvas:\n- ☑ "A"\nRe-read the file for full context.',
    );
  });
  it('one emit', () => {
    expect(buildCanvasUpdateMessage({ relPath, lines: [], emits: [{ label: 'picker', data: { a: 1 } }] })).toBe(
      '[Canvas update] .sai/canvas/plan.md\nThe user edited the canvas:\n- html "picker" sent: {"a":1}\nRe-read the file for full context.',
    );
  });
  it('truncates emit JSON to 500 chars', () => {
    const msg = buildCanvasUpdateMessage({ relPath, lines: [], emits: [{ label: 'x', data: 'y'.repeat(900) }] });
    const bullet = msg.split('\n')[2];
    expect(bullet).toBe('- html "x" sent: ' + JSON.stringify('y'.repeat(900)).slice(0, 500));
  });
  it('full content', () => {
    expect(
      buildCanvasUpdateMessage({ relPath, lines: ['ignored'], emits: [{ label: 'p', data: 1 }], fullContent: '# T\n' }),
    ).toBe(
      '[Canvas update] .sai/canvas/plan.md\nThe user is sharing this canvas with you (current content below).\n\n```markdown\n# T\n```\n- html "p" sent: 1\nRe-read the file for full context.',
    );
  });
  it('cyclic emit payload does not throw', () => {
    const data: any = { a: 1 };
    data.self = data;
    const msg = buildCanvasUpdateMessage({ relPath, lines: [], emits: [{ label: 'c', data }] });
    expect(msg).toContain('html "c" sent: {"a":1,"self":"[Circular]"}');
  });
  it('BigInt emit payload is stringified', () => {
    const msg = buildCanvasUpdateMessage({ relPath, lines: [], emits: [{ label: 'b', data: { n: 10n } }] });
    expect(msg).toContain('html "b" sent: {"n":"10"}');
  });
  it('a throwing toJSON falls back instead of throwing', () => {
    const data = { toJSON() { throw new Error('nope'); } };
    expect(() => buildCanvasUpdateMessage({ relPath, lines: [], emits: [{ label: 't', data }] })).not.toThrow();
  });
  it('shows the emit count when coalesced', () => {
    const msg = buildCanvasUpdateMessage({ relPath, lines: [], emits: [{ label: 'picker', data: 5, count: 37 }] });
    expect(msg).toContain('- html "picker" sent: 5 (×37)');
  });
});

describe('splitCanvasUpdates', () => {
  const a = buildCanvasUpdateMessage({ relPath: '.sai/canvas/shop.md', lines: ['ticked "one"'], emits: [] });
  const b = buildCanvasUpdateMessage({ relPath: '.sai/canvas/plan.md', lines: [], emits: [], fullContent: '# Plan\n\n- [ ] x\n' });

  it('splits held updates off the front of a typed message', () => {
    expect(splitCanvasUpdates(`${a}\n\n${b}\n\nlooks good, go on`)).toEqual({ relPaths: ['.sai/canvas/shop.md', '.sai/canvas/plan.md'], rest: 'looks good, go on' });
  });

  it('an update sent on its own leaves nothing; plain text is untouched', () => {
    expect(splitCanvasUpdates(a)).toEqual({ relPaths: ['.sai/canvas/shop.md'], rest: '' });
    expect(splitCanvasUpdates('hello [Canvas update] x')).toEqual({ relPaths: [], rest: 'hello [Canvas update] x' });
    expect(splitCanvasUpdates('[Canvas update] x\nno tail')).toEqual({ relPaths: [], rest: '[Canvas update] x\nno tail' });
  });
});
