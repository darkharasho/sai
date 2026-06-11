import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { RenderRegion } from '../../../src/components/Chat/RenderToolCard';

const htmlEntry = (over: Record<string, unknown> = {}) => ({
  renderId: 'r1', kind: 'html', status: 'ready', width: 360,
  payload: { html: '<b>hi</b>' },
  ...over,
} as any);

function postSize(iframe: HTMLIFrameElement, size: { height?: number; width?: number }) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { __saiRender: 1, height: 100, ...size },
      source: iframe.contentWindow,
    }));
  });
}

describe('RenderRegion sizing + background', () => {
  it('paints the themed surface into the iframe body by default', () => {
    document.documentElement.style.setProperty('--sai-surface', '#101418');
    try {
      const { container } = render(<RenderRegion entry={htmlEntry()} />);
      const iframe = container.querySelector('iframe')!;
      expect(iframe.getAttribute('srcdoc')).toContain('background:#101418');
    } finally {
      document.documentElement.style.removeProperty('--sai-surface');
    }
  });

  it('uses an explicit background over the theme', () => {
    const { container } = render(<RenderRegion entry={htmlEntry({ background: '#0a0c0e' })} />);
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('srcdoc')).toContain('background:#0a0c0e');
  });

  it('falls back to the theme when the explicit background fails sanitization', () => {
    const { container } = render(
      <RenderRegion entry={htmlEntry({ background: 'red" onload="x' })} />,
    );
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('srcdoc')).toContain('background:#1a1a1a');
    expect(iframe.getAttribute('srcdoc')).not.toContain('onload');
  });

  it('injects a reporter that posts width as well as height', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('scrollWidth');
    expect(srcdoc).toContain('width:w()');
  });

  it('grows the region when the mock reports a wider natural width', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    const region = container.querySelector('[data-render-region]') as HTMLElement;
    expect(region.style.width).toBe('360px');
    postSize(container.querySelector('iframe')!, { width: 460 });
    expect(region.style.width).toBe('460px');
    expect(region.style.maxWidth).toBe('100%');
  });

  it('never shrinks after growing', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    const iframe = container.querySelector('iframe')!;
    postSize(iframe, { width: 500 });
    postSize(iframe, { width: 380 });
    const region = container.querySelector('[data-render-region]') as HTMLElement;
    expect(region.style.width).toBe('500px');
  });

  it('ignores width reports below the requested width', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    postSize(container.querySelector('iframe')!, { width: 120 });
    const region = container.querySelector('[data-render-region]') as HTMLElement;
    expect(region.style.width).toBe('360px');
  });
});
