import { useSyncExternalStore, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import './RenderToolCard.css';
import { renderStore, type RenderEntry } from '../../render/renderStore';
import { getRegisteredComponent } from '../../render/componentRegistry';
import { renderMermaidToSvg } from '../../render/renderMermaid';
import { ThemedComponents } from '../../render/ThemedComponents';
import { submitForm } from '../../render/formBridge';
import { nextRenderWidth, sanitizeCssColor, resolveThemedSurface } from '../../render/renderSizing';

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
  // Grow-only natural width: starts at the requested width, widens when the
  // sandboxed mock reports a larger scrollWidth, and is capped to the message
  // column by maxWidth. Never shrinks (see renderSizing.nextRenderWidth).
  const [displayWidth, setDisplayWidth] = useState(entry.width);
  useEffect(() => {
    setDisplayWidth((w) => Math.max(w, entry.width));
  }, [entry.width]);
  const onNaturalWidth = useCallback((reported: number) => {
    setDisplayWidth((w) => nextRenderWidth(w, reported, entry.width));
  }, [entry.width]);
  const style: CSSProperties = {
    width: displayWidth,
    maxWidth: '100%',
    // Sanitized: the wrapper styles the MAIN document — a raw model-supplied
    // value like url(https://…) would fetch from the privileged renderer.
    background: (entry.background && sanitizeCssColor(entry.background)) || 'var(--sai-surface, #1a1a1a)',
    display: 'inline-block',
  };
  return (
    <div data-render-region={entry.renderId} data-testid="render-region" style={style}>
      {entry.kind === 'html' ? (
        <RenderedHtml entry={entry} onNaturalWidth={onNaturalWidth} />
      ) : entry.kind === 'mermaid' ? (
        <MermaidRender diagram={String((entry.payload as { diagram: string }).diagram)} />
      ) : entry.kind === 'theme' ? (
        <ThemedComponents
          components={(entry.payload as { components: string[] }).components}
          vars={(entry.payload as { vars: Record<string, string> }).vars}
          props={(entry.payload as { props?: Record<string, unknown> }).props}
        />
      ) : entry.kind === 'form' ? (
        <RenderedHtml entry={entry} enableSubmit onNaturalWidth={onNaturalWidth} />
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

// Injected into the sandboxed mock so it can report its content size back to
// the parent. allow-scripts permits this; postMessage to the parent works even
// from the opaque (no same-origin) sandbox. The parent matches on event.source.
const SIZE_REPORTER =
  '<script>(function(){' +
  'function h(){return Math.ceil(Math.max(document.documentElement.scrollHeight,(document.body?document.body.scrollHeight:0)));}' +
  'function w(){return Math.ceil(Math.max(document.documentElement.scrollWidth,(document.body?document.body.scrollWidth:0)));}' +
  "function post(){try{parent.postMessage({__saiRender:1,height:h(),width:w()},'*');}catch(e){}}" +
  "window.addEventListener('load',post);window.addEventListener('resize',post);" +
  'try{if(window.ResizeObserver){new ResizeObserver(post).observe(document.documentElement);}}catch(e){}' +
  'post();setTimeout(post,50);setTimeout(post,300);' +
  '})();<\/script>';

function RenderedHtml({ entry, enableSubmit, onNaturalWidth }: {
  entry: RenderEntry; enableSubmit?: boolean; onNaturalWidth?: (w: number) => void;
}) {
  const payload = entry.payload as {
    html?: string; mode?: string; cwd?: string; path?: string; baseDir?: string; height?: number;
  };
  if (payload.mode === 'file') {
    return <FileRenderedHtml entry={entry} payload={payload} />;
  }
  const userHtml = String(payload.html ?? '');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const submittedRef = useRef(false);
  const [height, setHeight] = useState(300);
  const bridge = enableSubmit ? SUBMIT_BRIDGE : '';
  // Memoized per background value: recomputing on theme change would alter the
  // srcDoc and reload the iframe, wiping in-progress form input (spec: theme
  // changes don't repaint mounted mocks).
  const bodyBg = useMemo(
    () => (entry.background && sanitizeCssColor(entry.background)) || resolveThemedSurface(),
    [entry.background],
  );
  const doc =
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head>` +
    `<body style="margin:0;background:${bodyBg}">${userHtml}${bridge}${SIZE_REPORTER}</body></html>`;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const data = e.data as { __saiRender?: number; height?: number; width?: number; __saiFormSubmit?: number; value?: unknown } | null;
      if (!data) return;
      if (data.__saiRender) {
        const h = Number(data.height);
        if (Number.isFinite(h) && h > 0) setHeight(Math.min(2000, Math.max(40, Math.ceil(h))));
        const wRep = Number((data as { width?: number }).width);
        if (Number.isFinite(wRep) && wRep > 0) onNaturalWidth?.(wRep);
      } else if (enableSubmit && data.__saiFormSubmit && !submittedRef.current) {
        submittedRef.current = true;
        submitForm(data.value);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enableSubmit, onNaturalWidth]);

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

function FileRenderedHtml({
  entry,
  payload,
}: {
  entry: RenderEntry;
  payload: { cwd?: string; path?: string; html?: string; baseDir?: string; height?: number };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const height = payload.height && payload.height > 0 ? payload.height : 480;

  useEffect(() => {
    let token: string | null = null;
    let alive = true;
    const sai = (window as {
      sai?: {
        renderMintFileUrl?: (a: unknown) => Promise<{ ok: boolean; url?: string; token?: string; error?: string }>;
        renderReleaseFileUrl?: (t: string) => void;
      };
    }).sai;
    sai?.renderMintFileUrl?.({
      cwd: payload.cwd, path: payload.path, html: payload.html, baseDir: payload.baseDir,
    }).then((r) => {
      if (!alive) {
        if (r.ok && r.token) sai?.renderReleaseFileUrl?.(r.token);
        return;
      }
      if (r.ok && r.url) { setUrl(r.url); token = r.token ?? null; }
      else setErr(r.error ?? 'render blocked');
    });
    return () => {
      alive = false;
      if (token) sai?.renderReleaseFileUrl?.(token);
    };
  }, [payload.cwd, payload.path, payload.html, payload.baseDir]);

  if (err) return <div className="sai-render-card__err">{err}</div>;
  if (!url) return <div style={{ padding: 12, opacity: 0.6, fontSize: 12 }}>Loading…</div>;
  return (
    <iframe
      title={entry.title || 'render'}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: '100%', height, border: 0, display: 'block' }}
      src={url}
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
