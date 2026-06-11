import { useEffect, useState } from 'react';
import SaiLogo from '../SaiLogo';
import { useThinkingDriver } from '../Chat/useThinkingDriver';
import { WorkspaceSquircle } from '../shared/WorkspaceSquircle';
import type { OverlayPayload, OverlayRow } from '../../lib/overlayFeed';
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

  const requestInteractive = (v: boolean) => {
    setInteractive(v);
    (window as any).sai?.overlaySetInteractive?.(v);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const want = e.ctrlKey && e.shiftKey;
    if (want !== interactive) requestInteractive(want);
  };

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

  if (!payload?.hasReportable || !focusRow) return <div className="overlay-root overlay-empty" />;

  return (
    <div
      className={`overlay-root${interactive ? ' overlay-interactive' : ''}`}
      onMouseMove={onMouseMove}
      onPointerDown={onPointerDown}
      onMouseLeave={() => { if (interactive) requestInteractive(false); }}
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
          <div className="overlay-focus-head">
            {isWorking(focusRow.state)
              ? <SaiLogo mode={driver.chainMode} size={16} color="#c7913b" className="overlay-thinking" />
              : <WorkspaceSquircle state={focusRow.state} />}
            <span className="overlay-focus-name">{focusRow.name}</span>
            <span className="overlay-focus-state">· {STATE_LABEL[focusRow.state] ?? focusRow.state}</span>
          </div>
          {focusRow.snippet && <div className="overlay-snippet">{focusRow.snippet}</div>}
          {focusRow.tools && focusRow.tools.length > 0 && (
            <div className="overlay-tools">
              {focusRow.tools.map((t, i) => (
                <div key={`${t.name}-${i}`} className={`overlay-tool-card${t.done ? ' overlay-tool-done' : ''}`}>
                  <span className="overlay-tool-dot" />
                  <span className="overlay-tool-name">{t.name}</span>
                  <span className="overlay-tool-status">{t.done ? 'done' : 'running'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
