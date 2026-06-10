import { useSyncExternalStore } from 'react';
import { renderStore } from '../../render/renderStore';
import { RenderToolCard } from '../../components/Chat/RenderToolCard';
import { RenderPreviewPanel } from '../../components/Chat/RenderPreviewPanel';

// Seed the store synchronously so it's populated before the component mounts
// and subscribes via useSyncExternalStore. _resetForTests would wipe listeners
// added during render, so we seed outside of any effect.
function seedStore(kind: 'html' | 'component' | 'file', id: string): void {
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
  } else if (kind === 'file') {
    renderStore.upsert({
      renderId: id,
      kind: 'html',
      payload: { mode: 'file', cwd: '/workspace', path: 'index.html', height: 360 },
      title: 'Site',
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

function ensureFileStub(): void {
  const w = window as unknown as {
    sai?: {
      renderMintFileUrl?: (a: unknown) => Promise<{ ok: true; url: string; token: string } | { ok: false; error: string }>;
      renderReleaseFileUrl?: (t: string) => void;
    };
  };
  w.sai = w.sai ?? {};
  if (!w.sai.renderMintFileUrl) {
    // A self-contained data: document so the file-mode iframe shows something in
    // the browser harness (no real sai-render:// protocol here). data:text/html
    // gives an opaque origin, which is fine for the allow-same-origin iframe.
    const dataUrl =
      'data:text/html,' +
      encodeURIComponent(
        '<style>#m{color:rgb(0,128,0);font:600 18px sans-serif}</style>' +
        '<div id="m">file-mode render</div>',
      );
    w.sai.renderMintFileUrl = async () => ({ ok: true, url: dataUrl, token: 'story-tok' });
  }
  if (!w.sai.renderReleaseFileUrl) {
    w.sai.renderReleaseFileUrl = () => {};
  }
}

function SaiRenderHarness({ kind }: { kind: 'html' | 'component' | 'file' }) {
  const id = `story-${kind}`;

  // File mode needs a window.sai stub to mint a URL in the plain browser
  // harness. Must run before FileRenderedHtml's mount effect; the component
  // body during render is fine and runs early enough.
  if (kind === 'file') {
    ensureFileStub();
  }

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
  parseProps: (params: URLSearchParams) => ({ kind: (params.get('kind') ?? 'html') as 'html' | 'component' | 'file' }),
};
