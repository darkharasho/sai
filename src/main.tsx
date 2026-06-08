import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/fonts';
import './styles/globals.css';

const root = document.getElementById('root')!;

if (import.meta.env.DEV && window.location.pathname.startsWith('/test-harness')) {
  import('./test-harness').then(({ TestHarness }) => {
    ReactDOM.createRoot(root).render(<TestHarness />);
  });
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
