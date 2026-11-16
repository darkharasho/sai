import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useLinkContextMenu, linkHrefAt, copyableAddress } from '../../../../src/components/Chat/LinkContextMenu';

function Harness({ onOpen }: { onOpen?: (href: string) => void }) {
  const menu = useLinkContextMenu(onOpen);
  return (
    <div data-testid="msg" onContextMenu={menu.onContextMenu}>
      <p>plain text <a href="https://example.com/a?b=1">a link <strong>bold</strong></a></p>
      <a href="sai-file://src/App.tsx:42">App.tsx</a>
      <span data-link-href="https://github.com/o/r/issues/7"><button>#7</button></span>
      {menu.element}
    </div>
  );
}

describe('link context menu', () => {
  let clipboardWrite: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    clipboardWrite = vi.fn().mockResolvedValue(true);
    (window as any).sai = { ...(window as any).sai, clipboardWrite };
  });

  it('copies the address of a right-clicked link (even from a nested element)', async () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByText('bold'));
    fireEvent.click(screen.getByRole('menuitem', { name: /copy link address/i }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('https://example.com/a?b=1'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('copies sai-file links as the plain path', async () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByText('App.tsx'));
    fireEvent.click(screen.getByRole('menuitem', { name: /copy link address/i }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('src/App.tsx:42'));
  });

  it('handles preview chips via data-link-href and opens through onOpen', () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    fireEvent.contextMenu(screen.getByText('#7'));
    fireEvent.click(screen.getByRole('menuitem', { name: /open link/i }));
    expect(onOpen).toHaveBeenCalledWith('https://github.com/o/r/issues/7');
  });

  it('leaves non-link right-clicks alone', () => {
    render(<Harness />);
    const ev = fireEvent.contextMenu(screen.getByText(/plain text/));
    expect(ev).toBe(true); // not default-prevented
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and outside mousedown', () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByText('App.tsx'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(screen.getByText('App.tsx'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('helpers', () => {
    expect(linkHrefAt(null)).toBeNull();
    expect(copyableAddress('sai-file:///abs/x.ts')).toBe('/abs/x.ts');
    expect(copyableAddress('https://x.y')).toBe('https://x.y');
  });
});
