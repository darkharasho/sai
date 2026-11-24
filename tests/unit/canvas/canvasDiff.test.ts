import { describe, it, expect } from 'vitest';
import { describeUserEdits, buildCanvasUpdateMessage } from '../../../src/canvas/canvasDiff';

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
  it('mermaid edit without label uses block N', () => {
    const seen = '# T\n\n```mermaid\nA-->B\n```\n';
    const cur = '# T\n\n```mermaid\nA-->C\n```\n';
    expect(describeUserEdits(seen, cur)).toEqual(['diagram "block 2": edited']);
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
});
