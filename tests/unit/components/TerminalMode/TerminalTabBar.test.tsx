import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TerminalTabBar from '../../../../src/components/TerminalMode/TerminalTabBar';

const baseTabs = [
  { id: 'a', name: 'Tab 1' },
  { id: 'b', name: 'Tab 2' },
  { id: 'c', name: 'Tab 3' },
];

function renderBar(overrides = {}) {
  const props = {
    tabs: baseTabs,
    activeTabId: 'a',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    ...overrides,
  };
  render(<TerminalTabBar {...props} />);
  return props;
}

describe('TerminalTabBar', () => {
  it('renders all tab names', () => {
    renderBar();
    expect(screen.getByText('Tab 1')).toBeDefined();
    expect(screen.getByText('Tab 2')).toBeDefined();
    expect(screen.getByText('Tab 3')).toBeDefined();
  });

  it('calls onSelect when clicking a tab', () => {
    const props = renderBar();
    fireEvent.click(screen.getByText('Tab 2'));
    expect(props.onSelect).toHaveBeenCalledWith('b');
  });

  it('calls onCreate when clicking +', () => {
    const props = renderBar();
    fireEvent.click(screen.getByText('+'));
    expect(props.onCreate).toHaveBeenCalled();
  });

  it('calls onClose when clicking X on a tab', () => {
    const props = renderBar();
    const closeButtons = document.querySelectorAll('.tt-tab-close');
    fireEvent.click(closeButtons[1]); // close Tab 2
    expect(props.onClose).toHaveBeenCalledWith('b');
  });

  it('does not show close button when only one tab', () => {
    renderBar({ tabs: [{ id: 'a', name: 'Tab 1' }] });
    const closeButtons = document.querySelectorAll('.tt-tab-close');
    expect(closeButtons.length).toBe(0);
  });

  it('enters rename mode on double click', () => {
    renderBar();
    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = document.querySelector('.tt-rename-input') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe('Tab 1');
  });

  it('commits rename on Enter', () => {
    const props = renderBar();
    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = document.querySelector('.tt-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My Shell' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith('a', 'My Shell');
  });

  it('cancels rename on Escape', () => {
    const props = renderBar();
    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = document.querySelector('.tt-rename-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Tab 1')).toBeDefined();
  });
});
