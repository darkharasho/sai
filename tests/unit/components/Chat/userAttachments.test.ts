import { describe, it, expect } from 'vitest';
import { parseUserAttachments } from '../../../../src/components/Chat/userAttachments';

describe('parseUserAttachments', () => {
  it('lifts the @path line that buildMessage prepends', () => {
    const r = parseUserAttachments('@/a/b/One.tsx @/a/README.md\n\nwhy is it failing?');
    expect(r.files).toEqual(['/a/b/One.tsx', '/a/README.md']);
    expect(r.text).toBe('why is it failing?');
  });

  it('keeps a leading terminal block in the text', () => {
    const term = '[Terminal output]\n```\n$ npm test\n\nFAIL x\n```';
    const r = parseUserAttachments(`${term}\n\n@/a/b.ts\n\nhelp`);
    expect(r.files).toEqual(['/a/b.ts']);
    expect(r.text).toBe(`${term}\n\nhelp`);
  });

  it('handles paths containing spaces', () => {
    const r = parseUserAttachments('@/a/My Docs/x.md @/a/y.md\n\nhi');
    expect(r.files).toEqual(['/a/My Docs/x.md', '/a/y.md']);
  });

  it('accepts home-relative and Windows paths', () => {
    const r = parseUserAttachments('@~/x.ts @C:\\proj\\y.ts\n\nhi');
    expect(r.files).toEqual(['~/x.ts', 'C:\\proj\\y.ts']);
  });

  it('leaves ordinary messages alone', () => {
    for (const msg of ['hello', '@someone said hi\n\nok', 'see @/a/b.ts please', '@/a/b.ts']) {
      expect(parseUserAttachments(msg)).toEqual({ files: [], text: msg });
    }
  });

  it('leaves a terminal-only message alone', () => {
    const msg = '[Terminal output]\n```\nls\n```\n\nwhat is this';
    expect(parseUserAttachments(msg)).toEqual({ files: [], text: msg });
  });
});
