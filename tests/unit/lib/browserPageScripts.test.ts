/**
 * The snapshot/read functions ship as source strings for CDP Runtime.evaluate,
 * so they can be exercised here by eval'ing them against jsdom.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-expect-error - plain JS module shared with the unpacked extension
import {
  SNAPSHOT_FN_SOURCE,
  READ_FN_SOURCE,
  RESOLVE_FN_SOURCE,
  SCROLL_FN_SOURCE,
} from '../../../extension/chrome/pageScripts.js';

type Snapshot = {
  url: string;
  title: string;
  viewport: { w: number; h: number };
  elements: Array<Record<string, any>>;
  truncated: boolean;
};

function snapshot(opts: Record<string, unknown> = {}): Snapshot {
  // eslint-disable-next-line no-eval
  return eval(`(${SNAPSHOT_FN_SOURCE})`)(opts);
}

function read(opts: Record<string, unknown> = {}): Record<string, any> {
  // eslint-disable-next-line no-eval
  return eval(`(${READ_FN_SOURCE})`)(opts);
}

function byRole(snap: Snapshot, role: string) {
  return snap.elements.filter((e) => e.role === role);
}

function resolve(opts: Record<string, unknown> = {}): Record<string, any> {
  // eslint-disable-next-line no-eval
  return eval(`(${RESOLVE_FN_SOURCE})`)(opts);
}

function scrollPage(opts: Record<string, unknown> = {}): Record<string, any> {
  // eslint-disable-next-line no-eval
  return eval(`(${SCROLL_FN_SOURCE})`)(opts);
}

let restore: Array<() => void> = [];

beforeEach(() => {
  // jsdom has no layout: every element reports a zero-size, rect-less box, so
  // the visibility filter would drop everything. Give it a plausible one.
  const rects = Object.getOwnPropertyDescriptor(Element.prototype, 'getClientRects');
  const box = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
  Element.prototype.getClientRects = function () {
    return [{ width: 100, height: 20 }] as unknown as DOMRectList;
  };
  Element.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 20, width: 100, height: 20 } as DOMRect;
  };
  restore = [
    () => (rects ? Object.defineProperty(Element.prototype, 'getClientRects', rects) : undefined),
    () => (box ? Object.defineProperty(Element.prototype, 'getBoundingClientRect', box) : undefined),
  ];
  document.title = 'Test Page';
});

afterEach(() => {
  restore.forEach((fn) => fn());
  document.body.innerHTML = '';
});

describe('page snapshot', () => {
  it('reports page metadata alongside the elements', () => {
    document.body.innerHTML = '<button>Go</button>';
    const snap = snapshot();
    expect(snap.title).toBe('Test Page');
    expect(snap.url).toBe(window.location.href);
    expect(snap.viewport).toEqual({ w: window.innerWidth, h: window.innerHeight });
  });

  it('assigns sequential refs and resolves them on window.__saiRefs', () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const snap = snapshot();

    expect(snap.elements.map((e) => e.ref)).toEqual(['e1', 'e2']);
    const refs = (window as any).__saiRefs as Element[];
    expect(refs).toHaveLength(2);
    expect((refs[0] as HTMLElement).id).toBe('a');
    expect((refs[1] as HTMLElement).id).toBe('b');
  });

  it('derives roles from tags, input types, and explicit role attrs', () => {
    document.body.innerHTML = `
      <a href="/x">Link</a>
      <input type="checkbox" aria-label="Agree">
      <input type="text" aria-label="Name">
      <div role="tab" aria-label="Second">tab</div>
    `;
    const snap = snapshot();
    const roles = snap.elements.map((e) => e.role);
    expect(roles).toContain('link');
    expect(roles).toContain('checkbox');
    expect(roles).toContain('textbox');
    expect(roles).toContain('tab');
  });

  it('prefers aria-label, then the label element, then placeholder, then text', () => {
    document.body.innerHTML = `
      <button aria-label="Explicit">ignored text</button>
      <label for="email">Email address</label><input id="email" type="text">
      <input id="ph" type="text" placeholder="Search docs">
      <button id="txt">Just text</button>
    `;
    const snap = snapshot();
    const names = snap.elements.map((e) => e.name);
    expect(names).toContain('Explicit');
    expect(names).toContain('Email address');
    expect(names).toContain('Search docs');
    expect(names).toContain('Just text');
  });

  it('resolves aria-labelledby through the referenced nodes', () => {
    document.body.innerHTML = `
      <span id="l1">Delete</span><span id="l2">account</span>
      <button aria-labelledby="l1 l2"></button>
    `;
    const snap = snapshot();
    expect(byRole(snap, 'button')[0].name).toBe('Delete account');
  });

  it('masks password values but reports other field values', () => {
    document.body.innerHTML = `
      <input type="password" aria-label="Password" value="hunter2">
      <input type="text" aria-label="User" value="mike">
    `;
    const snap = snapshot();
    const pw = snap.elements.find((e) => e.name === 'Password');
    const user = snap.elements.find((e) => e.name === 'User');

    expect(pw!.value).toBe('•••');
    expect(JSON.stringify(snap)).not.toContain('hunter2');
    expect(user!.value).toBe('mike');
  });

  it('marks interactive, disabled, and checked state and captures href', () => {
    document.body.innerHTML = `
      <a href="/docs">Docs</a>
      <button disabled>Nope</button>
      <input type="checkbox" aria-label="On" checked>
    `;
    const snap = snapshot();
    expect(byRole(snap, 'link')[0]).toMatchObject({ interactive: true, href: '/docs' });
    expect(byRole(snap, 'button')[0]).toMatchObject({ disabled: true });
    expect(byRole(snap, 'checkbox')[0]).toMatchObject({ checked: true });
  });

  it('includes a bounding box for every element', () => {
    document.body.innerHTML = '<button>Go</button>';
    expect(snapshot().elements[0].box).toEqual({ x: 10, y: 20, w: 100, h: 20 });
  });

  it('drops hidden elements', () => {
    document.body.innerHTML = `
      <button style="display:none">Hidden</button>
      <button style="visibility:hidden">Invisible</button>
      <button>Shown</button>
    `;
    const names = snapshot().elements.map((e) => e.name);
    expect(names).toEqual(['Shown']);
  });

  it('drops unnamed structural elements but keeps unnamed interactive ones', () => {
    document.body.innerHTML = '<h2></h2><button></button>';
    const snap = snapshot();
    expect(byRole(snap, 'heading')).toHaveLength(0);
    expect(byRole(snap, 'button')).toHaveLength(1);
  });

  it('never lists the same element twice across the two passes', () => {
    // A <label role="button"> matches both the interactive and structural
    // selectors; the seen-set has to dedupe it.
    document.body.innerHTML = '<label role="button">Both</label>';
    expect(snapshot().elements).toHaveLength(1);
  });

  it('caps the element count and flags truncation', () => {
    document.body.innerHTML = Array.from({ length: 10 }, (_, i) => `<button>B${i}</button>`).join('');
    const snap = snapshot({ maxElements: 4 });
    expect(snap.elements).toHaveLength(4);
    expect(snap.truncated).toBe(true);
  });

  it('reports how much it left out, not just that it did', () => {
    document.body.innerHTML = Array.from({ length: 10 }, (_, i) => `<button>B${i}</button>`).join('');
    const snap = snapshot({ maxElements: 4 }) as any;
    expect(snap).toMatchObject({ total: 10, offset: 0, returned: 4, truncated: true });
    expect(snap.hint).toContain('offset:4');
  });

  it('collapses whitespace and truncates long names', () => {
    document.body.innerHTML = `<button>  lots\n   of\tspace  </button><button>${'x'.repeat(300)}</button>`;
    const snap = snapshot();
    expect(snap.elements[0].name).toBe('lots of space');
    expect(snap.elements[1].name).toHaveLength(120);
    expect(snap.elements[1].name.endsWith('…')).toBe(true);
  });
});

/**
 * The reason this block exists: an element the caller was never shown is an
 * element it cannot click. On a real app (Gmail's filter panel) the controls
 * render *after* a 50-row result grid, so a 300-element snapshot was still
 * inside the rows and the panel's checkbox had no reachable ref at all.
 * Keyboard focus could reach it; the snapshot could not address it.
 */
describe('reaching elements that render late in the DOM', () => {
  /** A long result list, then the panel you actually came for. */
  function gridThenDialog() {
    const rows = Array.from(
      { length: 50 },
      (_, i) => `<a href="/msg/${i}">Message ${i} from someone</a>`,
    ).join('');
    document.body.innerHTML = `
      ${rows}
      <div role="dialog" aria-modal="true" aria-label="Create a filter">
        <input type="checkbox" id="skip" aria-label="Skip the Inbox (Archive it)">
        <button id="create">Create filter</button>
      </div>
    `;
  }

  it('lists an open modal first, even though it is last in the DOM', () => {
    gridThenDialog();
    const snap = snapshot({ maxElements: 10 });
    const names = snap.elements.map((e) => e.name);

    // Without modal-first ordering this whole window would be rows 0-9 and
    // the checkbox would have no ref at all.
    expect(names).toContain('Skip the Inbox (Archive it)');
    expect(names).toContain('Create filter');

    // The invariant, rather than exact positions: every modal element comes
    // before every non-modal one.
    const lastModal = snap.elements.findLastIndex((e) => e.inModal);
    const firstOutside = snap.elements.findIndex((e) => !e.inModal);
    expect(lastModal).toBeLessThan(firstOutside);
    expect(snap.elements[firstOutside].name).toContain('Message 0');
  });

  it('keeps refs pointing at what it actually showed after reordering', () => {
    gridThenDialog();
    const snap = snapshot({ maxElements: 10 });

    // The ref->element mapping must follow the emitted order, or a ref would
    // resolve to a message row while the caller thinks it is the checkbox.
    const checkbox = snap.elements.find((e) => e.role === 'checkbox')!;
    const refs = (window as any).__saiRefs as HTMLElement[];
    expect(refs[Number(checkbox.ref.slice(1)) - 1].id).toBe('skip');

    const hit = resolve({ ref: checkbox.ref, refGen: snap.refGen });
    expect(hit.tag).toBe('INPUT');
    expect(hit.error).toBeUndefined();
  });

  it('says a modal is open, so a click aimed behind it is not a blind failure', () => {
    gridThenDialog();
    const snap = snapshot({ maxElements: 5 }) as any;
    expect(snap.modal.name).toBe('Create a filter');
  });

  it('finds a named control by substring instead of paging to it', () => {
    gridThenDialog();
    const snap = snapshot({ match: 'skip the inbox' }) as any;

    expect(snap.elements).toHaveLength(1);
    expect(snap.elements[0].name).toBe('Skip the Inbox (Archive it)');
    expect(snap.total).toBe(1);
    // Filtering narrows what is addressable to what was shown, and that ref
    // still has to resolve.
    expect(resolve({ ref: 'e1', refGen: snap.refGen }).tag).toBe('INPUT');
  });

  it('matches on role as well as name', () => {
    gridThenDialog();
    expect(snapshot({ match: 'checkbox' }).elements).toHaveLength(1);
  });

  it('still excludes hidden elements that match', () => {
    // match is tested before visible() for cost reasons, so the visibility
    // filter has to survive that reordering.
    document.body.innerHTML = `
      <button style="display:none">Save draft</button>
      <button>Save</button>
    `;
    const names = snapshot({ match: 'save' }).elements.map((e) => e.name);
    expect(names).toEqual(['Save']);
  });

  it('pages past the cap with offset', () => {
    document.body.innerHTML = Array.from({ length: 12 }, (_, i) => `<button>B${i}</button>`).join('');

    const page2 = snapshot({ maxElements: 5, offset: 5 }) as any;
    expect(page2.elements.map((e: any) => e.name)).toEqual(['B5', 'B6', 'B7', 'B8', 'B9']);
    // Ref labels number the whole list, not the window, so they stay stable
    // across pages of the same snapshot.
    expect(page2.elements[0].ref).toBe('e6');
    expect(page2).toMatchObject({ total: 12, offset: 5, returned: 5, truncated: true });

    const page3 = snapshot({ maxElements: 5, offset: 10 }) as any;
    expect(page3.returned).toBe(2);
    expect(page3.truncated).toBe(false);
  });

  it('scopes to a region with root', () => {
    gridThenDialog();
    const snap = snapshot({ root: '[role="dialog"]' }) as any;
    expect(snap.elements.map((e: any) => e.name)).toEqual([
      'Skip the Inbox (Archive it)', 'Create filter',
    ]);
    expect(snap.root).toBe('[role="dialog"]');
  });

  it('refuses a bad or unmatched root rather than silently snapshotting everything', () => {
    gridThenDialog();
    expect((snapshot({ root: '[[[' }) as any).error).toMatch(/invalid root selector/);
    expect((snapshot({ root: '#nope' }) as any).error).toMatch(/no element matched/);
  });

  it('reports checked state as an explicit boolean, including aria-checked', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="on" aria-label="On" checked>
      <input type="checkbox" aria-label="Off">
      <div role="switch" aria-checked="true" aria-label="Custom">s</div>
      <button>Plain</button>
    `;
    const snap = snapshot();
    const by = (name: string) => snap.elements.find((e) => e.name === name);

    // Absent would be ambiguous: the caller needs to know whether a toggle
    // still needs toggling before it presses Space on it.
    expect(by('On')!.checked).toBe(true);
    expect(by('Off')!.checked).toBe(false);
    expect(by('Custom')!.checked).toBe(true);
    expect(by('Plain')).not.toHaveProperty('checked');
  });

  it('flags which element has focus', () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    document.getElementById('b')!.focus();

    const snap = snapshot();
    expect(snap.elements.find((e) => e.name === 'B')!.focused).toBe(true);
    expect(snap.elements.find((e) => e.name === 'A')).not.toHaveProperty('focused');
  });
});

describe('page read', () => {
  it('returns page text with metadata', () => {
    document.body.innerHTML = '<p>Hello</p><p>World</p>';
    const res = read();
    expect(res.title).toBe('Test Page');
    expect(res.selector).toBeNull();
    expect(res.text).toContain('Hello');
    expect(res.truncated).toBe(false);
  });

  it('scopes to a selector', () => {
    document.body.innerHTML = '<main>Wanted</main><aside>Unwanted</aside>';
    const res = read({ selector: 'main' });
    expect(res.text).toBe('Wanted');
    expect(res.selector).toBe('main');
  });

  it('reports a selector that matches nothing', () => {
    document.body.innerHTML = '<main>x</main>';
    expect(read({ selector: '#missing' }).error).toMatch(/no element matched/);
  });

  it('reports an invalid selector rather than throwing', () => {
    expect(read({ selector: '>>>' }).error).toMatch(/invalid selector/);
  });

  it('truncates at maxChars and flags it', () => {
    document.body.innerHTML = `<p>${'a'.repeat(500)}</p>`;
    const res = read({ maxChars: 100 });
    expect(res.text).toHaveLength(100);
    expect(res.truncated).toBe(true);
  });
});

describe('ref resolution', () => {
  // These are the tests that matter most: every bug here means acting on the
  // wrong element, which is worse than not acting at all.
  it('resolves a ref to the centre of its box', () => {
    document.body.innerHTML = '<button id="a">A</button>';
    const snap = snapshot();
    const res = resolve({ ref: 'e1', refGen: snap.refGen });

    // The stubbed rect is left:10 top:20 width:100 height:20.
    expect(res.error).toBeUndefined();
    expect(res).toMatchObject({ x: 60, y: 30, tag: 'BUTTON' });
  });

  it('refuses a ref from an older snapshot generation', () => {
    document.body.innerHTML = '<button>A</button>';
    const first = snapshot();
    document.body.innerHTML = '<button>Totally different</button>';
    const second = snapshot();

    expect(second.refGen).toBe(first.refGen + 1);
    expect(resolve({ ref: 'e1', refGen: first.refGen }).error).toMatch(/stale/);
    expect(resolve({ ref: 'e1', refGen: second.refGen }).error).toBeUndefined();
  });

  it('refuses a ref whose element left the document', () => {
    document.body.innerHTML = '<button id="a">A</button>';
    const snap = snapshot();
    document.getElementById('a')!.remove();

    expect(resolve({ ref: 'e1', refGen: snap.refGen }).error).toMatch(/no longer in the page/);
  });

  it('refuses a disabled element', () => {
    document.body.innerHTML = '<button disabled>A</button>';
    const snap = snapshot();
    expect(resolve({ ref: 'e1', refGen: snap.refGen }).error).toMatch(/disabled/);
  });

  it('refuses malformed and unknown refs', () => {
    document.body.innerHTML = '<button>A</button>';
    const snap = snapshot();
    expect(resolve({ ref: 'button', refGen: snap.refGen }).error).toMatch(/bad ref/);
    expect(resolve({ ref: 'e99', refGen: snap.refGen }).error).toMatch(/unknown ref/);
  });

  it('refuses when no snapshot has been taken', () => {
    delete (window as any).__saiRefs;
    expect(resolve({ ref: 'e1' }).error).toMatch(/no snapshot refs/);
  });

  it('refuses an element whose centre is outside the viewport', () => {
    document.body.innerHTML = '<button>A</button>';
    const snap = snapshot();
    Element.prototype.getBoundingClientRect = function () {
      return { left: -500, top: -500, width: 100, height: 20 } as DOMRect;
    };
    expect(resolve({ ref: 'e1', refGen: snap.refGen }).error).toMatch(/outside the viewport/);
  });

  it('clears a field only when asked', () => {
    document.body.innerHTML = '<input id="f" value="old">';
    const snap = snapshot();
    const field = document.getElementById('f') as HTMLInputElement;

    resolve({ ref: 'e1', refGen: snap.refGen, focus: true });
    expect(field.value).toBe('old');

    resolve({ ref: 'e1', refGen: snap.refGen, clear: true });
    expect(field.value).toBe('');
  });

  // `'value' in el` is true for buttons, selects and checkboxes, so it cannot
  // be used to decide "can I type here" — these cases pin that down.
  it('treats only real text inputs as editable', () => {
    document.body.innerHTML = `
      <input type="text" aria-label="t">
      <input type="search" aria-label="s">
      <textarea aria-label="ta"></textarea>
      <div contenteditable="true" role="textbox" aria-label="ce">x</div>
      <button aria-label="b">B</button>
      <input type="checkbox" aria-label="c">
      <input type="submit" aria-label="sub">
      <select aria-label="sel"><option>a</option></select>
    `;
    const snap = snapshot();
    const editableByName: Record<string, boolean> = {};
    for (const el of snap.elements) {
      editableByName[el.name] = resolve({ ref: el.ref, refGen: snap.refGen }).editable;
    }

    expect(editableByName).toMatchObject({
      t: true, s: true, ta: true, ce: true,
      b: false, c: false, sub: false, sel: false,
    });
  });

  it('does not clear a non-editable element', () => {
    document.body.innerHTML = '<input type="checkbox" aria-label="c" checked>';
    const snap = snapshot();
    resolve({ ref: 'e1', refGen: snap.refGen, clear: true });
    expect((document.querySelector('input') as HTMLInputElement).checked).toBe(true);
  });
});

describe('page scroll', () => {
  it('reports whether the page actually moved', () => {
    const res = scrollPage({ dy: 400 });
    // jsdom does not implement scrolling, so nothing moves — the point is that
    // we report that truthfully instead of claiming success.
    expect(res).toMatchObject({ moved: false });
    expect(res.scroll).toEqual({ x: 0, y: 0 });
  });
});
