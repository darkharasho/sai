import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isPhone } from '../../lib/platform';
import { Copy, ExternalLink } from 'lucide-react';

// Right-click a link in a chat message → "Copy link address" / "Open link".
// One delegated handler per message: any <a href> inside it, plus elements
// that stand in for a link (the issue preview chips are buttons) and carry
// `data-link-href`. Right-clicks anywhere else keep the default behavior.

/** The raw href a right-click target links to, or null when it isn't a link. */
export function linkHrefAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-link-href], a[href]');
  if (!el) return null;
  return el.getAttribute('data-link-href') || el.getAttribute('href') || null;
}

/** What "Copy link address" puts on the clipboard: `sai-file://` links copy as
 *  the plain file path (that's what they name); everything else verbatim. */
export function copyableAddress(href: string): string {
  return href.startsWith('sai-file://') ? href.slice('sai-file://'.length) : href;
}

async function copyText(text: string): Promise<void> {
  try {
    if (window.sai?.clipboardWrite && await window.sai.clipboardWrite(text)) return;
  } catch { /* fall through to the web clipboard */ }
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
}

interface MenuState { x: number; y: number; href: string }

export function useLinkContextMenu(onOpen?: (href: string) => void) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const href = linkHrefAt(e.target);
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, href });
  }, []);

  // Phone: long-press (500ms, cancelled by move/end) stands in for right-click,
  // replacing the iOS link callout.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = useCallback(() => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }, []);
  const longPressFired = useRef(false);
  useEffect(() => cancelPress, [cancelPress]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isPhone()) return;
    const href = linkHrefAt(e.target);
    if (!href) return;
    const t = e.touches[0];
    const x = t?.clientX ?? 0;
    const y = t?.clientY ?? 0;
    cancelPress();
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      longPressFired.current = true;
      setMenu({ x, y, href });
    }, 500);
  }, [cancelPress]);

  // The touchend after a long-press synthesizes a click on the link; swallow it
  // (capture phase, so the <a> onClick never runs) and reset.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!longPressFired.current) return;
    longPressFired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const element = menu ? (
    <LinkContextMenu
      {...menu}
      onClose={close}
      onOpen={onOpen ? () => onOpen(menu.href) : undefined}
    />
  ) : null;

  return { onContextMenu, onTouchStart, onTouchMove: cancelPress, onTouchEnd: cancelPress, onTouchCancel: cancelPress, onClickCapture, element };
}

function LinkContextMenu({ x, y, href, onClose, onOpen }: MenuState & { onClose: () => void; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Keep the menu on screen near the window edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }, [x, y]);

  return createPortal(
    <div ref={ref} className="link-ctx" role="menu" style={{ left: x, top: y }}>
      <button
        type="button"
        role="menuitem"
        className="link-ctx-item"
        onClick={() => { void copyText(copyableAddress(href)); onClose(); }}
      >
        <Copy size={14} /> Copy link address
      </button>
      {onOpen && (
        <button
          type="button"
          role="menuitem"
          className="link-ctx-item"
          onClick={() => { onOpen(); onClose(); }}
        >
          <ExternalLink size={14} /> Open link
        </button>
      )}
      <style>{`
        .link-ctx {
          position: fixed;
          z-index: 2000;
          min-width: 180px;
          padding: 4px 0;
          background: var(--surface-3);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          font-size: 13px;
        }
        .link-ctx-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 6px 12px;
          background: transparent;
          border: none;
          color: var(--text);
          font-size: 13px;
          text-align: left;
          cursor: pointer;
        }
        .link-ctx-item:hover { background: var(--surface-4); }
      `}</style>
    </div>,
    document.body,
  );
}
