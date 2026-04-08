import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';
import WhatsNewModal from '../../../src/components/WhatsNewModal';

// Mock react-markdown to avoid jsdom rendering issues
// Note: JSX string attributes pass literal \n (two chars), not real newlines
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const s = String(children);
    // Split on both real newlines and literal \n sequences (JSX string attribute escaping)
    const lines = s
      .split(/\\n|\n/)
      .filter((line: string) => line.trim())
      .map((line: string) => line.replace(/^#{1,6}\s+/, ''));
    return (
      <div data-testid="markdown-content">
        {lines.map((line: string, i: number) => <span key={i}>{line}</span>)}
      </div>
    );
  },
}));
vi.mock('remark-gfm', () => ({ default: () => () => {} }));

const defaultProps = {
  isOpen: true,
  version: '1.2.3',
  releases: [] as Array<{ version: string; notes: string }>,
  fetchStatus: 'loading' as const,
  onClose: vi.fn(),
};

describe('WhatsNewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockSai(createMockSai());
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<WhatsNewModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the header with version number for single release', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="success" releases={[{ version: '1.2.3', notes: 'Notes' }]} />);
    expect(screen.getByText("What's New in v1.2.3")).toBeTruthy();
  });

  it('renders generic header for multiple releases', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="success" releases={[
      { version: '1.2.3', notes: 'Notes 1' },
      { version: '1.2.2', notes: 'Notes 2' },
    ]} />);
    expect(screen.getByText("What's New")).toBeTruthy();
  });

  it('shows loading text when fetchStatus is "loading"', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="loading" />);
    expect(screen.getByText('Loading release notes…')).toBeTruthy();
  });

  it('shows GitHub fallback link when fetchStatus is "error"', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="error" />);
    expect(screen.getByText('See release notes on GitHub →')).toBeTruthy();
  });

  it('renders markdown content when fetchStatus is "success"', () => {
    render(
      <WhatsNewModal
        {...defaultProps}
        fetchStatus="success"
        releases={[{ version: '1.2.3', notes: "## Hello\n\nSome release notes here." }]}
      />
    );
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Some release notes here.')).toBeTruthy();
  });

  it('shows "no notes" message when fetchStatus is success but releases is empty', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="success" releases={[]} />);
    expect(screen.getByText('No release notes available for this version.')).toBeTruthy();
  });

  it('renders version headers for multiple releases', () => {
    render(
      <WhatsNewModal
        {...defaultProps}
        fetchStatus="success"
        releases={[
          { version: '1.2.3', notes: 'Latest notes' },
          { version: '1.2.2', notes: 'Previous notes' },
        ]}
      />
    );
    expect(screen.getByText('v1.2.3')).toBeTruthy();
    expect(screen.getByText('v1.2.2')).toBeTruthy();
    expect(screen.getByText('Latest notes')).toBeTruthy();
    expect(screen.getByText('Previous notes')).toBeTruthy();
  });

  it('calls onClose when close button (X) is clicked', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByTestId('whats-new-close-btn');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when "Got it" button is clicked', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Got it'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    const backdrop = container.querySelector('[data-testid="whats-new-backdrop"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when modal content is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    const modal = container.querySelector('[data-testid="whats-new-modal"]') as HTMLElement;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when ESC key is pressed', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose on ESC when modal is closed', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
