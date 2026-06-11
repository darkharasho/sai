import { useEffect, useState } from 'react';
import { WorkspaceSquircle } from '../shared/WorkspaceSquircle';
import type { OverlayPayload } from '../../lib/overlayFeed';
import type { IndicatorState } from '../../lib/workspaceStatus';
import './OverlayView.css';

const STATE_LABEL: Partial<Record<IndicatorState, string>> = {
  busy: 'working',
  'busy-done': 'working',
  done: 'done',
  approval: 'approval needed',
  question: 'waiting for your answer',
};

/** Renderer for the focus-overlay window (#overlay hash). Display-only: a
 *  status strip of every reportable workspace plus the most interesting
 *  conversation's tail. Ctrl+Shift+hover asks main to make the window
 *  interactive (drag/click); anything else keeps it click-through. */
export function OverlayView() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    const off = (window as any).sai?.overlayOnState?.((p: OverlayPayload) => setPayload(p));
    return () => { off?.(); };
  }, []);

  const requestInteractive = (v: boolean) => {
    setInteractive(v);
    (window as any).sai?.overlaySetInteractive?.(v);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const want = e.ctrlKey && e.shiftKey;
    if (want !== interactive) requestInteractive(want);
  };

  if (!payload?.hasReportable) return <div className="overlay-root overlay-empty" />;

  return (
    <div
      className={`overlay-root${interactive ? ' overlay-interactive' : ''}`}
      onMouseMove={onMouseMove}
      onMouseLeave={() => { if (interactive) requestInteractive(false); }}
    >
      <div className="overlay-card">
        <div className="overlay-strip">
          {payload.strip.map((r) => (
            <span key={r.path} className="overlay-strip-item">
              <WorkspaceSquircle state={r.state} />
              <span className={`overlay-strip-name${r.kind === 'meta' ? ' overlay-meta' : ''}`}>
                {r.kind === 'meta' ? `meta:${r.name}` : r.name}
              </span>
            </span>
          ))}
        </div>
        {payload.focus && (
          <div className="overlay-focus">
            <div className="overlay-focus-head">
              <WorkspaceSquircle state={payload.focus.state} />
              <span className="overlay-focus-name">{payload.focus.name}</span>
              <span className="overlay-focus-state">· {STATE_LABEL[payload.focus.state] ?? payload.focus.state}</span>
            </div>
            {payload.focus.snippet && <div className="overlay-snippet">{payload.focus.snippet}</div>}
            {payload.focus.toolLine && <div className="overlay-tool">{payload.focus.toolLine}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
