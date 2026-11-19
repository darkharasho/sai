// Placeholder phone entry. Task 9 replaces this with the real phone app
// (shared chat components + src/styles/phone.css).
import React from 'react';
import ReactDOM from 'react-dom/client';

declare const __MOBILE__: boolean;

function App() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#090c0e',
        color: '#e6e6e6',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 32,
      }}
      data-mobile={__MOBILE__ ? '1' : '0'}
    >
      SAI
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
