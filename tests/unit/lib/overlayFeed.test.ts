import { describe, it, expect } from 'vitest';
import { buildOverlayPayload, updateRecentDone, type OverlayRow } from '@/lib/overlayFeed';

const row = (over: Partial<OverlayRow>): OverlayRow => ({
  path: '/p', name: 'p', kind: 'project', state: 'inactive', ...over,
});

describe('buildOverlayPayload', () => {
  it('is not reportable when everything is idle/alive', () => {
    const p = buildOverlayPayload([row({ state: 'alive' }), row({ path: '/q', state: 'inactive' })]);
    expect(p.hasReportable).toBe(false);
    expect(p.rows).toHaveLength(0);
    expect(p.focusPath).toBeNull();
  });

  it('rows include every non-idle row with tails; focus picks question > approval > busy > done', () => {
    const p = buildOverlayPayload([
      row({ path: '/busy', name: 'busy', state: 'busy' }),
      row({ path: '/done', name: 'done', state: 'done' }),
      row({ path: '/ask', name: 'ask', state: 'question', tail: [{ kind: 'text', text: 'which one?' }] }),
    ]);
    expect(p.hasReportable).toBe(true);
    expect(p.rows.map(s => s.name)).toEqual(['busy', 'done', 'ask']);
    expect(p.focusPath).toBe('/ask');
    expect(p.rows.find(r => r.path === '/ask')?.tail).toEqual([{ kind: 'text', text: 'which one?' }]);
  });

  it('approval beats busy; busy beats done', () => {
    expect(buildOverlayPayload([
      row({ path: '/busy', state: 'busy' }), row({ path: '/appr', state: 'approval' }),
    ]).focusPath).toBe('/appr');
    expect(buildOverlayPayload([
      row({ path: '/busy', state: 'busy' }), row({ path: '/done', state: 'done' }),
    ]).focusPath).toBe('/busy');
  });

  it('busy-done counts as busy for focus priority', () => {
    const p = buildOverlayPayload([row({ path: '/bd', state: 'busy-done' }), row({ path: '/d', state: 'done' })]);
    expect(p.focusPath).toBe('/bd');
  });
});

describe('updateRecentDone', () => {
  it('marks workspaces that stopped being busy and unmarks ones that restart', () => {
    const done = new Set<string>();
    updateRecentDone(done, new Set(['/a', '/b']), new Set(['/b']));
    expect([...done]).toEqual(['/a']);
    // /a starts a new turn → no longer done
    updateRecentDone(done, new Set(['/b']), new Set(['/a', '/b']));
    expect(done.size).toBe(0);
  });

  it('keeps prior done marks across unrelated updates', () => {
    const done = new Set<string>(['/old']);
    updateRecentDone(done, new Set(['/x']), new Set(['/x']));
    expect(done.has('/old')).toBe(true);
  });

  it('hands off to in-app tracking: paths in completedWorkspaces leave recentDone', () => {
    const done = new Set<string>();
    // Background ws finishes: recentDone covers the 300ms before App marks it
    updateRecentDone(done, new Set(['/bg']), new Set(), new Set());
    expect(done.has('/bg')).toBe(true);
    // App's completedWorkspaces picks it up → in-app unread tracking owns it,
    // so reading it on desktop (which clears completed) also clears the overlay
    updateRecentDone(done, new Set(), new Set(), new Set(['/bg']));
    expect(done.has('/bg')).toBe(false);
  });
});
