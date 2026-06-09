import { useState, useEffect } from 'react';
import './RenderToolCard.css';
import type { ToolCall } from '../../types';
import type { RenderEntry } from '../../render/renderStore';
import { RenderRegion } from './RenderToolCard';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';
import { AppWindow } from 'lucide-react';
import { buildChartHtml, buildDiffHtml, type ChartInput, type DiffInput } from '../../render/builtinRenderers';
import { buildChoiceHtml } from '../../render/buildChoiceHtml';
import { registeredComponentKeys } from '../../render/componentRegistry';

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

export function entryFromToolCall(tc: ToolCall): { entry: RenderEntry; code: string } | null {
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

  if (name.endsWith('sai_render_chart')) {
    let html: string;
    try {
      html = buildChartHtml(input as unknown as ChartInput);
    } catch {
      return null;
    }
    return {
      entry: { renderId, kind: 'html', payload: { html }, title: title || 'Chart', width, background, status: 'ready' },
      code: html,
    };
  }

  if (name.endsWith('sai_render_diff')) {
    if (typeof input.before !== 'string' || input.before.length === 0 ||
        typeof input.after !== 'string' || input.after.length === 0) return null;
    const html = buildDiffHtml(input as unknown as DiffInput);
    return {
      entry: { renderId, kind: 'html', payload: { html }, title: title || 'Diff', width, background, status: 'ready' },
      code: html,
    };
  }

  if (name.endsWith('sai_render_mermaid')) {
    const diagram = typeof input.diagram === 'string' ? input.diagram : '';
    if (!diagram) return null;
    return {
      entry: { renderId, kind: 'mermaid', payload: { diagram }, title: title || 'Diagram', width, background, status: 'ready' },
      code: diagram,
    };
  }

  if (name.endsWith('sai_render_theme')) {
    const vars = input.vars && typeof input.vars === 'object' ? (input.vars as Record<string, string>) : null;
    if (!vars) return null;
    const components = Array.isArray(input.components) && input.components.length > 0
      ? (input.components as unknown[]).filter((c): c is string => typeof c === 'string')
      : registeredComponentKeys();
    const props = input.props && typeof input.props === 'object' && !Array.isArray(input.props)
      ? (input.props as Record<string, unknown>) : undefined;
    return {
      entry: { renderId, kind: 'theme', payload: { components, vars, ...(props ? { props } : {}) }, title: title || 'Theme', width, background, status: 'ready' },
      code: JSON.stringify(vars, null, 2),
    };
  }

  if (name.endsWith('sai_render_form')) {
    const html = typeof input.html === 'string' ? input.html : '';
    if (!html) return null;
    return {
      entry: { renderId, kind: 'form', payload: { html }, title: title || 'Form', width, background, status: 'ready' },
      code: html,
    };
  }

  if (name.endsWith('sai_confirm')) {
    const message = typeof input.message === 'string' ? input.message : '';
    if (!message) return null;
    const confirmLabel = typeof input.confirmLabel === 'string' ? input.confirmLabel : 'Confirm';
    const cancelLabel = typeof input.cancelLabel === 'string' ? input.cancelLabel : 'Cancel';
    const html = buildChoiceHtml({ message, choices: [{ label: confirmLabel, value: true }, { label: cancelLabel, value: false }] });
    return {
      entry: { renderId, kind: 'form', payload: { html }, title: title || 'Confirm', width, background, status: 'ready' },
      code: message,
    };
  }

  if (name.endsWith('sai_choose')) {
    const message = typeof input.message === 'string' ? input.message : '';
    const options = Array.isArray(input.options)
      ? (input.options as unknown[]).filter((o): o is string => typeof o === 'string')
      : [];
    if (!message || options.length === 0) return null;
    const html = buildChoiceHtml({ message, choices: options.map((o) => ({ label: o, value: o })) });
    return {
      entry: { renderId, kind: 'form', payload: { html }, title: title || 'Choose', width, background, status: 'ready' },
      code: message,
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
  const lang = entry.kind === 'component' || entry.kind === 'theme' ? 'json' : entry.kind === 'mermaid' ? 'text' : 'html';
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
            <AppWindow className="sai-rc__icon" size={14} strokeWidth={2} aria-hidden />
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
