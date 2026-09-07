import React from 'react';
import { heapStats } from './heapStats';

/**
 * Root error boundary.
 *
 * Without one of these, React 18's createRoot unmounts the ENTIRE tree when any
 * render, commit, or effect throws. #root goes empty, the dark page background
 * is all that's left, and no future state change can bring it back because the
 * root is permanently torn down — the app is black until a reload. That is a
 * silent failure with no crash dump and no log line, because the renderer
 * process never died.
 *
 * So this component has two jobs, and the second matters more than the first:
 * keep a blown-up tree recoverable in place, and record what actually threw so
 * the underlying bug stops being invisible.
 *
 * Deliberately styled inline: a crash screen cannot assume the stylesheet is
 * healthy, and this is the one surface that has to render no matter what.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    window.sai?.devlog?.('reactTreeCrashed', {
      message: String(error?.message ?? error),
      name: error?.name,
      stack: error?.stack?.slice(0, 4000),
      componentStack: info.componentStack?.slice(0, 4000),
      url: window.location.href,
      ...heapStats(),
    });
    // Keep it in the devtools console too, for anyone who has them open.
    console.error('[sai] react tree crashed', error, info.componentStack);
  }

  private details(): string {
    const { error, componentStack } = this.state;
    return [
      `SAI renderer crash`,
      `url: ${window.location.href}`,
      ``,
      error?.stack ?? String(error),
      ``,
      `component stack:${componentStack ?? ' (unavailable)'}`,
    ].join('\n');
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          background: '#111418',
          color: '#bec6d0',
          font: '13px/1.6 ui-sans-serif, system-ui, sans-serif',
          textAlign: 'center',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e0e0' }}>
          SAI hit a rendering error
        </div>
        <div style={{ maxWidth: 560, opacity: 0.75 }}>
          The interface stopped instead of going black. Your sessions are still
          running in the background — reloading restores the window without
          losing them.
        </div>
        <pre
          style={{
            maxWidth: 720,
            maxHeight: 220,
            overflow: 'auto',
            textAlign: 'left',
            padding: '10px 12px',
            margin: 0,
            borderRadius: 8,
            border: '1px solid #2c2d33',
            background: '#0c0f11',
            color: '#f97316',
            font: '11px/1.5 ui-monospace, monospace',
            whiteSpace: 'pre-wrap',
          }}
        >
          {String(error?.message ?? error)}
        </pre>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '7px 16px',
              borderRadius: 7,
              border: '1px solid #d4a72c',
              background: 'transparent',
              color: '#d4a72c',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => { void navigator.clipboard.writeText(this.details()); }}
            style={{
              padding: '7px 16px',
              borderRadius: 7,
              border: '1px solid #2c2d33',
              background: 'transparent',
              color: '#bec6d0',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Copy details
          </button>
        </div>
      </div>
    );
  }
}
