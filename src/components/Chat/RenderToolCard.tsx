import { useSyncExternalStore, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import './RenderToolCard.css';
import { renderStore, type RenderEntry } from '../../render/renderStore';
import { getRegisteredComponent } from '../../render/componentRegistry';

// Policy enforced inside the html-mock iframe (via a <meta> in srcDoc).
// `script-src 'unsafe-inline'` is intentional: mocks may include JS (a product
// decision), and the iframe's `sandbox="allow-scripts"` does NOT override CSP —
// with `default-src 'none'` and no script-src, inline scripts would be blocked.
// `allow-scripts` (without allow-same-origin) provides the isolation; the CSP
// additionally blocks all network/remote loads (only inline styles + data: imgs).
const SANDBOX_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;";

function useRenderEntry(renderId: string): RenderEntry | undefined {
  return useSyncExternalStore(renderStore.subscribe, () => renderStore.get(renderId));
}

export function RenderToolCard({
  renderId,
  onPopOut,
}: {
  renderId: string;
  onPopOut?: (id: string) => void;
}) {
  const entry = useRenderEntry(renderId);
  if (!entry) return null;

  return (
    <div className="sai-render-card" data-testid="render-tool-card">
      <div className="sai-render-card__bar">
        <span className="sai-render-card__title">{entry.title || entry.kind}</span>
        {entry.status === 'error' && (
          <span className="sai-render-card__err">{entry.error}</span>
        )}
        {onPopOut && (
          <button type="button" onClick={() => onPopOut(renderId)} aria-label="Pop out render">
            Pop out ↗
          </button>
        )}
      </div>
      <RenderRegion entry={entry} />
    </div>
  );
}

export function RenderRegion({ entry }: { entry: RenderEntry }) {
  const style: CSSProperties = {
    width: entry.width,
    background: entry.background ?? 'var(--sai-surface, #1a1a1a)',
    display: 'inline-block',
  };
  return (
    <div data-render-region={entry.renderId} data-testid="render-region" style={style}>
      {entry.kind === 'html' ? (
        <RenderedHtml entry={entry} />
      ) : (
        <MountComponent
          payload={entry.payload as { component: string; props: Record<string, unknown> }}
        />
      )}
    </div>
  );
}

// Injected into the sandboxed mock so it can report its content height back to
// the parent. allow-scripts permits this; postMessage to the parent works even
// from the opaque (no same-origin) sandbox. The parent matches on event.source.
const HEIGHT_REPORTER =
  '<script>(function(){' +
  'function h(){return Math.ceil(Math.max(document.documentElement.scrollHeight,(document.body?document.body.scrollHeight:0)));}' +
  "function post(){try{parent.postMessage({__saiRender:1,height:h()},'*');}catch(e){}}" +
  "window.addEventListener('load',post);window.addEventListener('resize',post);" +
  'try{if(window.ResizeObserver){new ResizeObserver(post).observe(document.documentElement);}}catch(e){}' +
  'post();setTimeout(post,50);setTimeout(post,300);' +
  '})();<\/script>';

function RenderedHtml({ entry }: { entry: RenderEntry }) {
  const userHtml = String((entry.payload as { html: string }).html);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Iframes default to 150px; mocks are usually taller and center their content,
  // so without auto-sizing the body renders below the fold (looks blank/black).
  const [height, setHeight] = useState(300);
  const doc =
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head>` +
    `<body style="margin:0">${userHtml}${HEIGHT_REPORTER}</body></html>`;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const data = e.data as { __saiRender?: number; height?: number } | null;
      if (!data || !data.__saiRender) return;
      const h = Number(data.height);
      if (Number.isFinite(h) && h > 0) setHeight(Math.min(2000, Math.max(40, Math.ceil(h))));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title={entry.title || 'render'}
      sandbox="allow-scripts"
      style={{ width: '100%', height, border: 0, display: 'block' }}
      srcDoc={doc}
    />
  );
}

function MountComponent({
  payload,
}: {
  payload: { component: string; props: Record<string, unknown> };
}) {
  const reg = getRegisteredComponent(payload.component);
  if (!reg) {
    return (
      <div className="sai-render-card__err">unknown component: {payload.component}</div>
    );
  }
  const Cmp = reg.component;
  return <Cmp {...payload.props} />;
}
