import { describe, it, expect } from 'vitest';
import {
  splitBlocks, toggleTask, markTaskFailed, taskItems, blockShape,
} from '../../../src/canvas/canvasBlocks';
import { parseStats, checklistTotals, resolveStat } from '../../../src/canvas/canvasStats';
import { describeUserEdits, countUserEdits } from '../../../src/canvas/canvasDiff';

describe('failed items (- [!])', () => {
  it('a list of [!] / [ ] / [x] items is a checklist', () => {
    expect(splitBlocks('- [!] a\n- [ ] b\n- [x] c\n')[0].kind).toBe('checklist');
    expect(splitBlocks('- [!] only failed\n')[0].kind).toBe('checklist');
    // A plain bullet that is not a task keeps the list a plain markdown list.
    expect(splitBlocks('- [!] a\n- plain\n')[0].kind).toBe('markdown');
  });

  it('taskItems reports state, label and continuation lines', () => {
    expect(taskItems('- [!] Buy item\n  > crashed\n- [x] Load\n- [ ] Next\n')).toEqual([
      { state: 'failed', text: 'Buy item\n> crashed' },
      { state: 'done', text: 'Load' },
      { state: 'open', text: 'Next' },
    ]);
  });

  it('toggle cycles open -> done -> open and failed -> open', () => {
    expect(toggleTask('- [ ] a\n', 0, 0)).toBe('- [x] a\n');
    expect(toggleTask('- [x] a\n', 0, 0)).toBe('- [ ] a\n');
    expect(toggleTask('- [!] a\n- [ ] b\n', 0, 0)).toBe('- [ ] a\n- [ ] b\n');
  });

  it('markTaskFailed writes [!] over [ ] or [x] and leaves a failed item alone', () => {
    expect(markTaskFailed('- [ ] a\n- [x] b\n', 0, 1)).toBe('- [ ] a\n- [!] b\n');
    expect(markTaskFailed('1. [ ] a\n', 0, 0)).toBe('1. [!] a\n');
    expect(markTaskFailed('- [!] a\n', 0, 0)).toBe('- [!] a\n');
    expect(markTaskFailed('para\n', 0, 0)).toBe('para\n');
  });

  it('diff reports failed as ✗ next to ☑/☐', () => {
    expect(describeUserEdits('- [ ] Buy\n', '- [!] Buy\n')).toEqual(['✗ "Buy"']);
    expect(describeUserEdits('- [!] Buy\n', '- [ ] Buy\n')).toEqual(['☐ "Buy"']);
    expect(describeUserEdits('- [x] Buy\n', '- [!] Buy\n')).toEqual(['✗ "Buy"']);
    expect(describeUserEdits('- [ ] A\n', '- [ ] A\n- [!] B\n')).toEqual(['+ item "B"', '✗ "B"']);
    expect(describeUserEdits('- [!] Buy\n', '- [!] Buy\n  > froze\n')).toEqual(['note on "Buy": froze']);
  });
});

describe('blockShape', () => {
  it('names a block by its first node', () => {
    expect(blockShape('## Shop flow\n')).toEqual({ type: 'heading', depth: 2, text: 'Shop flow' });
    expect(blockShape('Setext\n===\n')).toEqual({ type: 'heading', depth: 1, text: 'Setext' });
    expect(blockShape('some text\n')).toEqual({ type: 'paragraph' });
    expect(blockShape('| a |\n|---|\n| 1 |\n')).toEqual({ type: 'table' });
    expect(blockShape('')).toEqual({ type: 'empty' });
  });
});

describe('stats blocks', () => {
  const DOC = [
    '# T', '',
    '```stats', 'Progress: auto', 'PASSED: Auto', 'failed: auto', 'Remaining: auto', 'Build: v0.3.1-dev', 'Owner: Sam Lee', 'Other: auto', '```', '',
    '- [x] a', '- [x] b', '- [!] c', '- [ ] d', '',
    '## More', '',
    '1. [ ] e', '',
  ].join('\n');

  it('a ```stats fence is its own block kind', () => {
    expect(splitBlocks(DOC)[1].kind).toBe('stats');
  });

  it('parses one Label: value per line, skipping junk', () => {
    expect(parseStats('```stats\nProgress: auto\n\nno colon here\nBuild:  v1:2 \n```\n')).toEqual([
      { label: 'Progress', value: 'auto' },
      { label: 'Build', value: 'v1:2' },
    ]);
  });

  it('counts every checklist item in the canvas', () => {
    expect(checklistTotals(DOC)).toEqual({ done: 2, failed: 1, open: 2, total: 5 });
    expect(checklistTotals('# none\n')).toEqual({ done: 0, failed: 0, open: 0, total: 0 });
  });

  it('auto computes progress/passed/failed/remaining (case-insensitive); anything else is verbatim', () => {
    const totals = checklistTotals(DOC);
    const tiles = parseStats(splitBlocks(DOC)[1].source).map((s) => resolveStat(s, totals));
    expect(tiles).toEqual([
      { label: 'Progress', kind: 'progress', value: '2', done: 2, total: 5 },
      { label: 'PASSED', kind: 'passed', value: '2' },
      { label: 'failed', kind: 'failed', value: '1' },
      { label: 'Remaining', kind: 'remaining', value: '2' },
      { label: 'Build', kind: 'text', value: 'v0.3.1-dev', mono: true },
      { label: 'Owner', kind: 'text', value: 'Sam Lee', mono: false },
      { label: 'Other', kind: 'text', value: 'auto', mono: false },
    ]);
  });

  it('a literal value for a known label stays verbatim', () => {
    expect(resolveStat({ label: 'Passed', value: '12' }, { done: 0, failed: 0, open: 0, total: 0 }))
      .toEqual({ label: 'Passed', kind: 'text', value: '12', mono: false });
  });

  it('mono for versions, hashes and backticked code', () => {
    const t = { done: 0, failed: 0, open: 0, total: 0 };
    expect(resolveStat({ label: 'x', value: '1.2.3' }, t).mono).toBe(true);
    expect(resolveStat({ label: 'x', value: 'a1b2c3d' }, t).mono).toBe(true);
    expect(resolveStat({ label: 'x', value: '`main`' }, t)).toMatchObject({ value: 'main', mono: true });
    expect(resolveStat({ label: 'x', value: 'Friday' }, t).mono).toBe(false);
  });

  it('diff reports a stats edit like other blocks', () => {
    const a = '# T\n\n```stats\nBuild: v1\n```\n';
    expect(describeUserEdits(a, a.replace('v1', 'v2'))).toEqual(['stats: edited']);
  });
});

describe('countUserEdits', () => {
  it('counts distinct changed items and blocks, not diff lines', () => {
    // New item that arrives ticked: two lines, one change.
    expect(countUserEdits('- [ ] A\n', '- [ ] A\n- [x] B\n')).toBe(1);
    // Tick + note on one item: one change.
    expect(countUserEdits('- [ ] A\n', '- [x] A\n  > ok\n')).toBe(1);
    // Two items ticked + a paragraph edit: three changes.
    expect(countUserEdits('- [ ] A\n- [ ] B\n\npara\n', '- [x] A\n- [x] B\n\npara 2\n')).toBe(3);
    expect(countUserEdits('x\n', 'x\n')).toBe(0);
  });
});
