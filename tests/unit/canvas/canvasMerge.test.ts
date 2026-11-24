import { describe, it, expect } from 'vitest';
import { mergeBlocks } from '../../../src/canvas/canvasMerge';

const doc = (...b: string[]) => b.join('\n\n') + '\n';

describe('mergeBlocks', () => {
  const H = '# Title';
  const P = 'Intro paragraph.';
  const C = '- [ ] a\n- [ ] b';
  const Z = 'Closing.';

  it('takes theirs when only agent changed', () => {
    const base = doc(H, P, C, Z);
    const theirs = doc(H, 'Agent rewrote intro.', C, Z);
    const r = mergeBlocks(base, base, theirs);
    expect(r.merged).toBe(theirs);
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('restores user tick dropped by agent rewrite', () => {
    const base = doc(H, P, C, Z);
    const ours = doc(H, P, '- [x] a\n- [ ] b', Z);
    const theirs = doc(H, 'Agent edit.', C, Z);
    const r = mergeBlocks(base, ours, theirs);
    expect(r.merged).toBe(doc(H, 'Agent edit.', '- [x] a\n- [ ] b', Z));
    expect(r.changed).toBe(true);
    expect(r.conflicts).toEqual([]);
  });

  it('merge keeps ours on both-changed and records conflict', () => {
    const base = doc(H, P, Z);
    const ours = doc(H, 'User intro.', Z);
    const theirs = doc(H, 'Agent intro.', Z);
    const r = mergeBlocks(base, ours, theirs);
    expect(r.merged).toBe(ours);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].theirs).toBe('Agent intro.');
    expect(r.conflicts[0].ours).toBe('User intro.');
    expect(r.changed).toBe(true);
  });

  it('keeps both inserts, theirs before ours', () => {
    const base = doc(H, P);
    const ours = doc(H, P, 'Y user block');
    const theirs = doc(H, P, 'X agent block');
    const r = mergeBlocks(base, ours, theirs);
    expect(r.merged).toBe(doc(H, P, 'X agent block', 'Y user block'));
    expect(r.conflicts).toEqual([]);
  });

  it('delete vs untouched deletes', () => {
    const base = doc(H, P, Z);
    expect(mergeBlocks(base, base, doc(H, Z)).merged).toBe(doc(H, Z));
    expect(mergeBlocks(base, doc(H, Z), base).merged).toBe(doc(H, Z));
  });

  it('delete vs changed keeps changed', () => {
    const base = doc(H, P, Z);
    const r1 = mergeBlocks(base, doc(H, 'User edit.', Z), doc(H, Z));
    expect(r1.merged).toBe(doc(H, 'User edit.', Z));
    const r2 = mergeBlocks(base, doc(H, Z), doc(H, 'Agent edit.', Z));
    expect(r2.merged).toBe(doc(H, 'Agent edit.', Z));
    expect(r1.conflicts).toEqual([]);
  });

  it('keeps blocks separated when an unterminated block gets a new neighbour', () => {
    const base = 'one\n\ntwo';
    const ours = 'one\n\ntwo';
    const theirs = 'one\n\ntwo\n\nthree';
    expect(mergeBlocks(base, ours, theirs).merged).toBe(theirs);
    // user appends after unterminated last block, agent changes nothing
    const r = mergeBlocks('one\n\ntwo', 'one\n\ntwo', 'one\n\ntwo');
    expect(r.merged).toBe('one\n\ntwo');
    // both append after an unterminated block
    const m = mergeBlocks('one\n\ntwo', 'one\n\ntwo\n\nY', 'one\n\ntwo\n\nX');
    expect(m.merged).toBe('one\n\ntwo\n\nX\n\nY');
    // theirs ends unterminated, ours appends: must not glue
    const g = mergeBlocks('one', 'one\n\nY', 'one\n\nX');
    expect(g.merged).toBe('one\n\nX\n\nY');
    const g2 = mergeBlocks('one\n', 'one\n\nY\n', 'one\n\nX');
    expect(g2.merged).toMatch(/X\n\nY\n$/);
  });

  it('handles duplicate identical blocks', () => {
    const base = doc(H, 'same', 'same', Z);
    const ours = doc(H, 'same', 'same', Z, 'user tail');
    const theirs = doc(H, 'same', 'agent mid', 'same', Z);
    const r = mergeBlocks(base, ours, theirs);
    expect(r.merged).toBe(doc(H, 'same', 'agent mid', 'same', Z, 'user tail'));
    expect(r.conflicts).toEqual([]);
  });
});
