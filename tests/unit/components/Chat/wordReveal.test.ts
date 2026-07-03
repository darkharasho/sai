import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { revealWords } from '../../../../src/components/Chat/wordReveal';

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('revealWords', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('wraps prose words in spans and leaves code blocks atomic', () => {
    const el = mount('<p>hello brave world</p><pre><code>const x = 1;</code></pre>');
    revealWords(el);
    expect(el.querySelectorAll('.rv-word').length).toBe(3);
    expect(el.querySelector('pre')).toBeTruthy();
    expect(el.querySelector('pre .rv-word')).toBeNull();
  });

  it('hides emoji icons (svg + masked span) as atomic items instead of popping them', () => {
    // SVG elements report a LOWERCASE tagName; mask emojis are empty spans with
    // no text nodes — both must join the sweep or they render ahead of it.
    const el = mount(
      '<p>party <svg class="sai-emoji-icon"></svg> time <span class="sai-emoji-mask"></span> now</p>'
    );
    revealWords(el);
    const icon = el.querySelector('.sai-emoji-icon') as HTMLElement;
    const mask = el.querySelector('.sai-emoji-mask') as HTMLElement;
    expect(icon.style.opacity).toBe('0');
    expect(mask.style.opacity).toBe('0');
    vi.runAllTimers();
    expect(icon.style.opacity).toBe('1');
    expect(mask.style.opacity).toBe('1');
  });

  it('reveals every item and removes the caret after all timers run', () => {
    const el = mount('<p>one two three</p>');
    revealWords(el);
    vi.runAllTimers();
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });

  it('renders instantly (all visible, no caret) when word count exceeds maxWords', () => {
    const many = Array.from({ length: 50 }, (_, i) => 'w' + i).join(' ');
    const el = mount('<p>' + many + '</p>');
    revealWords(el, { maxWords: 10 });
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });

  it('completes within the duration budget for many words (shrunk cadence)', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'w' + i).join(' ');
    const el = mount('<p>' + many + '</p>');
    revealWords(el, { budgetMs: 200, maxWords: 100 });
    vi.advanceTimersByTime(300);
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
  });

  it('cancel() forces the final visible state and removes the caret', () => {
    const el = mount('<p>alpha beta gamma delta</p>');
    const ctrl = revealWords(el);
    ctrl.cancel();
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });

  it('moves the caret across paragraph boundaries and ends clean', () => {
    const el = mount('<p>one two</p><p>three four</p>');
    revealWords(el);
    vi.runAllTimers();
    expect(el.querySelectorAll('.rv-word').length).toBe(4);
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });

  it('grows as it types: trailing blocks stay hidden until the sweep reaches them', () => {
    // Long replies used to reserve their FULL final height as opacity-0 words
    // (a big blank slab until the reveal swept through). Blocks now un-hide as
    // the caret reaches them; ChatPanel's ResizeObserver keeps the bottom pin.
    const el = mount('<p>one two three</p><p>four five six</p><p>seven eight nine</p>');
    revealWords(el, { cadenceMs: 10, snapMs: 0, budgetMs: 1000 });
    const blocks = el.querySelectorAll<HTMLElement>('p');
    // Prep (before any timers): first block visible, the rest hidden.
    expect(blocks[0].style.display).not.toBe('none');
    expect(blocks[1].style.display).toBe('none');
    expect(blocks[2].style.display).toBe('none');
    // Sweep reaches the second paragraph → it un-hides; the third is still hidden.
    vi.advanceTimersByTime(35);
    expect(blocks[1].style.display).not.toBe('none');
    expect(blocks[2].style.display).toBe('none');
    // Everything visible at the end.
    vi.runAllTimers();
    blocks.forEach(b => expect(b.style.display).not.toBe('none'));
  });

  it('subdivides lists: items grow one-by-one and the shell hides until reached', () => {
    const el = mount('<p>intro</p><ul><li>alpha beta</li><li>gamma delta</li></ul>');
    revealWords(el, { cadenceMs: 10, snapMs: 0, budgetMs: 1000 });
    const ul = el.querySelector('ul') as HTMLElement;
    const lis = el.querySelectorAll<HTMLElement>('li');
    expect(ul.style.display).toBe('none');
    expect(lis[0].style.display).toBe('none');
    expect(lis[1].style.display).toBe('none');
    vi.runAllTimers();
    expect(ul.style.display).not.toBe('none');
    lis.forEach(li => expect(li.style.display).not.toBe('none'));
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
  });

  it('cancel() un-hides every block, including trailing no-item blocks', () => {
    const el = mount('<p>alpha beta</p><p>gamma</p><hr>');
    const ctrl = revealWords(el, { cadenceMs: 10, snapMs: 0 });
    ctrl.cancel();
    el.querySelectorAll<HTMLElement>('p, hr').forEach(b => {
      expect(b.style.display).not.toBe('none');
    });
  });

  it('does not hide blocks on the instant (over-maxWords) path', () => {
    const many = Array.from({ length: 50 }, (_, i) => 'w' + i).join(' ');
    const el = mount('<p>' + many + '</p><p>tail end here</p>');
    revealWords(el, { maxWords: 10 });
    el.querySelectorAll<HTMLElement>('p').forEach(b => expect(b.style.display).not.toBe('none'));
  });

  it('respects the duration budget for long replies by batching', () => {
    const many = Array.from({ length: 300 }, (_, i) => 'w' + i).join(' ');
    const el = mount('<p>' + many + '</p>');
    revealWords(el, { budgetMs: 200, maxWords: 1000 });
    // With a 200ms budget and an 8ms floor, items reveal in batches; the whole
    // thing must finish well under the naive 300*8=2400ms.
    vi.advanceTimersByTime(260);
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });
});
