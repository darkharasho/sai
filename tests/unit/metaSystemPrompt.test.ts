import { describe, it, expect } from 'vitest';
import { buildMetaPreamble } from '../../src/lib/metaSystemPrompt';

describe('buildMetaPreamble', () => {
  it('returns empty string when no meta workspace given', () => {
    expect(buildMetaPreamble(null)).toBe('');
  });

  it('lists each project with link name, real path, and description', () => {
    const out = buildMetaPreamble({
      name: 'axi-marketing',
      syntheticRoot: '/home/u/.sai/meta/abc',
      projects: [
        { linkName: 'axi-foo', path: '/work/axi-foo', description: 'storefront', status: 'ok' },
        { linkName: 'axi-bar', path: '/work/axi-bar', status: 'ok' },
      ],
    });
    expect(out).toContain('Meta Workspace "axi-marketing"');
    expect(out).toContain('/home/u/.sai/meta/abc');
    expect(out).toContain('axi-foo -> /work/axi-foo (storefront)');
    expect(out).toContain('axi-bar -> /work/axi-bar');
  });

  it('omits unavailable projects', () => {
    const out = buildMetaPreamble({
      name: 'x',
      syntheticRoot: '/r',
      projects: [
        { linkName: 'a', path: '/a', status: 'ok' },
        { linkName: 'b', path: '/b', status: 'unavailable' },
      ],
    });
    expect(out).toContain('a -> /a');
    expect(out).not.toContain('b -> /b');
  });
});
