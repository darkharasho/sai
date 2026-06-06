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
});
