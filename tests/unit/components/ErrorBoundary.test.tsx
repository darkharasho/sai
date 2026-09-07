/**
 * Regression test for the black-screen bug.
 *
 * Symptom: SAI would randomly go black and stay black. Nothing recovered it —
 * not refocusing, not resizing, not switching workspaces — only Ctrl+R. No
 * crash dump was ever written and the renderer process stayed alive for hours
 * across the failure, which ruled out a process death.
 *
 * Mechanism: React 18's createRoot unmounts the WHOLE tree when a render,
 * commit, or effect throws and no boundary catches it. #root empties out, the
 * dark page background is all that remains, and the root is torn down for good
 * — no later state change can ever re-render it. The app was black in a
 * perfectly healthy process, which is why it left no trace anywhere.
 *
 * The first test below is the actual regression: it asserts the tree survives a
 * throw. It fails against the old code, where App was rendered bare inside
 * StrictMode with no boundary anywhere in the renderer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../../src/ErrorBoundary';

function Boom({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  let devlog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    devlog = vi.fn();
    (window as any).sai = { ...(window as any).sai, devlog };
    // React logs the caught error itself; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders something instead of a blank page when a child throws', () => {
    const { container } = render(
      <ErrorBoundary>
        <Boom message="kaboom" />
      </ErrorBoundary>
    );

    // The black screen WAS an empty container. That is the whole bug.
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText(/SAI hit a rendering error/i)).toBeTruthy();
  });

  it('offers a way back without a devtools reload', () => {
    render(
      <ErrorBoundary>
        <Boom message="kaboom" />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
  });

  it('surfaces the error message so the failure is not silent', () => {
    render(
      <ErrorBoundary>
        <Boom message="transcript blew up" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/transcript blew up/)).toBeTruthy();
  });

  it('records the crash to the devlog, since nothing else does', () => {
    render(
      <ErrorBoundary>
        <Boom message="transcript blew up" />
      </ErrorBoundary>
    );

    expect(devlog).toHaveBeenCalledWith(
      'reactTreeCrashed',
      expect.objectContaining({ message: 'transcript blew up' })
    );
    const [, payload] = devlog.mock.calls[0];
    expect(payload.componentStack).toContain('Boom');
  });

  it('leaves a healthy tree completely alone', () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('all good')).toBeTruthy();
    expect(devlog).not.toHaveBeenCalled();
  });
});
