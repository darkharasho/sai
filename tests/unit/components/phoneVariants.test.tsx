import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installMockSai } from '../../helpers/ipc-mock';

vi.mock('../../../src/terminalBuffer', () => ({
  getTerminalContent: vi.fn().mockReturnValue(''),
  getTerminalLastCommand: vi.fn().mockReturnValue(''),
  getLastCommandName: vi.fn().mockReturnValue(null),
  getTerminalById: vi.fn().mockReturnValue(null),
  getTerminalByName: vi.fn().mockReturnValue(null),
  getTerminalByIndex: vi.fn().mockReturnValue(null),
}));
vi.mock('react-markdown', () => ({
  default: ({ components, children }: any) => {
    const A = components?.a;
    return <div data-testid="markdown">{A ? <A href="https://example.com/x">link text</A> : children}</div>;
  },
}));
vi.mock('rehype-highlight', () => ({ default: () => () => {} }));
vi.mock('remark-gfm', () => ({ default: () => () => {} }));
vi.mock('highlight.js/styles/monokai.css', () => ({}));
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({ codeToHtml: vi.fn().mockReturnValue('<pre><code>code</code></pre>') }),
}));

import ChatInput from '../../../src/components/Chat/ChatInput';
import ChatMessage from '../../../src/components/Chat/ChatMessage';
import MessageQueue from '../../../src/components/Chat/MessageQueue';
import { isPhone } from '../../../src/lib/platform';
import { fitWithin } from '../../../src/lib/imageResize';

const STABLE_SLASH: never[] = [];
const inputProps = {
  onSend: vi.fn(),
  permissionMode: 'default' as const,
  onPermissionChange: vi.fn(),
  effortLevel: 'medium' as const,
  onEffortChange: vi.fn(),
  modelChoice: 'sonnet' as const,
  onModelChange: vi.fn(),
  slashCommands: STABLE_SLASH,
};

const setPhone = (on: boolean) => {
  if (on) document.documentElement.dataset.saiPhone = '1';
  else delete document.documentElement.dataset.saiPhone;
};

beforeEach(() => { installMockSai(); vi.clearAllMocks(); setPhone(false); });
afterEach(() => { setPhone(false); vi.useRealTimers(); });

describe('isPhone', () => {
  it('reads the attribute at call time', () => {
    expect(isPhone()).toBe(false);
    setPhone(true);
    expect(isPhone()).toBe(true);
  });
});

describe('composer keys', () => {
  it('phone: Enter inserts newline and send button sends', () => {
    setPhone(true);
    const onSend = vi.fn();
    render(<ChatInput {...inputProps} onSend={onSend} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'hello' } });
    const notPrevented = fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });
    expect(notPrevented).toBe(true); // default (newline) not blocked
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('button.send-btn:not(.stop-btn)') as HTMLElement);
    expect(onSend).toHaveBeenCalledWith('hello', undefined);
  });

  it('desktop: Enter still sends', () => {
    const onSend = vi.fn();
    render(<ChatInput {...inputProps} onSend={onSend} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'hello' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('hello', undefined);
  });

  it('phone: global type-to-focus is off; desktop control focuses', () => {
    for (const phone of [true, false]) {
      setPhone(phone);
      const { unmount } = render(<ChatInput {...inputProps} />);
      const ta = screen.getByRole('textbox');
      expect(document.activeElement).not.toBe(ta);
      fireEvent.keyDown(window, { key: 'a' });
      expect(document.activeElement === ta).toBe(!phone);
      unmount();
    }
  });
});

describe('queue actions', () => {
  const queue = [
    { id: 'q0', text: 'one', fullText: 'one' },
    { id: 'q1', text: 'two', fullText: 'two' },
  ];
  const open = () => {
    const r = render(<MessageQueue queue={queue} onRemove={vi.fn()} onPromote={vi.fn()} onSendNow={vi.fn()} />);
    fireEvent.click(r.container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    return r.container;
  };

  it('phone: queue actions visible without hover', () => {
    setPhone(true);
    const c = open();
    expect(c.querySelectorAll('.queue-actions.queue-actions--always').length).toBe(2);
  });

  it('desktop: queue actions stay hover-revealed', () => {
    const c = open();
    expect(c.querySelectorAll('.queue-actions').length).toBe(2);
    expect(c.querySelectorAll('.queue-actions--always').length).toBe(0);
  });
});

describe('long-press link', () => {
  const msg = { id: '1', role: 'assistant' as const, content: 'x', timestamp: 0 };
  const press = () => {
    vi.useFakeTimers();
    const { container } = render(<ChatMessage message={msg} />);
    const link = container.querySelector('a[href]') as HTMLElement;
    fireEvent.touchStart(link, { touches: [{ clientX: 10, clientY: 20 }] });
    return { link };
  };

  it('phone: long-press link opens context menu', () => {
    setPhone(true);
    press();
    act(() => { vi.advanceTimersByTime(499); });
    expect(document.querySelector('.link-ctx')).toBeNull();
    act(() => { vi.advanceTimersByTime(2); });
    expect(document.querySelector('.link-ctx')).toBeTruthy();
  });

  it('phone: moving cancels the long-press', () => {
    setPhone(true);
    const { link } = press();
    fireEvent.touchMove(link, { touches: [{ clientX: 10, clientY: 60 }] });
    act(() => { vi.advanceTimersByTime(600); });
    expect(document.querySelector('.link-ctx')).toBeNull();
  });

  it('phone: ending cancels the long-press', () => {
    setPhone(true);
    const { link } = press();
    fireEvent.touchEnd(link);
    act(() => { vi.advanceTimersByTime(600); });
    expect(document.querySelector('.link-ctx')).toBeNull();
  });

  it('phone: click after a long-press is swallowed; menu stays open', () => {
    setPhone(true);
    const { link } = press();
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.touchEnd(link);
    fireEvent.click(link);
    expect((window.sai as any).openExternal).not.toHaveBeenCalled();
    expect(document.querySelector('.link-ctx')).toBeTruthy();
  });

  it('phone: a plain tap still opens the link', () => {
    setPhone(true);
    const { link } = press();
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.touchEnd(link);
    fireEvent.click(link);
    expect((window.sai as any).openExternal).toHaveBeenCalledWith('https://example.com/x');
    expect(document.querySelector('.link-ctx')).toBeNull();
  });

  it('phone: a tap after a long-press (no click in between) still opens the link', () => {
    setPhone(true);
    const { link } = press();
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.touchEnd(link);
    fireEvent.touchStart(link, { touches: [{ clientX: 1, clientY: 1 }] });
    fireEvent.touchEnd(link);
    fireEvent.click(link);
    expect((window.sai as any).openExternal).toHaveBeenCalled();
  });

  it('phone: menu item tap after a long-press (no link click) still runs its action', () => {
    setPhone(true);
    const { link } = press();
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.touchEnd(link);
    const item = Array.from(document.querySelectorAll('.link-ctx-item')).find(b => /Open link/.test(b.textContent ?? ''))!;
    fireEvent.click(item);
    expect((window.sai as any).openExternal).toHaveBeenCalledWith('https://example.com/x');
  });

  it('phone: guard expires after touchend so a later tap opens the link', () => {
    setPhone(true);
    const { link } = press();
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.touchEnd(link);
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.click(link);
    expect((window.sai as any).openExternal).toHaveBeenCalledWith('https://example.com/x');
  });

  it('desktop: touch does not open the menu', () => {
    press();
    act(() => { vi.advanceTimersByTime(600); });
    expect(document.querySelector('.link-ctx')).toBeNull();
  });
});

describe('attach image', () => {
  it('fitWithin computes targets', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('phone: attach picks an image and resizes it to 2048px max', async () => {
    setPhone(true);
    const sai = installMockSai();
    const drawImage = vi.fn();
    const toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,AAAA');
    const canvases: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this);
      return { drawImage } as any;
    });
    HTMLCanvasElement.prototype.toDataURL = toDataURL;
    (globalThis as any).createImageBitmap = vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() });

    let picker: HTMLInputElement | null = null;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: any) => {
      const el = origCreate(tag, o);
      if (tag === 'input') { picker = el as HTMLInputElement; vi.spyOn(el, 'click').mockImplementation(() => {}); }
      return el;
    }) as any);

    render(<ChatInput {...inputProps} />);
    fireEvent.click(screen.getByTitle('Add context'));
    expect(sai.selectFile).not.toHaveBeenCalled();
    expect(picker).toBeTruthy();
    expect(picker!.type).toBe('file');
    expect(picker!.accept).toBe('image/*');

    const file = new File(['x'], 'big.heic', { type: 'image/heic' });
    Object.defineProperty(picker!, 'files', { value: [file] });
    await act(async () => { picker!.onchange?.(new Event('change')); });

    await waitFor(() => expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85));
    expect(canvases[0].width).toBe(2048);
    expect(canvases[0].height).toBe(1536);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1536);
    // joins the pending-images list: its chip is rendered
    await waitFor(() => expect(document.querySelector('.context-remove')).toBeTruthy());
  });

  it('desktop: attach button still opens the add menu', () => {
    render(<ChatInput {...inputProps} />);
    fireEvent.click(screen.getByTitle('Add context'));
    expect(screen.getByText('Add File')).toBeTruthy();
  });
});

describe('image modal', () => {
  it('phone: modal closes on tap and allows pinch zoom', () => {
    setPhone(true);
    const msg = { id: '1', role: 'user' as const, content: 'x', timestamp: 0, images: ['data:image/png;base64,AAAA'] };
    render(<ChatMessage message={msg as any} />);
    const thumb = document.querySelector('.chat-msg-attachment') as HTMLElement;
    fireEvent.click(thumb);
    const modalImg = document.querySelector('.img-modal-img') as HTMLElement;
    expect(modalImg).toBeTruthy();
    const overlay = document.querySelector('.img-modal-overlay') as HTMLElement;
    expect(overlay.style.touchAction).toBe('pinch-zoom');
    fireEvent.click(modalImg);
    expect(document.querySelector('.img-modal-overlay')).toBeNull();
  });
});
