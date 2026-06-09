import { useSyncExternalStore, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import './RenderToolCard.css';
import { renderStore, type RenderEntry } from '../../render/renderStore';
import { getRegisteredComponent } from '../../render/componentRegistry';
import { renderMermaidToSvg } from '../../render/renderMermaid';
import { ThemedComponents } from '../../render/ThemedComponents';
import { submitForm } from '../../render/formBridge';

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
      ) : entry.kind === 'mermaid' ? (
        <MermaidRender diagram={String((entry.payload as { diagram: string }).diagram)} />
      ) : entry.kind === 'theme' ? (
        <ThemedComponents
          components={(entry.payload as { components: string[] }).components}
          vars={(entry.payload as { vars: Record<string, string> }).vars}
          props={(entry.payload as { props?: Record<string, unknown> }).props}
        />
      ) : entry.kind === 'form' ? (
        <RenderedHtml entry={entry} enableSubmit />
      ) : (
        <MountComponent
          payload={entry.payload as { component: string; props: Record<string, unknown> }}
        />
      )}
    </div>
  );
}

// Injected only for form renders: exposes window.saiSubmit(value), which posts
// the user's value to the parent. The only new capability given to the sandbox.
// The target is '*' because the iframe runs without allow-same-origin (opaque
// origin), so the parent's origin is unknowable from inside the sandbox; '*' is
// the only viable target. The parent validates the sender via event.source
// (matched against the iframe's contentWindow), so the wildcard target is safe.
const SUBMIT_BRIDGE =
  '<script>window.saiSubmit=function(v){try{parent.postMessage({__saiFormSubmit:1,value:v},\'*\');}catch(e){}};<\/script>';

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

function RenderedHtml({ entry, enableSubmit }: { entry: RenderEntry; enableSubmit?: boolean }) {
  const userHtml = String((entry.payload as { html: string }).html);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const submittedRef = useRef(false);
  const [height, setHeight] = useState(300);
  const bridge = enableSubmit ? SUBMIT_BRIDGE : '';
  const doc =
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head>` +
    `<body style="margin:0">${userHtml}${bridge}${HEIGHT_REPORTER}</body></html>`;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const data = e.data as { __saiRender?: number; height?: number; __saiFormSubmit?: number; value?: unknown } | null;
      if (!data) return;
      if (data.__saiRender) {
        const h = Number(data.height);
        if (Number.isFinite(h) && h > 0) setHeight(Math.min(2000, Math.max(40, Math.ceil(h))));
      } else if (enableSubmit && data.__saiFormSubmit && !submittedRef.current) {
        submittedRef.current = true;
        submitForm(data.value);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enableSubmit]);

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

function MermaidRender({ diagram }: { diagram: string }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setSvg('');
    setErr('');
    renderMermaidToSvg(diagram).then(
      (s) => { if (alive) setSvg(s); },
      (e) => { if (alive) setErr(e instanceof Error ? e.message : 'mermaid error'); },
    );
    return () => { alive = false; };
  }, [diagram]);

  if (err) return <div className="sai-render-card__err">{err}</div>;
  if (!svg) return <div style={{ padding: 12, opacity: 0.6, fontSize: 12 }}>Rendering diagram…</div>;
  // svg is produced by mermaid with securityLevel:'strict' (sanitized).
  return <div style={{ padding: 12 }} dangerouslySetInnerHTML={{ __html: svg }} />;
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
