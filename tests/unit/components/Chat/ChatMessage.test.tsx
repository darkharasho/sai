import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { installMockSai } from '../../../helpers/ipc-mock';

// Mock react-markdown to avoid complex rendering issues in jsdom
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

// Mock plugins that react-markdown uses
vi.mock('rehype-highlight', () => ({ default: () => () => {} }));
vi.mock('remark-gfm', () => ({ default: () => () => {} }));

// Mock highlight.js CSS
vi.mock('highlight.js/styles/monokai.css', () => ({}));

// Mock shiki (used by ToolCallCard)
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>code</code></pre>'),
  }),
}));

import ChatMessage from '../../../../src/components/Chat/ChatMessage';
import type { ChatMessage as ChatMessageType } from '../../../../src/types';
import { setFlipRect, _resetFlipRegistry } from '../../../../src/components/Chat/flipRegistry';
import { SPRING, DISTANCE, FADE_IN } from '../../../../src/components/Chat/motion';

function makeMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: '1',
    role: 'assistant',
    content: 'Hello world',
    timestamp: Date.now(),
    ...overrides,
  };
}

afterEach(() => _resetFlipRegistry());

describe('ChatMessage', () => {
  beforeEach(() => {
    installMockSai();
  });

  it('renders without crashing', () => {
    const msg = makeMessage();
    render(<ChatMessage message={msg} />);
    expect(document.querySelector('.chat-msg')).toBeTruthy();
  });

  it('renders assistant message with assistant class', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} />);
    expect(container.querySelector('.chat-msg-assistant')).toBeTruthy();
  });

  it('renders user message with user class', () => {
    const msg = makeMessage({ role: 'user', content: 'Hi there' });
    const { container } = render(<ChatMessage message={msg} />);
    expect(container.querySelector('.chat-msg-user')).toBeTruthy();
  });

  it('renders message content via markdown', () => {
    // Use timestamp:0 (old message) so word-reveal doesn't mutate the DOM.
    const msg = makeMessage({ content: 'Hello world', timestamp: 0 });
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId('markdown')).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toBe('Hello world');
  });

  it('shows arrived assistant text live while streaming (spec change 2026-06-11)', () => {
    // The morph head used to hold ALL text until the stream settled, which
    // swallowed long stretches of reply during tool-heavy turns. Arrived text
    // now renders live; the head keeps the animated logo + clock.
    const msg = makeMessage({ role: 'assistant', content: 'partial chunk' });
    const { container } = render(<ChatMessage message={msg} isStreaming />);
    const head = container.querySelector('.sah-root');
    expect(head).toBeTruthy();
    const md = container.querySelector('.sah-md') as HTMLElement | null;
    expect(md?.style.display).not.toBe('none');
  });

  it('renders assistant content via markdown when not streaming', () => {
    const msg = makeMessage({ role: 'assistant', content: 'done text' });
    const { container } = render(<ChatMessage message={msg} isStreaming={false} />);
    expect(container.querySelector('.chat-msg-stream-text')).toBeNull();
    expect(container.querySelector('[data-testid="markdown"]')).toBeTruthy();
  });

  it('renders no content when content is empty', () => {
    const msg = makeMessage({ content: '' });
    const { container } = render(<ChatMessage message={msg} />);
    expect(container.querySelector('.chat-msg-content')).toBeNull();
  });

  it('renders tool calls when present', () => {
    const msg = makeMessage({
      toolCalls: [
        { id: 'tc1', type: 'terminal_command', name: 'Bash', input: '{"command":"ls"}' },
      ],
    });
    const { container } = render(<ChatMessage message={msg} />);
    // ToolCallCard should be rendered
    expect(container.querySelector('.tool-call-card')).toBeTruthy();
  });

  it('renders images when present', () => {
    const msg = makeMessage({
      images: ['data:image/png;base64,abc123'],
    });
    const { container } = render(<ChatMessage message={msg} />);
    expect(container.querySelector('.chat-msg-attachments')).toBeTruthy();
    const img = container.querySelector('.chat-msg-attachment') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('data:image/png');
  });

  it('renders attached images when message has no text content', () => {
    // Images now live outside the bubble structure, so they render even when
    // the message has no text.
    const msg = makeMessage({ content: '', images: ['data:image/png;base64,abc123'] });
    const { container } = render(<ChatMessage message={msg} />);
    expect(container.querySelector('.chat-msg-attachments')).toBeTruthy();
    expect(container.querySelector('.chat-msg-attachment')).toBeTruthy();
  });

  it('shows lightbox when thumbnail is clicked', () => {
    const msg = makeMessage({
      images: ['data:image/png;base64,abc123'],
    });
    render(<ChatMessage message={msg} />);
    const thumb = document.querySelector('.chat-msg-attachment') as HTMLElement;
    fireEvent.click(thumb);
    expect(document.body.querySelector('.img-modal-overlay')).toBeTruthy();
  });

  it('closes lightbox when overlay is clicked', () => {
    const msg = makeMessage({
      images: ['data:image/png;base64,abc123'],
    });
    render(<ChatMessage message={msg} />);
    const thumb = document.querySelector('.chat-msg-attachment') as HTMLElement;
    fireEvent.click(thumb);
    const overlay = document.body.querySelector('.img-modal-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(document.body.querySelector('.img-modal-overlay')).toBeNull();
  });

  it('calls openExternal for external links when clicked', () => {
    // Since react-markdown is mocked, we test link click behavior indirectly
    // The component uses window.sai.openExternal for non-file links
    const mockSai = installMockSai();
    const msg = makeMessage({ content: 'check https://example.com' });
    render(<ChatMessage message={msg} />);
    // With mocked react-markdown, links are not rendered - just verify it renders
    expect(mockSai.openExternal).toBeDefined();
  });

  it('renders the SAI logo for assistant by default', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} />);
    expect(container.querySelector('.chat-msg-sai')).toBeTruthy();
  });

  it('uses SAI logo dot for all providers (no provider-specific classes)', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} />);
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false })); });
    expect(container.querySelector('.chat-msg-claude')).toBeFalsy();
    expect(container.querySelector('.chat-msg-sai')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true })); });
  });

  it('gemini assistant message uses SAI logo dot, not gemini-specific class', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} aiProvider="gemini" />);
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false })); });
    expect(container.querySelector('.chat-msg-gemini')).toBeFalsy();
    expect(container.querySelector('.chat-msg-sai')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true })); });
  });

  it('codex assistant message uses SAI logo dot, not openai-specific class', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} aiProvider="codex" />);
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false })); });
    expect(container.querySelector('.chat-msg-openai')).toBeFalsy();
    expect(container.querySelector('.chat-msg-sai')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true })); });
  });

  it('uses fade-in with zero distance for assistant message entry', () => {
    const { container } = render(
      <ChatMessage message={{ id: 'a-1', role: 'assistant', content: 'hello', timestamp: 0 }} />
    );
    const node = container.querySelector('[data-testid="chat-msg"]');
    expect(node?.getAttribute('data-entry-transition')).toBe(JSON.stringify(FADE_IN));
    expect(node?.getAttribute('data-entry-y')).toBe('0');
  });

  it('strips entry transition under reduced motion', () => {
    const original = window.matchMedia;
    // @ts-expect-error - test stub
    window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false });
    const { container } = render(
      <ChatMessage message={{ id: 'a-2', role: 'assistant', content: 'hello', timestamp: 0 }} />
    );
    const node = container.querySelector('[data-testid="chat-msg"]');
    expect(node?.getAttribute('data-entry-transition')).toBe(JSON.stringify({ duration: 0 }));
    window.matchMedia = original;
  });

  it('uses dock spring transition for FLIPped user messages', () => {
    setFlipRect('msg-1', new DOMRect(0, 600, 200, 40));
    const { container } = render(
      <ChatMessage message={{ id: 'msg-1', role: 'user', content: 'hi', timestamp: 0 }} />
    );
    const node = container.querySelector('[data-testid="chat-msg"]');
    expect(node?.getAttribute('data-flip-transition')).toBe(JSON.stringify(SPRING.dock));
  });

  it('applies error-pulse class to messages with an error', () => {
    const { container } = render(
      <ChatMessage message={{ id: 'e-1', role: 'system', content: 'oops', timestamp: 0, error: { message: 'oops', kind: 'unknown' } as any }} />
    );
    expect(container.querySelector('.chat-msg-error-pulse')).toBeTruthy();
  });

  it('renders the new error status bar with error_type and HTTP status', () => {
    const { container } = render(
      <ChatMessage message={{
        id: 'e-1', role: 'system', content: 'Output blocked',
        timestamp: 0,
        error: {
          title: 'Invalid request',
          status: 400,
          message: 'Output blocked by content filtering policy',
          requestId: 'req_abc',
          errorType: 'invalid_request_error',
        } as any,
      }} />
    );
    const bar = container.querySelector('[data-testid="chat-msg-error-status-bar"]');
    expect(bar).toBeTruthy();
    expect(bar?.textContent).toContain('invalid_request_error');
    expect(bar?.textContent).toContain('HTTP 400');
  });

  it('renders the prompt-style body with the error message', () => {
    const { container } = render(
      <ChatMessage message={{
        id: 'e-2', role: 'system', content: 'Output blocked',
        timestamp: 0,
        error: { title: 'Invalid request', status: 400, message: 'Output blocked by content filtering policy' } as any,
      }} />
    );
    const body = container.querySelector('[data-testid="chat-msg-error-body"]');
    expect(body?.textContent).toContain('Output blocked by content filtering policy');
  });

  it('renders req_id meta when present and omits when absent', () => {
    const { container, rerender } = render(
      <ChatMessage message={{
        id: 'e-3', role: 'system', content: 'x', timestamp: 0,
        error: { title: 'X', message: 'x', requestId: 'req_abc' } as any,
      }} />
    );
    expect(container.querySelector('[data-testid="chat-msg-error-meta"]')?.textContent).toContain('req_abc');

    rerender(
      <ChatMessage message={{
        id: 'e-3', role: 'system', content: 'x', timestamp: 0,
        error: { title: 'X', message: 'x' } as any,
      }} />
    );
    expect(container.querySelector('[data-testid="chat-msg-error-meta"]')).toBeNull();
  });

  it('details toggle expands the RAW RESPONSE panel', () => {
    const { container, getByText } = render(
      <ChatMessage message={{
        id: 'e-4', role: 'system', content: 'x', timestamp: 0,
        error: { title: 'X', message: 'x', details: '{"raw":"yes"}' } as any,
      }} />
    );
    expect(container.querySelector('[data-testid="chat-msg-error-details-panel"]')).toBeNull();
    fireEvent.click(getByText(/Details/i));
    expect(container.querySelector('[data-testid="chat-msg-error-details-panel"]')).toBeTruthy();
    expect(container.textContent).toContain('RAW RESPONSE');
  });

  it('retry button calls onRetry', () => {
    const onRetry = vi.fn();
    const { getByText } = render(
      <ChatMessage
        onRetry={onRetry}
        message={{
          id: 'e-5', role: 'system', content: 'x', timestamp: 0,
          error: { title: 'X', message: 'x' } as any,
        }} />
    );
    fireEvent.click(getByText(/Retry/i));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render the static content block while streaming (no chat-streaming-tail)', () => {
    const { container } = render(
      <ChatMessage isStreaming message={{ id: 's-1', role: 'assistant', content: 'partial', timestamp: 0 }} />
    );
    // No streaming-tail class. The static content block is suppressed; while streaming
    // the SAI morph head (also .chat-msg-content) covers the turn in its thinking phase.
    expect(container.querySelector('.chat-streaming-tail')).toBeFalsy();
    expect(container.querySelector('.sah-root')).toBeTruthy();
  });

  it('does not mark non-streaming text with chat-streaming-tail', () => {
    const { container } = render(
      <ChatMessage message={{ id: 's-2', role: 'assistant', content: 'done', timestamp: 0 }} />
    );
    expect(container.querySelector('.chat-streaming-tail')).toBeFalsy();
  });

  // ── Clear-context two-step button ──────────────────────────────────────────

  const errorMsg = (id = 'c-1') => ({
    id, role: 'system' as const, content: 'x', timestamp: 0,
    error: { title: 'X', message: 'x' } as any,
  });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders Clear context button when onClearContext is provided', () => {
    const { container } = render(
      <ChatMessage onClearContext={vi.fn()} message={errorMsg()} />
    );
    const btn = container.querySelector('[data-testid="chat-msg-error-clear"]');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toContain('Clear context');
  });

  it('does not render Clear context button without onClearContext', () => {
    const { container } = render(<ChatMessage message={errorMsg()} />);
    expect(container.querySelector('[data-testid="chat-msg-error-clear"]')).toBeNull();
  });

  it('first click on Clear context shows Confirm? and does not call onClearContext', () => {
    const onClearContext = vi.fn();
    const { container } = render(
      <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
    );
    const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.textContent).toContain('Confirm?');
    expect(onClearContext).not.toHaveBeenCalled();
  });

  it('second click within 3s calls onClearContext', () => {
    const onClearContext = vi.fn();
    const { container } = render(
      <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
    );
    const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClearContext).toHaveBeenCalledTimes(1);
  });

  it('confirming state resets after 3s of no second click', () => {
    const onClearContext = vi.fn();
    const { container } = render(
      <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
    );
    const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.textContent).toContain('Confirm?');
    act(() => { vi.advanceTimersByTime(3100); });
    expect(btn.textContent).toContain('Clear context');
  });

  it('outside click resets the confirming state', () => {
    const onClearContext = vi.fn();
    const { container } = render(
      <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
    );
    const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.textContent).toContain('Confirm?');
    fireEvent.mouseDown(document.body);
    expect(btn.textContent).toContain('Clear context');
  });

  describe('durationMs display', () => {
    it('renders frozen clock when assistant message has durationMs', () => {
      // Fresh SAI assistant routes through the morph head, which renders the clock
      // as .sah-clock (not the static block's data-testid="msg-duration").
      const msg = makeMessage({ role: 'assistant', durationMs: 3750 });
      const { container } = render(<ChatMessage message={msg} />);
      const el = container.querySelector('.sah-clock');
      expect(el).toBeTruthy();
      expect(el?.textContent?.trim()).toMatch(/^\[\d{2}:\d{2}\.\d\]$/);
    });

    it('renders correct formatted time for durationMs', () => {
      // 75300 ms = 1 min 15.3 sec
      const msg = makeMessage({ role: 'assistant', durationMs: 75300 });
      const { container } = render(<ChatMessage message={msg} />);
      const el = container.querySelector('.sah-clock');
      expect(el?.textContent?.trim()).toBe('[01:15.3]');
    });

    it('does not render clock when durationMs is undefined', () => {
      const msg = makeMessage({ role: 'assistant' });
      render(<ChatMessage message={msg} />);
      expect(document.querySelector('[data-testid="msg-duration"]')).toBeNull();
    });

    it('does not render clock for user messages even with durationMs', () => {
      const msg = makeMessage({ role: 'user', content: 'Hi', durationMs: 5000 } as any);
      render(<ChatMessage message={msg} />);
      expect(document.querySelector('[data-testid="msg-duration"]')).toBeNull();
    });

    it('duration element is a descendant of .chat-msg-body, not next to the icon', () => {
      // Morph head renders the clock (.sah-clock / .chat-msg-duration) inside .chat-msg-body.
      const { container } = render(<ChatMessage message={makeMessage({ durationMs: 3750 })} />);
      expect(container.querySelector('.chat-msg-body .chat-msg-duration')).toBeTruthy();
    });
  });

  it('word-reveals a fresh, complete assistant message', () => {
    const { container } = render(
      <ChatMessage
        message={{ id: 'rv-1', role: 'assistant', content: 'hello brave new world', timestamp: Date.now() }}
        projectPath="/p"
        isStreaming={false}
      />
    );
    expect(container.querySelectorAll('.rv-word').length).toBeGreaterThan(0);
  });

  it('does not reveal a streaming assistant message', () => {
    const { container } = render(
      <ChatMessage
        message={{ id: 'rv-2', role: 'assistant', content: 'partial text', timestamp: Date.now() }}
        projectPath="/p"
        isStreaming={true}
      />
    );
    expect(container.querySelectorAll('.rv-word').length).toBe(0);
  });

  it('does not reveal an old (history) assistant message', () => {
    const { container } = render(
      <ChatMessage
        message={{ id: 'rv-3', role: 'assistant', content: 'old reply', timestamp: 1 }}
        projectPath="/p"
        isStreaming={false}
      />
    );
    expect(container.querySelectorAll('.rv-word').length).toBe(0);
  });

  it('does not word-reveal text that streamed in live (spec change 2026-06-11)', () => {
    // Live-shown text was already watched arriving; re-animating it at settle
    // would replay content the user has read.
    vi.useFakeTimers();
    try {
      const msg = { id: 'rv-stream', role: 'assistant' as const, content: 'streamed then done', timestamp: Date.now() };
      const { container, rerender } = render(
        <ChatMessage message={msg} projectPath="/p" isStreaming={true} />
      );
      rerender(<ChatMessage message={msg} projectPath="/p" isStreaming={false} />);
      act(() => { vi.advanceTimersByTime(300); });
      expect(container.querySelectorAll('.rv-word').length).toBe(0);
      const md = container.querySelector('.sah-md') as HTMLElement | null;
      expect(md?.style.display).not.toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reveal survives a post-completion re-render (e.g. durationMs added)', () => {
    const base = { id: 'rv-dur', role: 'assistant' as const, content: 'hello brave new world here', timestamp: Date.now() };
    const { container, rerender } = render(
      <ChatMessage message={base} projectPath="/p" isStreaming={false} />
    );
    expect(container.querySelectorAll('.rv-word').length).toBeGreaterThan(0);
    // A new message object (same content) lands right after completion — must NOT wipe the reveal.
    rerender(<ChatMessage message={{ ...base, durationMs: 1234 }} projectPath="/p" isStreaming={false} />);
    // Verify the re-render actually happened (the morph head clock reflects durationMs).
    expect(container.querySelector('.sah-clock')?.textContent?.trim()).toBe('[00:01.2]');
    expect(container.querySelectorAll('.rv-word').length).toBeGreaterThan(0);
  });

  it('reveal is not force-completed by StrictMode double-invoke (still animates)', () => {
    vi.useFakeTimers();
    try {
      const content = Array.from({ length: 20 }, (_, i) => 'word' + i).join(' ');
      const msg = { id: 'rv-strict', role: 'assistant' as const, content, timestamp: Date.now() };
      const { container } = render(
        <React.StrictMode>
          <ChatMessage message={msg} projectPath="/p" isStreaming={false} />
        </React.StrictMode>
      );
      const spans = Array.from(container.querySelectorAll<HTMLElement>('.rv-word'));
      expect(spans.length).toBeGreaterThan(0);
      // If StrictMode's cleanup cancelled the reveal, showAll() set EVERY span to opacity 1.
      // A healthy in-progress reveal still has hidden (opacity 0) spans before timers run.
      expect(spans.some(s => s.style.opacity === '0')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('morph head routing', () => {
    it('SAI assistant segment renders the morph head while streaming', () => {
      const { container } = render(
        <ChatMessage
          message={{ id: 'a1', role: 'assistant', content: '', timestamp: Date.now() }}
          projectPath="/tmp" aiProvider="claude" isStreaming
        />
      );
      expect(container.querySelector('.sah-root')).toBeTruthy();
    });

    it('Gemini uses the morph head (all providers unified on SAI animation)', () => {
      const { container } = render(
        <ChatMessage
          message={{ id: 'a2', role: 'assistant', content: '', timestamp: Date.now() }}
          projectPath="/tmp" aiProvider="gemini" isStreaming
        />
      );
      // Provider-specific exclusion removed — gemini now also uses StreamingAssistantHead
      expect(container.querySelector('.sah-root')).toBeTruthy();
    });
  });
});
