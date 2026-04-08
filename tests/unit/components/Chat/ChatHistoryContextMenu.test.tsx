import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ChatHistoryContextMenu from '../../../../src/components/Chat/ChatHistoryContextMenu';

describe('ChatHistoryContextMenu', () => {
  const defaultProps = {
    x: 100,
    y: 200,
    pinned: false,
    onAction: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders without crashing', () => {
    const { container } = render(<ChatHistoryContextMenu {...defaultProps} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('shows "Pin to top" when session is not pinned', () => {
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} />);
    expect(getByText('Pin to top')).toBeTruthy();
  });

  it('shows "Unpin" when session is pinned', () => {
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} pinned={true} />);
    expect(getByText('Unpin')).toBeTruthy();
  });

  it('calls onAction with "rename" when Rename is clicked', () => {
    const onAction = vi.fn();
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Rename'));
    expect(onAction).toHaveBeenCalledWith('rename');
  });

  it('calls onAction with "pin" when Pin is clicked', () => {
    const onAction = vi.fn();
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Pin to top'));
    expect(onAction).toHaveBeenCalledWith('pin');
  });

  it('calls onAction with "export" when Export is clicked', () => {
    const onAction = vi.fn();
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Export as Markdown'));
    expect(onAction).toHaveBeenCalledWith('export');
  });

  it('shows delete confirmation when Delete is clicked', () => {
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} />);
    fireEvent.click(getByText('Delete'));
    expect(getByText('Delete this conversation?')).toBeTruthy();
  });

  it('calls onAction with "delete" when confirming delete', () => {
    const onAction = vi.fn();
    const { getByText, getAllByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Delete'));
    const deleteButtons = getAllByText('Delete');
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('hides confirmation and stays open when Cancel is clicked', () => {
    const onClose = vi.fn();
    const { getByText, queryByText } = render(<ChatHistoryContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.click(getByText('Delete'));
    fireEvent.click(getByText('Cancel'));
    expect(queryByText('Delete this conversation?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<ChatHistoryContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
