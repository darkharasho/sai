import { describe, it, expect } from 'vitest';
import { reconcileChatCanvases, removeCanvas, showCanvas, visibleCanvases, visibleSelection } from '../../../src/canvas/canvasSidebarState';

const ui = (o: Partial<Parameters<typeof showCanvas>[0] & object> = {}) =>
  ({ open: false, selected: null, known: [], added: [], removed: [], ...o });

describe('reconcileChatCanvases', () => {
  it('first sight of a chat is a baseline: no auto-open, restores the saved state', () => {
    expect(reconcileChatCanvases(undefined, ['/a', '/b'])).toEqual(ui({ selected: '/b', known: ['/a', '/b'] }));
    expect(reconcileChatCanvases(undefined, ['/a', '/b'], { open: true, selected: '/a', added: ['/x'], removed: ['/b'] }))
      .toEqual(ui({ open: true, selected: '/a', known: ['/a', '/b'], added: ['/x'], removed: ['/b'] }));
  });

  it('a canvas new to the chat opens the panel and selects it', () => {
    const s0 = reconcileChatCanvases(undefined, []);
    const s1 = reconcileChatCanvases(s0, ['/a']);
    expect(s1).toEqual(ui({ open: true, selected: '/a', known: ['/a'] }));
    const closed = { ...s1, open: false };
    expect(reconcileChatCanvases(closed, ['/a', '/b'])).toEqual(ui({ open: true, selected: '/b', known: ['/a', '/b'] }));
  });

  it('a stale addition (history loading late) joins the list without opening the panel', () => {
    const s0 = ui();
    expect(reconcileChatCanvases(s0, ['/a', '/b'], undefined, (p) => p === '/b')).toEqual(ui({ open: true, selected: '/b', known: ['/a', '/b'] }));
    expect(reconcileChatCanvases(s0, ['/a'], undefined, () => false)).toEqual(ui({ known: ['/a'] }));
  });

  it('later writes to a known canvas never reopen a closed panel; same list returns the same object', () => {
    const s = ui({ selected: '/a', known: ['/a'] });
    expect(reconcileChatCanvases(s, ['/a'])).toBe(s);
  });

  it('keeps an explorer-shown selection when the transcript list changes', () => {
    const s = showCanvas(ui({ known: ['/a'], selected: '/a' }), '/x');
    expect(reconcileChatCanvases(s, ['/a']).selected).toBe('/x');
  });

  it('a fresh agent write brings back a canvas the user had closed', () => {
    const s = ui({ known: [], removed: ['/a'] });
    expect(reconcileChatCanvases(s, ['/a'])).toMatchObject({ open: true, selected: '/a', removed: [] });
  });
});

describe('showCanvas / removeCanvas / visibleCanvases', () => {
  it('showCanvas opens and selects, joins added, un-removes', () => {
    expect(showCanvas(ui({ selected: '/a', known: ['/a'], removed: ['/b'] }), '/b'))
      .toEqual(ui({ open: true, selected: '/b', known: ['/a', '/b'], added: ['/b'] }));
    expect(showCanvas(undefined, '/a')).toEqual(ui({ open: true, selected: '/a', known: ['/a'], added: ['/a'] }));
  });

  it('visibleCanvases: transcript order, then added, minus removed', () => {
    expect(visibleCanvases(['/a', '/b'], ui({ added: ['/b', '/x'], removed: ['/a'] }))).toEqual(['/b', '/x']);
    expect(visibleCanvases(['/a'], undefined)).toEqual(['/a']);
  });

  it('removeCanvas: the neighbour takes the selection; the last tab collapses the panel', () => {
    const s = ui({ open: true, selected: '/b', known: ['/a', '/b', '/c'] });
    expect(removeCanvas(s, '/b', ['/a', '/b', '/c'])).toMatchObject({ open: true, selected: '/c', removed: ['/b'] });
    expect(removeCanvas(s, '/a', ['/a', '/b', '/c'])).toMatchObject({ selected: '/b', removed: ['/a'] });
    expect(removeCanvas(ui({ open: true, selected: '/x', added: ['/x'] }), '/x', ['/x'])).toMatchObject({ open: false, selected: null, added: [], removed: ['/x'] });
  });

  it('visibleSelection falls back to the first visible canvas', () => {
    expect(visibleSelection('/b', ['/a', '/b'])).toBe('/b');
    expect(visibleSelection('/gone', ['/a', '/b'])).toBe('/a');
    expect(visibleSelection(null, [])).toBeNull();
  });
});
