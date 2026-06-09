import { useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import './RenderToolCard.css';
import { renderStore, type RenderEntry } from '../../render/renderStore';
import { getRegisteredComponent } from '../../render/componentRegistry';

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

function RenderedHtml({ entry }: { entry: RenderEntry }) {
  const userHtml = String((entry.payload as { html: string }).html);
  const doc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head><body style="margin:0">${userHtml}</body></html>`;
  return (
    <iframe
      title={entry.title || 'render'}
      sandbox="allow-scripts"
      style={{ width: '100%', border: 0 }}
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
