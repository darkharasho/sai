import { useState } from 'react';
import './RenderToolCard.css';
import type { ToolCall } from '../../types';
import type { RenderEntry } from '../../render/renderStore';
import { RenderRegion } from './RenderToolCard';

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

export function RenderToolCallCard({ tc }: { tc: ToolCall }) {
  const [showCode, setShowCode] = useState(false);
  const built = entryFromToolCall(tc);
  if (!built) return null;
  const { entry, code } = built;
  return (
    <div className="sai-render-card" data-testid="render-tool-call-card">
      <div className="sai-render-card__bar">
        <span className="sai-render-card__title">{entry.title || entry.kind}</span>
        <button
          type="button"
          data-testid="render-code-toggle"
          style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: 12 }}
          aria-expanded={showCode}
          onClick={() => setShowCode((v) => !v)}
        >
          {showCode ? 'Hide code' : 'Show code'}
        </button>
      </div>
      <RenderRegion entry={entry} />
      {showCode && (
        <pre
          data-testid="render-code"
          style={{
            margin: 0,
            padding: 12,
            maxHeight: 280,
            overflow: 'auto',
            fontSize: 12,
            borderTop: '1px solid var(--sai-border, #333)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {code}
        </pre>
      )}
    </div>
  );
}
