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

  // Last payload that actually carried a conversation. When the current
  // payload is empty (everything read/idle) we keep showing this content but
  // override every status indicator to the green read state — content is
  // history (fine to keep), status is live (must never be stale).
  const [lastContent, setLastContent] = useState<OverlayPayload | null>(null);

  useEffect(() => {
    const offState = (window as any).sai?.overlayOnState?.((p: OverlayPayload) => {
      setPayload(p);
      if (p?.hasReportable && p.rows.length > 0) setLastContent(p);
    });
    // Interactive mode is toggled in the main process (Ctrl+Shift+F9 — Linux
    // never delivers mouse events to a click-through window); mirror it here.
    const offInteractive = (window as any).sai?.overlayOnInteractive?.((v: boolean) => setInteractive(v));
    return () => { offState?.(); offInteractive?.(); };
  }, []);

  const idle = !!payload && (!payload.hasReportable || payload.rows.length === 0);
  const source = idle ? lastContent : payload;
  const rows: OverlayRow[] = (source?.rows ?? []).map(r => (idle ? { ...r, state: 'alive' as const } : r));
  const focusRow =
    rows.find(r => r.path === selected)
    ?? rows.find(r => r.path === source?.focusPath)
    ?? rows[0]
    ?? null;

  // The thinking driver runs whenever the focused conversation is working, so
  // the logo cycles through the same animation chain as the in-app indicator.
  const driver = useThinkingDriver(!idle && !!focusRow && isWorking(focusRow.state));

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

  if (!payload) return <div className="overlay-root overlay-empty" />;

  // Nothing has ever run this session: a minimal caught-up card.
  if (!focusRow) {
    return (
      <div
        className={`overlay-root${interactive ? ' overlay-interactive' : ''}`}
        onPointerDown={onPointerDown}
      >
        <div className="overlay-card overlay-idle">
          <div className="overlay-status-row" style={{ border: 'none', margin: 0, padding: 0 }}>
            <SaiLogo mode="static" size={16} color="#c7913b" className="overlay-thinking" />
            <span className="overlay-focus-name">all caught up</span>
          </div>
        </div>
      </div>
    );
  }

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
              ) : item.kind === 'user' ? (
                <div key={`u-${i}`} className="overlay-user-msg">{item.text}</div>
              ) : item.kind === 'elided' ? (
                <div key={`e-${i}`} className="overlay-elided">⋯ {item.count} earlier tool call{item.count === 1 ? '' : 's'}</div>
              ) : (
                <div key={`c-${i}`} className={`overlay-tool-card${item.done ? ' overlay-tool-done' : ''}`}>
                  <span className="overlay-tool-dot" />
                  <span className="overlay-tool-name">{item.name}</span>
                  {item.detail && <span className="overlay-tool-detail">{item.detail}</span>}
                </div>
              )
            )}
          </div>
          {!idle && (
          <div className="overlay-status-row">
            {isWorking(focusRow.state)
              ? <SaiLogo mode={driver.chainMode} size={16} color="#c7913b" className="overlay-thinking" />
              : focusRow.state === 'done'
                ? <SaiLogo mode="static" size={16} color="#c7913b" className="overlay-thinking" />
                : <WorkspaceSquircle state={focusRow.state} />}
            <span className="overlay-focus-name">{focusRow.name}</span>
            {focusRow.state !== 'done' && focusRow.state !== 'alive' && (
              <span className="overlay-focus-state">· {STATE_LABEL[focusRow.state] ?? focusRow.state}</span>
            )}
            {focusRow.todos && focusRow.todos.total > 0 && (() => {
              const { done, total } = focusRow.todos;
              const r = 6;
              const c = 2 * Math.PI * r;
              return (
                <span className="overlay-task-ring" title={`Tasks: ${done}/${total}`}>
                  <svg width="16" height="16" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r={r} fill="none" stroke="var(--bg-hover, #21262d)" strokeWidth="2" />
                    <circle
                      cx="8" cy="8" r={r} fill="none"
                      stroke={done === total ? 'var(--green, #22c55e)' : 'var(--accent, #d4a72c)'}
                      strokeWidth="2"
                      strokeDasharray={c}
                      strokeDashoffset={c - (total ? done / total : 0) * c}
                      strokeLinecap="round"
                      transform="rotate(-90 8 8)"
                    />
                  </svg>
                  <span className="overlay-task-count">{done}/{total}</span>
                </span>
              );
            })()}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
