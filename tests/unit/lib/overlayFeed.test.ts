import { describe, it, expect } from 'vitest';
import { buildOverlayPayload, type OverlayRow } from '@/lib/overlayFeed';

const row = (over: Partial<OverlayRow>): OverlayRow => ({
  path: '/p', name: 'p', kind: 'project', state: 'inactive', ...over,
});

describe('buildOverlayPayload', () => {
  it('is not reportable when everything is idle/alive', () => {
    const p = buildOverlayPayload([row({ state: 'alive' }), row({ path: '/q', state: 'inactive' })]);
    expect(p.hasReportable).toBe(false);
    expect(p.strip).toHaveLength(0);
    expect(p.focus).toBeNull();
  });

  it('strip includes every non-idle row; focus picks question > approval > busy > done', () => {
    const p = buildOverlayPayload([
      row({ path: '/busy', name: 'busy', state: 'busy' }),
      row({ path: '/done', name: 'done', state: 'done' }),
      row({ path: '/ask', name: 'ask', state: 'question', snippet: 'which one?' }),
    ]);
    expect(p.hasReportable).toBe(true);
    expect(p.strip.map(s => s.name)).toEqual(['busy', 'done', 'ask']);
    expect(p.focus?.path).toBe('/ask');
    expect(p.focus?.snippet).toBe('which one?');
  });

  it('approval beats busy; busy beats done', () => {
    expect(buildOverlayPayload([
      row({ path: '/busy', state: 'busy' }), row({ path: '/appr', state: 'approval' }),
    ]).focus?.path).toBe('/appr');
    expect(buildOverlayPayload([
      row({ path: '/busy', state: 'busy' }), row({ path: '/done', state: 'done' }),
    ]).focus?.path).toBe('/busy');
  });

  it('busy-done counts as busy for focus priority', () => {
    const p = buildOverlayPayload([row({ path: '/bd', state: 'busy-done' }), row({ path: '/d', state: 'done' })]);
    expect(p.focus?.path).toBe('/bd');
  });
});
