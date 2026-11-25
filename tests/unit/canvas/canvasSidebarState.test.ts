import { describe, it, expect } from 'vitest';
import { reconcileChatCanvases, showCanvas, visibleSelection } from '../../../src/canvas/canvasSidebarState';

describe('reconcileChatCanvases', () => {
  it('first sight of a chat is a baseline: no auto-open, restores the saved state', () => {
    expect(reconcileChatCanvases(undefined, ['/a', '/b'])).toEqual({ open: false, selected: '/b', known: ['/a', '/b'] });
    expect(reconcileChatCanvases(undefined, ['/a', '/b'], { open: true, selected: '/a' })).toEqual({ open: true, selected: '/a', known: ['/a', '/b'] });
  });

  it('a canvas new to the chat opens the panel and selects it', () => {
    const s0 = reconcileChatCanvases(undefined, []);
    const s1 = reconcileChatCanvases(s0, ['/a']);
    expect(s1).toEqual({ open: true, selected: '/a', known: ['/a'] });
    const closed = { ...s1, open: false };
    expect(reconcileChatCanvases(closed, ['/a', '/b'])).toEqual({ open: true, selected: '/b', known: ['/a', '/b'] });
  });

  it('a stale addition (history loading late) joins the list without opening the panel', () => {
    const s0 = { open: false, selected: null, known: [] };
    expect(reconcileChatCanvases(s0, ['/a', '/b'], undefined, (p) => p === '/b')).toEqual({ open: true, selected: '/b', known: ['/a', '/b'] });
    expect(reconcileChatCanvases(s0, ['/a'], undefined, () => false)).toEqual({ open: false, selected: null, known: ['/a'] });
  });

  it('later writes to a known canvas never reopen a closed panel; same list returns the same object', () => {
    const s = { open: false, selected: '/a', known: ['/a'] };
    expect(reconcileChatCanvases(s, ['/a'])).toBe(s);
  });
});

describe('showCanvas / visibleSelection', () => {
  it('showCanvas opens and selects, adding an unknown path to known', () => {
    expect(showCanvas({ open: false, selected: '/a', known: ['/a'] }, '/b')).toEqual({ open: true, selected: '/b', known: ['/a', '/b'] });
    expect(showCanvas(undefined, '/a')).toEqual({ open: true, selected: '/a', known: ['/a'] });
  });

  it('visibleSelection falls back to the first visible canvas', () => {
    expect(visibleSelection('/b', ['/a', '/b'])).toBe('/b');
    expect(visibleSelection('/gone', ['/a', '/b'])).toBe('/a');
    expect(visibleSelection(null, [])).toBeNull();
  });
});
