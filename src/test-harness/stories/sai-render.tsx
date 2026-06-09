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
      // A tall, dark mock (like a real button sketch) — exercises iframe
      // auto-grow: without it this content clips to the 150px iframe default.
      payload: {
        html:
          '<div id="mock" style="min-height:360px;display:grid;place-items:center;background:#0a0b0f">' +
          '<button style="padding:14px 28px;border-radius:12px;border:0;color:#fff;' +
          'background:linear-gradient(135deg,#6d28d9,#2563eb);font:600 16px sans-serif">hello mock</button></div>',
      },
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
