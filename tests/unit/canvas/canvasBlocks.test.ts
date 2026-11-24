import { describe, it, expect } from 'vitest';
import {
  splitBlocks, joinBlocks, replaceBlock, toggleTask, addTaskNote, canvasTitle,
} from '../../../src/canvas/canvasBlocks';

const MIXED = [
  '# Heading',
  '',
  '- [ ] one',
  '- [x] two',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '```html id=picker',
  '<button>hi</button>',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
].join('\n');

describe('canvasBlocks', () => {
  it('round-trips exactly', () => {
    for (const x of ['', '# T\n\npara\n', '```mermaid\ngraph TD\n', 'a\r\n\r\n- [ ] x\r\n', MIXED, '\n\n# lead\n']) {
      expect(joinBlocks(splitBlocks(x))).toBe(x);
    }
  });

  it('classifies kinds', () => {
    expect(splitBlocks(MIXED).map((b) => b.kind)).toEqual(['markdown', 'checklist', 'mermaid', 'html', 'markdown']);
    expect(splitBlocks('- [ ] a\n- plain\n')[0].kind).toBe('markdown');
  });

  it('extracts labels and indexes', () => {
    const blocks = splitBlocks(MIXED);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2, 3, 4]);
    expect(blocks[3].label).toBe('id=picker');
    expect(blocks[2].label).toBeUndefined();
  });

  it('toggleTask flips only target', () => {
    expect(toggleTask('- [ ] a\n- [ ] b\n', 0, 1)).toBe('- [ ] a\n- [x] b\n');
    expect(toggleTask('- [ ] a\n- [x] b\n', 0, 1)).toBe('- [ ] a\n- [ ] b\n');
    expect(toggleTask('# T\n\n- [ ] a\n', 1, 0)).toBe('# T\n\n- [x] a\n');
  });

  it('addTaskNote', () => {
    expect(addTaskNote('- [ ] a\n- [ ] b\n', 0, 0, 'crashed here')).toBe('- [ ] a\n  > crashed here\n- [ ] b\n');
  });

  it('replaceBlock swaps one block source', () => {
    expect(replaceBlock('# T\n\npara\n', 1, 'new\n')).toBe('# T\n\nnew\n');
  });

  it('canvasTitle', () => {
    expect(canvasTitle('# Mod test\n\nbody', 'steps')).toBe('Mod test');
    expect(canvasTitle('no heading', 'steps')).toBe('steps');
  });

  it('hash stable across trailing whitespace', () => {
    const a = splitBlocks('para\n\n# H\n')[0];
    const b = splitBlocks('para\n\n\n\n# H\n')[0];
    expect(a.hash).toBe(b.hash);
    expect(splitBlocks('other\n')[0].hash).not.toBe(a.hash);
  });
});

import { blockName } from '../../../src/canvas/canvasBlocks';

describe('blockName (D4)', () => {
  it('prefers the fence title, then the nearest preceding heading, then "block N"', () => {
    const blocks = splitBlocks('intro\n\n```html\n<b/>\n```\n\n# A\n\n## Shop flow\n\npara\n\n```mermaid\nA-->B\n```\n\n```html id=picker\n<i/>\n```\n');
    expect(blockName(blocks, 1)).toBe('block 2');
    expect(blockName(blocks, 5)).toBe('Shop flow');
    expect(blockName(blocks, 6)).toBe('id=picker');
  });
});

describe('blockName collisions', () => {
  const DOC = '## Shop flow\n\n```html\n<b/>\n```\n\n```html\n<i/>\n```\n\n```mermaid\nA-->B\n```\n\n## Other\n\n```html\n<u/>\n```\n';
  it('suffixes untitled blocks of one kind that share a heading name; unique names stay plain', () => {
    const blocks = splitBlocks(DOC);
    expect(blockName(blocks, 1)).toBe('Shop flow (block 2)');
    expect(blockName(blocks, 2)).toBe('Shop flow (block 3)');
    // Only diagram under the heading: unique among diagrams.
    expect(blockName(blocks, 3)).toBe('Shop flow');
    expect(blockName(blocks, 5)).toBe('Other');
  });
  it('an untitled block whose heading equals another block\'s title is suffixed; the title stays', () => {
    const blocks = splitBlocks('## picker\n\n```html picker\n<b/>\n```\n\n```html\n<i/>\n```\n');
    expect(blockName(blocks, 1)).toBe('picker');
    expect(blockName(blocks, 2)).toBe('picker (block 3)');
  });
});
