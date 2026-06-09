import { useSyncExternalStore } from 'react';
import { renderStore } from '../../render/renderStore';
import { RenderToolCard } from '../../components/Chat/RenderToolCard';
import { RenderPreviewPanel } from '../../components/Chat/RenderPreviewPanel';

// Seed the store synchronously so it's populated before the component mounts
// and subscribes via useSyncExternalStore. _resetForTests would wipe listeners
// added during render, so we seed outside of any effect.
function seedStore(kind: 'html' | 'component', id: string): void {
  renderStore._resetForTests();
  if (kind === 'html') {
    renderStore.upsert({
      renderId: id,
      kind: 'html',
      payload: { html: '<b id="mock">hello mock</b>' },
      title: 'HTML',
      width: 320,
      status: 'ready',
    });
  } else {
    renderStore.upsert({
      renderId: id,
      kind: 'component',
      payload: { component: 'WorkspaceSquircle', props: { state: 'busy-done' } },
      title: 'Component',
      width: 320,
      status: 'ready',
    });
  }
}

// Module-level flag so we seed exactly once per story load (the store is a
// singleton; re-seeding on every re-render would be wrong in StrictMode).
let seeded: string | null = null;

function SaiRenderHarness({ kind }: { kind: 'html' | 'component' }) {
  const id = `story-${kind}`;

  // Seed synchronously the very first time this story variant is mounted.
  if (seeded !== id) {
    seeded = id;
    seedStore(kind, id);
  }

  // Subscribe so the component re-renders if the store changes later.
  useSyncExternalStore(renderStore.subscribe, () => renderStore.get(id));

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <RenderToolCard renderId={id} onPopOut={() => {}} />
      <RenderPreviewPanel />
    </div>
  );
}

export const saiRenderStory = {
  component: SaiRenderHarness,
  parseProps: (params: URLSearchParams) => ({ kind: (params.get('kind') ?? 'html') as 'html' | 'component' }),
};
