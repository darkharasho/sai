import { useState } from 'react';
import { renderStore } from '../../render/renderStore';
import { RenderOverlay } from '../../components/Chat/RenderOverlay';

let seeded = false;
function RenderOverlayHarness() {
  // Seed synchronously (renderStore._resetForTests clears listeners, so seeding
  // in an effect would drop subscriptions). Guard against StrictMode double-call.
  const [id] = useState('overlay-1');
  if (!seeded) {
    seeded = true;
    renderStore._resetForTests();
    renderStore.upsert({ renderId: id, kind: 'html', payload: { html: '<b id="mock">hello overlay</b>' }, title: 'Overlay', width: 300, status: 'ready' });
  }
  return <RenderOverlay />;
}

export const renderOverlayStory = {
  component: RenderOverlayHarness,
  parseProps: () => ({}),
};
