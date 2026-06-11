import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/fonts';
import './styles/globals.css';

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
  import('./components/Overlay/OverlayView').then(({ OverlayView }) => {
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
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
