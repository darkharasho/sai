import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WorkspaceToast from '../../../src/components/WorkspaceToast';

describe('WorkspaceToast', () => {
  it('renders the attention tone with an amber glyph', () => {
    render(<WorkspaceToast message="Approval needed" tone="attention" onDismiss={() => {}} />);
    expect(screen.getByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
  });

  it('invokes onClick before dismissal when provided', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(<WorkspaceToast message="m" tone="success" onDismiss={onDismiss} onClick={onClick} />);
    const toast = container.firstChild?.firstChild as HTMLElement;
    fireEvent.click(toast);
    expect(onClick).toHaveBeenCalled();
  });
});
