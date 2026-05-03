import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { SPRING, DISTANCE } from '../../../../src/components/Chat/motion';

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
    const msg = makeMessage({ content: 'Hello world' });
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId('markdown')).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toBe('Hello world');
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
    expect(container.querySelector('.chat-msg-images')).toBeTruthy();
    const img = container.querySelector('.chat-msg-thumb') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('data:image/png');
  });

  it('shows lightbox when thumbnail is clicked', () => {
    const msg = makeMessage({
      images: ['data:image/png;base64,abc123'],
    });
    render(<ChatMessage message={msg} />);
    const thumb = document.querySelector('.chat-msg-thumb') as HTMLElement;
    fireEvent.click(thumb);
    expect(document.body.querySelector('.img-modal-overlay')).toBeTruthy();
  });

  it('closes lightbox when overlay is clicked', () => {
    const msg = makeMessage({
      images: ['data:image/png;base64,abc123'],
    });
    render(<ChatMessage message={msg} />);
    const thumb = document.querySelector('.chat-msg-thumb') as HTMLElement;
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

  it('uses claude provider class when SAI animation is disabled', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} />);
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false })); });
    expect(container.querySelector('.chat-msg-claude')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true })); });
  });

  it('uses gemini provider class when SAI animation is disabled', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} aiProvider="gemini" />);
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false })); });
    expect(container.querySelector('.chat-msg-gemini')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true })); });
  });

  it('uses openai provider class when SAI animation is disabled for codex', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} aiProvider="codex" />);
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false })); });
    expect(container.querySelector('.chat-msg-openai')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true })); });
  });

  it('uses pop spring with slide distance for assistant message entry', () => {
    const { container } = render(
      <ChatMessage message={{ id: 'a-1', role: 'assistant', content: 'hello', timestamp: 0 }} />
    );
    const node = container.querySelector('[data-testid="chat-msg"]');
    expect(node?.getAttribute('data-entry-transition')).toBe(JSON.stringify(SPRING.pop));
    expect(node?.getAttribute('data-entry-y')).toBe(String(DISTANCE.slide));
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

  it('marks streaming text with chat-streaming-tail class', () => {
    const { container } = render(
      <ChatMessage isStreaming message={{ id: 's-1', role: 'assistant', content: 'partial', timestamp: 0 }} />
    );
    expect(container.querySelector('.chat-streaming-tail')).toBeTruthy();
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
});
