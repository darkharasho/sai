import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchResult from '../../../src/components/SearchPanel/SearchResult';

const file = {
  path: 'src/foo.ts',
  matches: [
    { line: 12, column: 10, length: 3, preview: 'function foo(x) {', matchStart: 9, matchEnd: 12 },
    { line: 25, column: 10, length: 3, preview: '  return foo(x);', matchStart: 9, matchEnd: 12 },
  ],
};

describe('SearchResult', () => {
  it('renders file path and match count', () => {
    render(<SearchResult file={file} replacement="" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('renders one row per match with line number and preview', () => {
    render(<SearchResult file={file} replacement="" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText(/function/)).toBeInTheDocument();
    expect(screen.getByText(/return/)).toBeInTheDocument();
  });

  it('shows old → new inline when replacement is non-empty', () => {
    const { container } = render(<SearchResult file={file} replacement="bar" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(container.querySelector('.search-match-old')).toBeInTheDocument();
    expect(container.querySelector('.search-match-new')?.textContent).toBe('bar');
  });

  it('collapses and expands on header click', () => {
    render(<SearchResult file={file} replacement="" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    fireEvent.click(screen.getByText('src/foo.ts'));
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });

  it('per-match replace button calls onReplaceMatch with the index', () => {
    const onReplaceMatch = vi.fn();
    const { container } = render(<SearchResult file={file} replacement="bar" onReplaceMatch={onReplaceMatch} onReplaceFile={() => {}} />);
    const buttons = container.querySelectorAll('.search-match-replace');
    fireEvent.click(buttons[1]);
    expect(onReplaceMatch).toHaveBeenCalledWith(1);
  });

  it('per-file replace button calls onReplaceFile', () => {
    const onReplaceFile = vi.fn();
    const { container } = render(<SearchResult file={file} replacement="bar" onReplaceMatch={() => {}} onReplaceFile={onReplaceFile} />);
    fireEvent.click(container.querySelector('.search-file-replace')!);
    expect(onReplaceFile).toHaveBeenCalledOnce();
  });
});
