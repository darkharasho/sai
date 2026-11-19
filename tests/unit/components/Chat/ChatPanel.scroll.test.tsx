/**
 * Scroll-follow releases on any user scroll up (touch, momentum, keyboard), not only wheel;
 * programmatic writes never release it. Plus the "Load N earlier messages" row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { installMockChatlog, flushChatlog, emitChat, type MockChatlog } from '../../../helpers/chatlogMock';

vi.mock('../../../../src/lib/chat/migrateToLog', () => ({ ensureChatInLog: vi.fn(async () => {}), isChatImported: () => true, forgetChatImported: vi.fn() }));
vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: (props: any) => <div data-testid="chat-message" data-msg-id={props.message?.id} />,
}));
vi.mock('../../../../src/components/Chat/ChatInput', () => ({ default: () => <div data-testid="chat-input" /> }));
vi.mock('../../../../src/components/ThinkingAnimation', () => ({ default: () => <div /> }));

import ChatPanel from '../../../../src/components/Chat/ChatPanel';

type Props = ComponentProps<typeof ChatPanel>;
const baseProps = (over: Partial<Props> = {}): Props => ({
  projectPath: '/project',
  permissionMode: 'default', onPermissionChange: vi.fn(),
  effortLevel: 'high', onEffortChange: vi.fn(),
  modelChoice: 'sonnet', onModelChange: vi.fn(),
  aiProvider: 'claude',
  codexModel: 'gpt-5', onCodexModelChange: vi.fn(), codexModels: [],
  codexPermission: 'auto', onCodexPermissionChange: vi.fn(), codexEffort: 'medium',
  geminiModel: 'auto-gemini-3', onGeminiModelChange: vi.fn(), geminiModels: [],
  geminiApprovalMode: 'default', onGeminiApprovalModeChange: vi.fn(),
  geminiConversationMode: 'planning', onGeminiConversationModeChange: vi.fn(),
  kimiModel: 'kimi-k3', onKimiModelChange: vi.fn(), kimiModels: [],
  kimiApprovalMode: 'default', onKimiApprovalModeChange: vi.fn(),
  onMessagesChange: vi.fn(), onTurnComplete: vi.fn(),
  activeFilePath: null, onFileOpen: vi.fn(), isActive: true,
  sessionId: 'c1', claudeScope: 'c1', terminalTabs: [],
  ...over,
});

let sai: ReturnType<typeof installMockSai> & Record<string, any>;
let log: MockChatlog;
let roCallbacks: Array<() => void> = [];

beforeEach(() => {
  roCallbacks = [];
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { roCallbacks.push(cb); } observe() {} disconnect() {} unobserve() {} });
  sai = installMockSai() as any;
  sai.settingsGet.mockImplementation((_k: string, d: unknown) => Promise.resolve(d));
  log = installMockChatlog(sai);
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true, value: class { observe() {} disconnect() {} unobserve() {} },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
});

/** A scroller whose geometry the test controls; every scrollTop assignment is recorded. */
function fakeScroller(el: HTMLElement) {
  const g = { top: 0, height: 1000, client: 500, writes: [] as number[] };
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => g.top, set: (v: number) => { g.writes.push(v); g.top = v; } });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => g.client });
  return g;
}
const scrollTo = (el: HTMLElement, g: { top: number }, top: number) => { g.top = top; fireEvent.scroll(el); };
const grow = (g: { height: number }, to: number) => { g.height = to; act(() => { roCallbacks.forEach(cb => cb()); }); };

async function mountScroller() {
  log.seed('c1', [{ id: 'u1', role: 'user', content: 'hi', timestamp: 1 }, { id: 'a1', role: 'assistant', content: 'yo', timestamp: 2 }], { projectPath: '/project' });
  const r = render(<ChatPanel {...baseProps()} />);
  await flushChatlog();
  const el = r.container.querySelector('.chat-messages') as HTMLElement;
  const g = fakeScroller(el);
  scrollTo(el, g, 500); // at the bottom: following
  g.writes.length = 0;
  return { el, g, r };
}

describe('ChatPanel scroll-follow', () => {
  it('following content growth writes scrollTop (control)', async () => {
    const { g } = await mountScroller();
    grow(g, 1200);
    expect(g.writes.length).toBeGreaterThan(0);
  });

  it('touch scroll up releases follow', async () => {
    const { el, g } = await mountScroller();
    scrollTo(el, g, 420);
    scrollTo(el, g, 300);
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
    expect(g.top).toBe(300);
  });

  it('a scroll back to the bottom re-pins follow', async () => {
    const { el, g } = await mountScroller();
    scrollTo(el, g, 300);
    scrollTo(el, g, 480); // within the bottom threshold
    grow(g, 1200);
    expect(g.writes.length).toBeGreaterThan(0);
  });

  it('programmatic scroll does not release follow', async () => {
    const { el, g } = await mountScroller();
    grow(g, 1200); // the observer pins: a programmatic write
    // The browser reports a lower scrollTop for that write before the flag clears (clamp/easing).
    scrollTo(el, g, 300);
    g.writes.length = 0;
    grow(g, 1400);
    expect(g.writes.length).toBeGreaterThan(0);
  });

  it('small upward events after a release do not re-pin (touch momentum tail inside the threshold)', async () => {
    const { el, g } = await mountScroller();
    scrollTo(el, g, 470); // within 60px of the bottom; drop of 30 releases
    scrollTo(el, g, 468); // small upward events, still within the threshold
    scrollTo(el, g, 466);
    scrollTo(el, g, 466);
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
    expect(g.top).toBe(466);
  });

  it('touchstart during the follow tween cancels it and releases follow', async () => {
    const { el, g } = await mountScroller();
    g.top = 100; // far from the bottom so the tween runs, but still following
    await emitChat(sai, { type: 'streaming_start', projectPath: '/project', scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'assistant', projectPath: '/project', scope: 'c1', turnSeq: 1, message: { content: [{ type: 'text', text: 'more', delta: true }] } });
    fireEvent.touchStart(el);
    g.writes.length = 0;
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(g.writes).toEqual([]);
    grow(g, 1200);
    expect(g.writes).toEqual([]);
  });

  it('wheel up still releases follow', async () => {
    const { el, g } = await mountScroller();
    fireEvent.wheel(el, { deltaY: -40 });
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
  });
});

describe('ChatPanel load earlier row', () => {
  const withOlder = (n: number) => {
    const orig = log.open.getMockImplementation()!;
    log.open.mockImplementation(async (...a: any[]) => ({ ...(await (orig as any)(...a)), olderCount: n }));
  };

  it('shows "Load N earlier messages" and loads on click', async () => {
    withOlder(40);
    const page = vi.fn().mockResolvedValue({ messages: [{ id: 'old', role: 'user', content: 'old', timestamp: 0 }], olderCount: 39 });
    (window.sai.chatlog as any).page = page;
    log.seed('c1', [{ id: 'u1', role: 'user', content: 'hi', timestamp: 1 }], { projectPath: '/project' });
    render(<ChatPanel {...baseProps()} />);
    await flushChatlog();
    const row = screen.getByRole('button', { name: /Load 40 earlier messages/ });
    await act(async () => { fireEvent.click(row); });
    await flushChatlog();
    expect(page).toHaveBeenCalledWith('c1', 40, expect.any(Number));
    expect(screen.getAllByTestId('chat-message').map(m => m.getAttribute('data-msg-id'))).toEqual(['old', 'u1']);
    expect(screen.getByRole('button', { name: /Load 39 earlier messages/ })).toBeTruthy();
  });

  it('load earlier row is hidden when olderCount is 0', async () => {
    log.seed('c1', [{ id: 'u1', role: 'user', content: 'hi', timestamp: 1 }], { projectPath: '/project' });
    render(<ChatPanel {...baseProps()} />);
    await flushChatlog();
    expect(screen.queryByText(/earlier messages/)).toBeNull();
  });
});
