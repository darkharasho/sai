import { describe, it, expect } from 'vitest';
import { deriveAgentMarks, blockMark, itemMark } from '../../../src/canvas/canvasAgentMarks';

describe('deriveAgentMarks', () => {
  it('nothing changed -> no marks', () => {
    expect(deriveAgentMarks('# T\n\npara\n', '# T\n\npara\n')).toEqual({ blocks: [], items: [] });
  });

  it('an inserted block is added, a rewritten one edited', () => {
    const m = deriveAgentMarks('# T\n\nold para\n', '# T\n\nold para, reworded\n\n```mermaid\ngraph TD\nA\n```\n');
    expect(m.blocks).toEqual([{ index: 1, kind: 'edited' }, { index: 2, kind: 'added' }]);
    expect(blockMark(m, 2)).toBe('added');
    expect(blockMark(m, 0)).toBeNull();
  });

  it('checklist changes are marked per item, not per block', () => {
    const before = '- [ ] A\n- [ ] B\n';
    const after = '- [ ] A\n- [x] B\n- [ ] C\n';
    const m = deriveAgentMarks(before, after);
    expect(m.blocks).toEqual([]);
    expect(m.items).toEqual([{ block: 0, item: 1, kind: 'edited' }, { block: 0, item: 2, kind: 'added' }]);
    expect(itemMark(m, 0, 2)).toBe('added');
    expect(itemMark(m, 0, 0)).toBeNull();
  });

  it('a note added under an item edits that item; failed counts as a state change', () => {
    const m = deriveAgentMarks('- [ ] A\n- [ ] B\n', '- [!] A\n- [ ] B\n  > try again\n');
    expect(m.items).toEqual([{ block: 0, item: 0, kind: 'edited' }, { block: 0, item: 1, kind: 'edited' }]);
  });

  it('a whole new checklist block is one added block', () => {
    const m = deriveAgentMarks('# T\n', '# T\n\n- [ ] A\n');
    expect(m.blocks).toEqual([{ index: 1, kind: 'added' }]);
    expect(m.items).toEqual([]);
  });

  it('a checklist edit the item view cannot express (reorder) marks the block', () => {
    const m = deriveAgentMarks('- [ ] A\n- [ ] B\n', '- [ ] B\n- [ ] A\n');
    expect(m.blocks).toEqual([{ index: 0, kind: 'edited' }]);
  });
});
