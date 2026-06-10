import { useSyncExternalStore } from 'react';
import { renderStore } from '../../render/renderStore';
import { RenderRegion } from './RenderToolCard';

export function RenderPreviewPanel({ renderId }: { renderId?: string }) {
  const activeId = useSyncExternalStore(renderStore.subscribe, () => renderStore.activeId());
  const id = renderId ?? activeId ?? undefined;
  const entry = id ? renderStore.get(id) : undefined;
  if (!entry) {
    return <div style={{ padding: 16, opacity: 0.6 }}>No render yet. Ask the agent to render something.</div>;
  }
  return (
    <div data-testid="render-preview-panel" style={{ padding: 16, overflow: 'auto' }}>
      <RenderRegion entry={entry} />
    </div>
  );
}
