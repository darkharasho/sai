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

  it('grows block-by-block: unreached blocks reserve no layout until revealed', () => {
    const el = mount('<p>one two three</p><p>four five six</p><p>seven eight nine</p>');
    revealWords(el, { cadenceMs: 10, snapMs: 0, budgetMs: 1000 });
    const blocks = el.querySelectorAll<HTMLElement>('p');
    // First block enters layout immediately; later blocks are display:none (no reserved space)
    // so a multi-line reply doesn't show a tall blank region while it types in.
    expect(blocks[0].style.display).not.toBe('none');
    expect(blocks[1].style.display).toBe('none');
    expect(blocks[2].style.display).toBe('none');
    // Each block un-hides as the reveal reaches it.
    vi.runAllTimers();
    blocks.forEach(b => expect(b.style.display).not.toBe('none'));
  });

  it('cancel() un-hides every block (no content left reserved-but-hidden)', () => {
    const el = mount('<p>aa bb</p><p>cc dd</p>');
    const ctrl = revealWords(el, { cadenceMs: 10 });
    ctrl.cancel();
    el.querySelectorAll<HTMLElement>('p').forEach(b => expect(b.style.display).not.toBe('none'));
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
