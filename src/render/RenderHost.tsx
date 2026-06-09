import { useEffect } from 'react';
import { ThemedComponents } from './ThemedComponents';
import { parseRenderHostParams } from './renderHostParams';

declare global {
  interface Window { __renderReady?: boolean }
}

export function RenderHost() {
  const { components, props, vars } = parseRenderHostParams(window.location.search);
  useEffect(() => {
    let done = false;
    const signal = () => { if (!done) { done = true; window.__renderReady = true; } };
    // One frame for layout, then wait for fonts, then signal ready for capture.
    requestAnimationFrame(() => {
      const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (fonts?.ready) fonts.ready.then(signal, signal);
      else signal();
    });
  }, []);
  return (
    <div id="render-host-root" style={{ display: 'inline-block' }}>
      <ThemedComponents components={components} vars={vars} props={props} />
    </div>
  );
}
