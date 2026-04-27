import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchPanel from '../../../src/components/SearchPanel/SearchPanel';

beforeEach(() => {
  (window as any).sai = {
    searchRun: vi.fn().mockResolvedValue({ files: [], truncated: false, durationMs: 0 }),
    searchReplaceFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('SearchPanel', () => {
  it('renders the search input with placeholder', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('renders three toggle buttons (case, word, regex)', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.getByTitle(/case sensitive/i)).toBeInTheDocument();
    expect(screen.getByTitle(/whole word/i)).toBeInTheDocument();
    expect(screen.getByTitle(/regex/i)).toBeInTheDocument();
  });

  it('replace input is hidden by default and toggled by the chevron', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.queryByPlaceholderText(/replace/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/toggle replace/i));
    expect(screen.getByPlaceholderText(/replace/i)).toBeInTheDocument();
  });

  it('Replace All button only shows when replace is expanded', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.queryByText(/replace all/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/toggle replace/i));
    expect(screen.getByText(/replace all/i)).toBeInTheDocument();
  });

  it('Replace All button is muted when replace input is empty', () => {
    const { container } = render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    fireEvent.click(screen.getByTitle(/toggle replace/i));
    const btn = container.querySelector('.search-replace-all');
    expect(btn?.classList.contains('muted')).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/replace/i), { target: { value: 'bar' } });
    expect(btn?.classList.contains('muted')).toBe(false);
  });

  it('toggles include/exclude details on click', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.queryByPlaceholderText(/files to include/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/toggle search details/i));
    expect(screen.getByPlaceholderText(/files to include/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/files to exclude/i)).toBeInTheDocument();
  });

  it('shows empty-state hint when no query', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });
});
