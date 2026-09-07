import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/fonts';
import './styles/globals.css';
import { ErrorBoundary } from './ErrorBoundary';
import { heapStats } from './heapStats';

// Anything that escapes React — event handlers, timers, awaited promises — never
// reaches componentDidCatch. Those throws don't blank the window on their own,
// but they're the breadcrumbs that precede one, and until now they vanished into
// a devtools console nobody had open.
window.addEventListener('error', (e) => {
  window.sai?.devlog?.('windowError', {
    message: String(e.message),
    source: e.filename,
    line: e.lineno,
    col: e.colno,
    stack: e.error?.stack?.slice(0, 4000),
    ...heapStats(),
  });
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string; stack?: string } | undefined;
  window.sai?.devlog?.('unhandledRejection', {
    message: String(reason?.message ?? e.reason),
    stack: reason?.stack?.slice(0, 4000),
    ...heapStats(),
  });
});

const root = document.getElementById('root')!;
const params = new URLSearchParams(window.location.search);

if (window.location.pathname.startsWith('/render-host') || params.has('render-host')) {
  // Offscreen capture host: minimal tree, no StrictMode (a one-shot ready flag
  // must not be double-invoked).
  import('./render/RenderHost').then(({ RenderHost }) => {
    ReactDOM.createRoot(root).render(<RenderHost />);
  });
} else if (window.location.hash === '#overlay') {
  // Focus-overlay window: minimal tree, no StrictMode (the view drives
  // window-level mouse-event state through main; double-invoked effects
  // would flap setIgnoreMouseEvents).
  // The overlay is its own window, so it has to load the saved accent/theme
  // itself — App's bootstrap never runs here.
  import('./components/Overlay/OverlayView').then(async ({ OverlayView }) => {
    const { bootstrapAppearance } = await import('./themes');
    await bootstrapAppearance().catch(() => { /* fall back to the CSS defaults */ });
    ReactDOM.createRoot(root).render(<OverlayView />);
  });
} else if (import.meta.env.DEV && window.location.pathname.startsWith('/test-harness')) {
  import('./test-harness').then(({ TestHarness }) => {
    ReactDOM.createRoot(root).render(<TestHarness />);
  });
} else {
  // App is imported dynamically so the lightweight windows above (overlay,
  // render host) never pull its dependency graph — in dev that graph is
  // hundreds of module requests and seconds of load time.
  import('./App').then(({ default: App }) => {
    ReactDOM.createRoot(root).render(
      // Outside StrictMode so it also catches whatever StrictMode's double
      // invocation surfaces in development.
      <ErrorBoundary>
        <React.StrictMode>
          <App />
        </React.StrictMode>
      </ErrorBoundary>
    );
  });
}
