import { useState, useEffect } from 'react';
import './RenderToolCard.css';
import type { ToolCall } from '../../types';
import type { RenderEntry } from '../../render/renderStore';
import { RenderRegion } from './RenderToolCard';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';

// SAI squircle mark (filled) — crisp at small sizes; echoes the workspace dot.
function SaiDotIcon({ size = 13 }: { size?: number }) {
  return (
    <svg className="sai-rc__icon" width={size} height={size} viewBox="0 0 25.101052 25.075457" aria-hidden>
      <path
        transform="translate(311.45849 -181.48493)"
        fill="currentColor"
        d="m -307.14162,206.33575 c -2.2167,-0.53038 -3.93048,-2.50859 -4.2149,-4.86524 -0.0908,-0.75272 -0.12802,-4.6428 -0.0826,-8.64463 0.0816,-7.19725 0.0897,-7.28882 0.744,-8.45642 0.74372,-1.32718 1.96199,-2.2582 3.49518,-2.67104 0.64869,-0.17467 3.96137,-0.24841 8.88973,-0.19788 7.81819,0.0802 7.86135,0.0837 9.0361,0.74202 1.30104,0.72907 2.24436,1.94155 2.65183,3.40845 0.3667,1.32013 0.3468,15.47802 -0.0237,16.83217 -0.40752,1.48963 -2.42051,3.39272 -4.01272,3.79364 -1.35642,0.34155 -15.09644,0.39067 -16.48295,0.0589 z"
      />
    </svg>
  );
}

function parseInput(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// Stable-ish id when tc.id is missing (avoids data-render-region collisions).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

function entryFromToolCall(tc: ToolCall): { entry: RenderEntry; code: string } | null {
  const name = tc.name || '';
  const input = parseInput(tc.input);
  const width = typeof input.width === 'number' && input.width > 0 ? input.width : 360;
  const background = typeof input.background === 'string' ? input.background : undefined;
  const title = typeof input.title === 'string' ? input.title : '';
  const renderId = `chatcard-${tc.id ?? Math.abs(hashString(tc.input))}`;

  if (name.endsWith('sai_render_component')) {
    const component = typeof input.component === 'string' ? input.component : '';
    const props =
      input.props && typeof input.props === 'object'
        ? (input.props as Record<string, unknown>)
        : {};
    return {
      entry: {
        renderId,
        kind: 'component',
        payload: { component, props },
        title: title || component,
        width,
        background,
        status: 'ready',
      },
      code: JSON.stringify({ component, props }, null, 2),
    };
  }

  // default: html
  const html = typeof input.html === 'string' ? input.html : '';
  if (!html) return null;
  return {
    entry: {
      renderId,
      kind: 'html',
      payload: { html },
      title: title || 'HTML',
      width,
      background,
      status: 'ready',
    },
    code: html,
  };
}

function RenderCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState('');
  const [theme, setTheme] = useState(getActiveHighlightTheme());

  useEffect(() => {
    const h = () => setTheme(getActiveHighlightTheme());
    window.addEventListener('sai-highlight-theme-change', h);
    return () => window.removeEventListener('sai-highlight-theme-change', h);
  }, []);

  useEffect(() => {
    let alive = true;
    getShikiHighlighter().then((hl) => {
      if (!alive) return;
      try {
        setHtml(hl.codeToHtml(code, { lang, theme }));
      } catch {
        setHtml('');
      }
    });
    return () => {
      alive = false;
    };
  }, [code, lang, theme]);

  // Fallback to plain text until shiki resolves.
  if (!html) return <pre className="sai-rc__codeplain">{code}</pre>;
  return <div className="sai-rc__codehl" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function RenderToolCallCard({ tc }: { tc: ToolCall }) {
  const [showCode, setShowCode] = useState(false);
  const built = entryFromToolCall(tc);
  if (!built) return null;
  const { entry, code } = built;
  const lang = entry.kind === 'component' ? 'json' : 'html';
  // Narrow mocks open the code pane to the right; wide mocks (where side-by-side
  // would overflow the thread) drop the code block below the render instead.
  const layout = entry.width > 460 ? 'stack' : 'side';
  const mockName = entry.title || (entry.kind === 'html' ? 'HTML' : entry.kind);
  // Only html mocks are standalone documents we can open in a browser.
  const openableHtml = entry.kind === 'html' ? code : null;

  const openInBrowser = () => {
    const sai = (window as { sai?: { renderOpenInBrowser?: (html: string) => void } }).sai;
    if (openableHtml && sai?.renderOpenInBrowser) sai.renderOpenInBrowser(openableHtml);
  };

  return (
    <div className="sai-rc-wrap">
      <div
        className="sai-rc"
        data-testid="render-tool-call-card"
        data-layout={layout}
        data-expanded={showCode ? 'true' : 'false'}
      >
        <div className="sai-rc__bar">
          <span className="sai-rc__title">
            <SaiDotIcon />
            <span className="sai-rc__brand">Sai Renderer</span>
            <span className="sai-rc__sep">—</span>
            <span className="sai-rc__name">{mockName}</span>
          </span>
          {openableHtml && (
            <button
              type="button"
              className="sai-rc__openbtn"
              data-testid="render-open-browser"
              title="Open in browser"
              onClick={openInBrowser}
            >
              Open ↗
            </button>
          )}
          <button
            type="button"
            className="sai-rc__codebtn"
            data-testid="render-code-toggle"
            aria-expanded={showCode}
            onClick={() => setShowCode((v) => !v)}
          >
            {showCode ? '</> Hide' : '</> Code'}
          </button>
        </div>
        <div className="sai-rc__panes">
          <div className="sai-rc__render"><RenderRegion entry={entry} /></div>
          <div className="sai-rc__code" data-testid="render-code"><RenderCode code={code} lang={lang} /></div>
        </div>
      </div>
    </div>
  );
}
