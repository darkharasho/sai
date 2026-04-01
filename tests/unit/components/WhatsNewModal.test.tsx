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
  releaseNotes: null,
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

  it('renders the header with version number', () => {
    render(<WhatsNewModal {...defaultProps} />);
    expect(screen.getByText("What's New in v1.2.3")).toBeTruthy();
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
        releaseNotes="## Hello\n\nSome release notes here."
      />
    );
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Some release notes here.')).toBeTruthy();
  });

  it('shows "no notes" message when fetchStatus is success but releaseNotes is empty string', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="success" releaseNotes="" />);
    expect(screen.getByText('No release notes available for this version.')).toBeTruthy();
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
