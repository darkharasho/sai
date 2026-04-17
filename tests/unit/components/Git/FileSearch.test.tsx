import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileSearch from '../../../../src/components/Git/FileSearch';

describe('FileSearch', () => {
  it('renders a search input', () => {
    render(<FileSearch value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/filter/i)).toBeTruthy();
  });

  it('calls onChange when typing', () => {
    const onChange = vi.fn();
    render(<FileSearch value="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: 'App' } });
    expect(onChange).toHaveBeenCalledWith('App');
  });

  it('calls onChange with empty string when Escape pressed', () => {
    const onChange = vi.fn();
    render(<FileSearch value="App" onChange={onChange} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/filter/i), { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows match count when matchCount prop is provided', () => {
    render(<FileSearch value="App" onChange={vi.fn()} matchCount={3} />);
    expect(screen.getByText(/3 match/i)).toBeTruthy();
  });

  it('shows singular "1 match" (not "1 matches") for matchCount=1', () => {
    render(<FileSearch value="App" onChange={vi.fn()} matchCount={1} />);
    expect(screen.getByText('1 match')).toBeTruthy();
    // ensure it doesn't say "1 matches"
    expect(screen.queryByText('1 matches')).toBeNull();
  });
});
