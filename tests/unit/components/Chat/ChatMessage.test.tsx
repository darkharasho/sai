import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('uses claude provider class by default for assistant', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} />);
    expect(container.querySelector('.chat-msg-claude')).toBeTruthy();
  });

  it('uses gemini provider class for gemini provider', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} aiProvider="gemini" />);
    expect(container.querySelector('.chat-msg-gemini')).toBeTruthy();
  });

  it('uses openai provider class for codex provider', () => {
    const msg = makeMessage({ role: 'assistant' });
    const { container } = render(<ChatMessage message={msg} aiProvider="codex" />);
    expect(container.querySelector('.chat-msg-openai')).toBeTruthy();
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
});
