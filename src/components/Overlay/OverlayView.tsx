import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SaiLogo from '../SaiLogo';
import { useThinkingDriver } from '../Chat/useThinkingDriver';
import { WorkspaceSquircle } from '../shared/WorkspaceSquircle';
import type { OverlayPayload, OverlayRow, OverlayTailItem } from '../../lib/overlayFeed';
import type { IndicatorState } from '../../lib/workspaceStatus';
import './OverlayView.css';

const STATE_LABEL: Partial<Record<IndicatorState, string>> = {
  busy: 'working',
  'busy-done': 'working',
  done: 'done',
  approval: 'approval needed',
  question: 'waiting for your answer',
};

const isWorking = (s: IndicatorState) => s === 'busy' || s === 'busy-done';

/** Renderer for the focus-overlay window (#overlay hash). A status strip of
 *  every reportable workspace plus one conversation's tail; clicking a strip
 *  item (in Ctrl+Shift interactive mode) focuses that workspace's convo.
 *  Ghosting is CSS — the window itself is opaque because transparent windows
 *  render as a black box with GPU acceleration disabled on Linux. */
export function OverlayView() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [interactive, setInteractive] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    // Keep the last reportable payload: when everything goes idle the manager
    // lingers before hiding, and blanking the card during that grace reads as
    // a glitch. The window hides; content never visibly empties.
    const offState = (window as any).sai?.overlayOnState?.((p: OverlayPayload) => {
      setPayload(prev => (p?.hasReportable ? p : prev));
    });
    // Interactive mode is toggled in the main process (Ctrl+Shift+F9 — Linux
    // never delivers mouse events to a click-through window); mirror it here.
    const offInteractive = (window as any).sai?.overlayOnInteractive?.((v: boolean) => setInteractive(v));
    return () => { offState?.(); offInteractive?.(); };
  }, []);

  const rows: OverlayRow[] = payload?.rows ?? [];
  const focusRow =
    rows.find(r => r.path === selected)
    ?? rows.find(r => r.path === payload?.focusPath)
    ?? rows[0]
    ?? null;

  // The thinking driver runs whenever the focused conversation is working, so
  // the logo cycles through the same animation chain as the in-app indicator.
  const driver = useThinkingDriver(!!focusRow && isWorking(focusRow.state));

  // Manual drag: -webkit-app-region is unreliable on Linux (and the window is
  // non-focusable), so interactive-mode dragging moves the window through IPC
  // using screen-coordinate deltas.
  const dragRef = { last: null as { x: number; y: number } | null };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    if ((e.target as HTMLElement).closest('.overlay-strip-item')) return; // buttons stay clickable
    dragRef.last = { x: e.screenX, y: e.screenY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!dragRef.last) return;
      const dx = ev.screenX - dragRef.last.x;
      const dy = ev.screenY - dragRef.last.y;
      if (dx !== 0 || dy !== 0) {
        dragRef.last = { x: ev.screenX, y: ev.screenY };
        (window as any).sai?.overlayDragBy?.(dx, dy);
      }
    };
    const up = () => {
      dragRef.last = null;
      (window as any).sai?.overlayDragEnd?.();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Auto-pin: follow the newest activity unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [payload, focusRow?.path]);

  if (!payload?.hasReportable || !focusRow) return <div className="overlay-root overlay-empty" />;

  return (
    <div
      className={`overlay-root${interactive ? ' overlay-interactive' : ''}`}
      onPointerDown={onPointerDown}
    >
      <div className="overlay-card">
        <div className="overlay-strip">
          {rows.map((r) => (
            <button
              key={r.path}
              className={`overlay-strip-item${r.path === focusRow.path ? ' overlay-strip-active' : ''}`}
              onClick={() => setSelected(r.path)}
              title={r.path}
            >
              <WorkspaceSquircle state={r.state} />
              <span className={`overlay-strip-name${r.kind === 'meta' ? ' overlay-meta' : ''}`}>
                {r.kind === 'meta' ? `meta:${r.name}` : r.name}
              </span>
            </button>
          ))}
        </div>
        <div className="overlay-focus">
          <div
            className="overlay-scroll"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
            }}
          >
            {(focusRow.tail ?? []).map((item: OverlayTailItem, i: number) =>
              item.kind === 'text' ? (
                <div key={`t-${i}`} className="overlay-snippet">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                </div>
              ) : (
                <div key={`c-${i}`} className={`overlay-tool-card${item.done ? ' overlay-tool-done' : ''}`}>
                  <span className="overlay-tool-dot" />
                  <span className="overlay-tool-name">{item.name}</span>
                  <span className="overlay-tool-status">{item.done ? 'done' : 'running'}</span>
                </div>
              )
            )}
          </div>
          <div className="overlay-status-row">
            {isWorking(focusRow.state)
              ? <SaiLogo mode={driver.chainMode} size={16} color="#c7913b" className="overlay-thinking" />
              : focusRow.state === 'done'
                ? <SaiLogo mode="static" size={16} color="#c7913b" className="overlay-thinking" />
                : <WorkspaceSquircle state={focusRow.state} />}
            <span className="overlay-focus-name">{focusRow.name}</span>
            {focusRow.state !== 'done' && (
              <span className="overlay-focus-state">· {STATE_LABEL[focusRow.state] ?? focusRow.state}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
