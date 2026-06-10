import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RenderRegion } from '../../../src/components/Chat/RenderToolCard';

beforeEach(() => {
  (window as any).sai = {
    renderMintFileUrl: vi.fn(async () => ({ ok: true, url: 'sai-render://tok/index.html', token: 'tok' })),
    renderReleaseFileUrl: vi.fn(async () => true),
  };
});

describe('RenderedHtml file mode', () => {
  it('file-mode render mints a url and uses src + allow-same-origin', async () => {
    const entry = {
      renderId: 'r1', kind: 'html', status: 'ready', width: 360,
      payload: { mode: 'file', cwd: '/work', path: 'index.html' },
    } as any;
    const { container } = render(<RenderRegion entry={entry} />);
    await waitFor(() => {
      const iframe = container.querySelector('iframe')!;
      expect(iframe.getAttribute('src')).toBe('sai-render://tok/index.html');
      expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin');
      expect(iframe.hasAttribute('srcdoc')).toBe(false);
    });
  });

  it('inline render still uses srcdoc without allow-same-origin', () => {
    const entry = {
      renderId: 'r2', kind: 'html', status: 'ready', width: 360,
      payload: { html: '<b>hi</b>' },
    } as any;
    const { container } = render(<RenderRegion entry={entry} />);
    const iframe = container.querySelector('iframe')!;
    expect(iframe.hasAttribute('srcdoc')).toBe(true);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('file-mode render shows an error when mint is blocked', async () => {
    (window as any).sai.renderMintFileUrl = vi.fn(async () => ({ ok: false, error: 'nope' }));
    const entry = {
      renderId: 'r3', kind: 'html', status: 'ready', width: 360,
      payload: { mode: 'file', cwd: '/work', path: 'secret' },
    } as any;
    const { container, findByText } = render(<RenderRegion entry={entry} />);
    await findByText('nope');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
