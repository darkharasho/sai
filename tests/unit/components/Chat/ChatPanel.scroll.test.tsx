/**
 * Scroll-follow releases on any user scroll up (touch, momentum, keyboard), not only wheel;
 * programmatic writes never release it. Plus the "Load N earlier messages" row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { installMockChatlog, flushChatlog, emitChat, type MockChatlog } from '../../../helpers/chatlogMock';

vi.mock('../../../../src/lib/chat/migrateToLog', () => ({ ensureChatInLog: vi.fn(async () => {}), isChatImported: () => true, forgetChatImported: vi.fn() }));
vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: (props: any) => <div data-testid="chat-message" data-msg-id={props.message?.id} />,
}));
let inputProps: any = null;
vi.mock('../../../../src/components/Chat/ChatInput', () => ({ default: (props: any) => { inputProps = props; return <div data-testid="chat-input" />; } }));
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
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    scrollTo(el, g, 420);
    scrollTo(el, g, 300);
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
    expect(g.top).toBe(300);
  });

  it('a scroll back to the bottom re-pins follow', async () => {
    const { el, g } = await mountScroller();
    fireEvent.wheel(el, { deltaY: -40 });
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
    fireEvent.pointerDown(el); // dragging the scrollbar
    scrollTo(el, g, 470); // within 60px of the bottom; drop of 30 releases
    scrollTo(el, g, 468); // small upward events, still within the threshold
    scrollTo(el, g, 466);
    scrollTo(el, g, 466);
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
    expect(g.top).toBe(466);
  });

  it('dragging content down during the follow tween cancels it and releases follow', async () => {
    const { el, g } = await mountScroller();
    g.top = 100; // far from the bottom so the tween runs, but still following
    await emitChat(sai, { type: 'streaming_start', projectPath: '/project', scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'assistant', projectPath: '/project', scope: 'c1', turnSeq: 1, message: { content: [{ type: 'text', text: 'more', delta: true }] } });
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 140 }] });
    g.writes.length = 0;
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(g.writes).toEqual([]);
    grow(g, 1200);
    expect(g.writes).toEqual([]);
  });

  it('a tap during the follow tween (e.g. expanding a tool card) keeps following', async () => {
    const { el, g } = await mountScroller();
    g.top = 100;
    await emitChat(sai, { type: 'streaming_start', projectPath: '/project', scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'assistant', projectPath: '/project', scope: 'c1', turnSeq: 1, message: { content: [{ type: 'text', text: 'more', delta: true }] } });
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(el);
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes.length).toBeGreaterThan(0);
  });

  it('an upward shift with no user input (a card re-laying out) keeps following', async () => {
    const { el, g } = await mountScroller();
    g.height = 1100; // content grew while the browser moved scrollTop up (scroll anchoring)
    scrollTo(el, g, 431);
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('follow-btn')).toBeNull();
  });

  it('dragging the scrollbar up releases follow', async () => {
    const { el, g } = await mountScroller();
    fireEvent.pointerDown(el);
    scrollTo(el, g, 300);
    fireEvent.pointerUp(window);
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
  });

  it('a keyboard scroll up releases follow', async () => {
    const { el, g } = await mountScroller();
    fireEvent.keyDown(el, { key: 'PageUp' });
    scrollTo(el, g, 300);
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
  });

  it('sending while scrolled up re-pins follow and heads for the bottom', async () => {
    const { el, g } = await mountScroller();
    fireEvent.wheel(el, { deltaY: -40 });
    scrollTo(el, g, 100);
    expect(screen.getByTestId('follow-btn')).toBeTruthy();
    g.writes.length = 0;
    // Reduced motion: the scroll to the bottom is one instant write.
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    await act(async () => { await inputProps.onSend('hello'); });
    await waitFor(() => expect(screen.queryByTestId('follow-btn')).toBeNull());
    expect(g.writes).toContain(1000);
  });

  it('a queued send while scrolled up mid-turn (no bubble yet) still re-pins follow', async () => {
    const { el, g } = await mountScroller();
    await emitChat(sai, { type: 'streaming_start', projectPath: '/project', scope: 'c1', turnSeq: 1 });
    fireEvent.wheel(el, { deltaY: -40 });
    scrollTo(el, g, 100);
    expect(screen.getByTestId('follow-btn')).toBeTruthy();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    g.writes.length = 0;
    await act(async () => { inputProps.onQueue('later', 'later'); await new Promise(r => setTimeout(r, 50)); });
    await waitFor(() => expect(screen.queryByTestId('follow-btn')).toBeNull());
    expect(g.writes).toContain(1000);
  });

  it('wheel up still releases follow', async () => {
    const { el, g } = await mountScroller();
    fireEvent.wheel(el, { deltaY: -40 });
    g.writes.length = 0;
    grow(g, 1200);
    expect(g.writes).toEqual([]);
  });
});

describe('ChatPanel jump-to-message guard', () => {
  type IO = { cb: (e: Array<{ isIntersecting: boolean }>) => void; targets: Element[] };
  let ios: IO[] = [];
  beforeEach(() => {
    ios = [];
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      value: class {
        rec: IO;
        constructor(cb: IO['cb']) { this.rec = { cb, targets: [] }; ios.push(this.rec); }
        observe(t: Element) { this.rec.targets.push(t); }
        disconnect() { this.rec.targets = []; }
        unobserve() {}
      },
    });
  });

  // 10 assistant rows, the user's question, then 60 more rows: the question sits
  // outside the 50-message tail, so the pinned bar offers "Jump".
  async function mountLong() {
    const msgs: any[] = [];
    for (let i = 0; i < 10; i++) msgs.push({ id: `a${i}`, role: 'assistant', content: 'x', timestamp: i });
    msgs.push({ id: 'uq', role: 'user', content: 'question', timestamp: 10 });
    for (let i = 0; i < 60; i++) msgs.push({ id: `b${i}`, role: 'assistant', content: 'y', timestamp: 11 + i });
    log.seed('c1', msgs, { projectPath: '/project' });
    const r = render(<ChatPanel {...baseProps()} />);
    await flushChatlog();
    const el = r.container.querySelector('.chat-messages') as HTMLElement;
    const g = fakeScroller(el);
    scrollTo(el, g, 500);
    await act(async () => { fireEvent.click(screen.getByTitle('Jump to message')); });
    // The jump re-windowed to idx - 5 = 5: 66 rows mounted, the sentinel still live.
    expect(screen.getAllByTestId('chat-message')).toHaveLength(66);
    return { el, g, r };
  }
  const fireSentinel = (r: ReturnType<typeof render>) => {
    const sentinel = r.container.querySelector('.chat-load-sentinel')!;
    const io = ios.filter(o => o.targets.includes(sentinel)).pop()!;
    act(() => { io.cb([{ isIntersecting: true }]); });
  };

  it("the jump's own upward smooth-scroll events don't release the guard", async () => {
    const { el, g, r } = await mountLong();
    scrollTo(el, g, 420); // smooth scroll heading up toward the target
    scrollTo(el, g, 300);
    fireSentinel(r);
    expect(screen.getAllByTestId('chat-message')).toHaveLength(66);
  });

  it('a touchstart during the jump releases the guard', async () => {
    const { el, r } = await mountLong();
    fireEvent.touchStart(el);
    fireSentinel(r);
    expect(screen.getAllByTestId('chat-message')).toHaveLength(71);
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
