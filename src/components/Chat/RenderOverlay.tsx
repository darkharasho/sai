import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { renderStore } from '../../render/renderStore';
import { RenderRegion } from './RenderToolCard';

export function RenderOverlay() {
  const activeId = useSyncExternalStore(renderStore.subscribe, () => renderStore.activeId());
  const [dismissed, setDismissed] = useState<string | null>(null);
  const entry = activeId ? renderStore.get(activeId) : undefined;
  if (!activeId || !entry || activeId === dismissed) return null;
  return (
    <div
      data-testid="render-overlay"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1000,
        maxWidth: '40vw',
        maxHeight: '60vh',
        overflow: 'auto',
        background: 'var(--sai-surface, #1a1a1a)',
        border: '1px solid var(--sai-border, #333)',
        borderRadius: 10,
        boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--sai-border, #333)',
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>{entry.title || entry.kind}</span>
        <button
          type="button"
          aria-label="Close render preview"
          style={{ marginLeft: 'auto', cursor: 'pointer' }}
          onClick={() => setDismissed(activeId)}
        >
          ✕
        </button>
      </div>
      <div style={{ padding: 12 }}>
        <RenderRegion entry={entry} />
      </div>
    </div>
  );
}
