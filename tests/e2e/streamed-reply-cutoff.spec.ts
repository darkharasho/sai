import { test, expect } from './electron.setup';

/**
 * Repro for the v1.12.14 dogfood report: a reply that streams, pauses
 * mid-sentence past the 250ms stream-idle settle, then continues, rendered CUT
 * OFF at the pause point — the CLI transcript had the full text. jsdom
 * couldn't reproduce (state is correct there); this drives the real renderer
 * where framer height animations and overflow clipping actually run.
 *
 * The scripted turn mirrors the real one: a thinking-ish gap, a burst of
 * text, a >250ms pause at "Discord-", then the tail of the sentence, then
 * result/done shortly after the last token.
 */

const HEAD_TEXT =
  'The release notes look solid. Bullets about the team count bar all rendered. I left out the two Discord-';
const TAIL_TEXT =
  'embed CI fixes since they do not affect users in-game. If these notes look good, I will bump and publish the release.';

test.describe('streamed reply with a mid-sentence pause', () => {
  test.use({
    saiMock: {
      claudeOnMessage: (cb: any) => {
        const t = ((window as any).__saiTriggers = (window as any).__saiTriggers || {});
        (t.claudeSubs = t.claudeSubs || []).push(cb);
        // Real unsubscribe: ChatPanel re-subscribes on effect re-runs, and a
        // no-op here leaves stale handlers that double-append every delta.
        return () => { t.claudeSubs = t.claudeSubs.filter((c: any) => c !== cb); };
      },
      claudeSend: (projectPath: string, _p: any, _i: any, _pm: any, _e: any, _m: any, scope: string) => {
        const t = (window as any).__saiTriggers;
        const emit = (m: any) =>
          t?.claudeSubs?.forEach((cb: any) => cb({ projectPath, scope: scope || 'chat', ...m }));
        const delta = (text: string) => ({
          type: 'assistant',
          message: { content: [{ type: 'text', delta: true, text }] },
        });
        emit({ type: 'streaming_start' });
        // SDK shape: summarized reasoning streams first (showReasoning on),
        // as in the real cut-off turn (thinking block preceding the text).
        let at = 400;
        for (const chunk of ['Weighing which fixes ', 'belong in the notes ', 'and which are internal.']) {
          setTimeout(() => emit({ type: 'reasoning_delta', text: chunk }), at);
          at += 120;
        }
        at += 400;
        // Head streams in small chunks (watched live), ending at "Discord-".
        const headWords = (window as any).__cutoffHead.split(/(?<= )/);
        for (const w of headWords) {
          setTimeout(() => emit(delta(w)), at);
          at += 40;
        }
        // Mid-sentence pause well past the 250ms settle debounce.
        at += 700;
        const tailWords = (window as any).__cutoffTail.split(/(?<= )/);
        for (const w of tailWords) {
          setTimeout(() => emit(delta(w)), at);
          at += 40;
        }
        // SDK reconcile: the complete assistant frame re-sends the full text
        // tagged `final` (replace semantics — must not duplicate the reply).
        setTimeout(() => emit({
          type: 'assistant',
          message: { content: [
            { type: 'thinking', thinking: 'Weighing which fixes belong in the notes.' },
            { type: 'text', text: (window as any).__cutoffHead + (window as any).__cutoffTail, final: true },
          ] },
        }), at + 100);
        // Turn ends shortly after the last token (result wrap-up).
        setTimeout(() => { emit({ type: 'result' }); emit({ type: 'done' }); }, at + 300);
      },
    },
  });

  test('text after the pause is present AND actually visible', async ({ window }) => {
    await window.evaluate(([head, tail]: string[]) => {
      (window as any).__cutoffHead = head;
      (window as any).__cutoffTail = tail;
    }, [HEAD_TEXT, TAIL_TEXT]);

    const chatInput = window.locator('textarea').first();
    await chatInput.waitFor({ state: 'visible', timeout: 20000 });
    await chatInput.click({ force: true });
    await chatInput.fill('draft the release notes');
    await window.keyboard.press('Enter');

    // Wait for the turn to fully finish (head + pause + tail + wrap-up).
    await window.waitForTimeout(7000);

    const result = await window.evaluate(() => {
      const bodies = Array.from(document.querySelectorAll('.chat-msg-md')) as HTMLElement[];
      const el = bodies.find(b => (b.textContent || '').includes('I left out the two Discord-'));
      if (!el) return { found: false } as any;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // Locate the LAST word of the reply and check it isn't clipped/hidden.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let lastTextNode: Node | null = null;
      while (walker.nextNode()) {
        if ((walker.currentNode.textContent || '').trim()) lastTextNode = walker.currentNode;
      }
      let lastWordVisible = false;
      let lastWordText = '';
      let lastRect: any = null;
      if (lastTextNode) {
        lastWordText = lastTextNode.textContent || '';
        const range = document.createRange();
        range.selectNodeContents(lastTextNode);
        const r = range.getBoundingClientRect();
        lastRect = { top: r.top, bottom: r.bottom, height: r.height };
        // Clipped-by-ancestor check: the word's box must fall inside every
        // overflow-hidden ancestor's box.
        lastWordVisible = r.height > 0;
        let anc: HTMLElement | null = lastTextNode.parentElement;
        while (anc && lastWordVisible) {
          const acs = getComputedStyle(anc);
          if (acs.overflow === 'hidden' || acs.overflowY === 'hidden') {
            const ar = anc.getBoundingClientRect();
            if (r.bottom > ar.bottom + 1 || r.top < ar.top - 1) lastWordVisible = false;
          }
          if (parseFloat(acs.opacity) === 0 || acs.display === 'none') lastWordVisible = false;
          anc = anc.parentElement;
        }
      }
      return {
        found: true,
        fullText: (el.textContent || '').slice(-140),
        mdHeightStyle: (el.getAttribute('style') || ''),
        mdOverflow: cs.overflow,
        mdRectHeight: rect.height,
        mdScrollHeight: el.scrollHeight,
        lastWordText,
        lastWordVisible,
        lastRect,
      };
    });

    console.log('CUTOFF-DIAG', JSON.stringify(result, null, 2));
    expect(result.found).toBe(true);
    // State: the tail text must be in the DOM at all.
    expect(result.fullText).toContain('bump and publish the release');
    // Reconcile frame must REPLACE, not duplicate, the streamed text.
    expect(result.fullText).not.toContain('release.The');
    // Render: the md container must not be clipping its own content...
    expect(result.mdScrollHeight - result.mdRectHeight).toBeLessThan(4);
    // ...and the final word must be genuinely visible.
    expect(result.lastWordVisible).toBe(true);
  });
});
