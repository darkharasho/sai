import { useContext, useEffect, useReducer, useRef } from 'react';
import { PanelRight, PanelRightClose, X } from 'lucide-react';
import { CanvasContext, CanvasTab } from '../../canvas/CanvasContext';
import { checklistTotals } from '../../canvas/canvasStats';
import { canvasTitle } from '../../lib/canvasName';
import { visibleSelection } from '../../canvas/canvasSidebarState';
import './canvasSidebar.css';

/** An agent write this recent makes its strip bar glow. */
const LIVE_MS = 6000;
export const CANVAS_PANEL_MIN = 300;
export const CANVAS_PANEL_MAX = 900;

export interface CanvasSidebarProps {
  /** This chat's canvases (canvasKey paths), in tab order. Ones not on disk (yet) are skipped. */
  paths: string[];
  open: boolean;
  /** The tab to show; falls back to the first canvas on disk. */
  selected: string | null;
  width: number;
  onToggle(): void;
  onSelect(path: string): void;
  /** Close a canvas from this chat's tabs (the file stays on disk). */
  onRemove?(path: string): void;
  onResize(width: number): void;
}

const nameOf = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');

/**
 * Right-edge canvas sidebar for the chat on screen: a thin always-there strip (one progress bar
 * per canvas) that expands into the live canvas, with a tab per canvas.
 */
export function CanvasSidebar({ paths, open, selected, width, onToggle, onSelect, onRemove, onResize }: CanvasSidebarProps) {
  const ctl = useContext(CanvasContext);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => ctl?.store.subscribe(bump), [ctl?.store]);

  const now = Date.now();
  const items = paths.flatMap((p) => {
    const c = ctl?.store.get(p);
    if (!c) return [];
    const content = c?.content ?? '';
    const totals = checklistTotals(content);
    return [{
      path: p,
      title: canvasTitle(content, nameOf(p)),
      totals,
      live: c.agentEditedAt > 0 && now - c.agentEditedAt < LIVE_MS,
    }];
  });
  const sel = visibleSelection(selected, items.map((i) => i.path));
  // Re-render once a glow should fade.
  const anyLive = items.some((i) => i.live);
  useEffect(() => {
    if (!anyLive) return;
    const t = setTimeout(bump, LIVE_MS);
    return () => clearTimeout(t);
  }, [anyLive, now]);

  const drag = useRef<{ x: number; w: number } | null>(null);
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: width };
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      const w = drag.current.w + (drag.current.x - ev.clientX);
      onResize(Math.max(CANVAS_PANEL_MIN, Math.min(CANVAS_PANEL_MAX, w)));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('canvas-sidebar-resizing');
    };
    document.body.classList.add('canvas-sidebar-resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!ctl || !sel) return null;

  return (
    <aside className={`canvas-sidebar${open ? ' canvas-sidebar--open' : ''}`} data-testid="canvas-sidebar">
      {open && (
        <div className="canvas-sidebar__panel" style={{ width }}>
          <div className="canvas-sidebar__resize" onMouseDown={onDragStart} aria-hidden />
          <div className="canvas-sidebar__tabs" role="tablist" aria-label="Canvases">
            {items.map((it) => (
              <div key={it.path} className={`canvas-sidebar__tabwrap${it.path === sel ? ' canvas-sidebar__tabwrap--on' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={it.path === sel}
                  className={`canvas-sidebar__tab${it.path === sel ? ' canvas-sidebar__tab--on' : ''}`}
                  title={it.title}
                  onClick={() => onSelect(it.path)}
                  onAuxClick={(e) => { if (e.button === 1 && onRemove) { e.preventDefault(); onRemove(it.path); } }}
                >
                  {it.live && <span className="canvas-sidebar__tabdot" aria-hidden />}
                  <span className="canvas-sidebar__tablabel">{it.title}</span>
                </button>
                {onRemove && (
                  <button
                    type="button"
                    className="canvas-sidebar__tabclose"
                    title="Close from this chat (the file stays)"
                    aria-label={`Close ${it.title}`}
                    onClick={() => onRemove(it.path)}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="canvas-sidebar__collapse" onClick={onToggle} title="Collapse canvas" aria-label="Collapse canvas">
              <PanelRightClose size={14} />
            </button>
          </div>
          <div className="canvas-sidebar__body" role="tabpanel">
            <CanvasTab path={sel} />
          </div>
        </div>
      )}
      <div
        className="canvas-sidebar__strip"
        role="button"
        tabIndex={0}
        aria-label={open ? 'Collapse canvas' : 'Open canvas'}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <span className="canvas-sidebar__icon" aria-hidden>
          {open ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
        </span>
        {items.map((it) => {
          const { done, failed, total } = it.totals;
          const summary = total > 0 ? `${done} of ${total}${failed ? ` · ${failed} failed` : ''}` : 'no checklist';
          // Progress ring: done (accent), then failed (red), the rest track.
          const d = total ? (360 * done) / total : 0;
          const f = total ? (360 * (done + failed)) / total : 0;
          const ring = `conic-gradient(var(--accent) 0 ${d}deg, #f87171 ${d}deg ${f}deg, var(--surface-4) ${f}deg)`;
          return (
            <button
              key={it.path}
              type="button"
              className={`canvas-sidebar__bar${it.path === sel && open ? ' canvas-sidebar__bar--on' : ''}${it.live ? ' canvas-sidebar__bar--live' : ''}`}
              style={{ background: ring }}
              title={`${it.title} — ${summary}`}
              aria-label={`${it.title}, ${summary}`}
              onClick={(e) => {
                e.stopPropagation();
                if (open && it.path === sel) onToggle();
                else onSelect(it.path);
              }}
            />
          );
        })}
      </div>
    </aside>
  );
}
