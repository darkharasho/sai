/**
 * The snapshot/read functions ship as source strings for CDP Runtime.evaluate,
 * so they can be exercised here by eval'ing them against jsdom.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-expect-error - plain JS module shared with the unpacked extension
import { SNAPSHOT_FN_SOURCE, READ_FN_SOURCE } from '../../../extension/chrome/pageScripts.js';

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

  it('collapses whitespace and truncates long names', () => {
    document.body.innerHTML = `<button>  lots\n   of\tspace  </button><button>${'x'.repeat(300)}</button>`;
    const snap = snapshot();
    expect(snap.elements[0].name).toBe('lots of space');
    expect(snap.elements[1].name).toHaveLength(120);
    expect(snap.elements[1].name.endsWith('…')).toBe(true);
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
