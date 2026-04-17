import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConflictHunkViewer from '../../../../src/components/Git/ConflictHunkViewer';
import type { ConflictHunk } from '../../../../src/types';

const hunk: ConflictHunk = {
  index: 0,
  ours: ['const x = doOurThing();'],
  theirs: ['const x = doTheirThing();'],
  oursLabel: 'HEAD',
  theirsLabel: 'feature/foo',
};

const hunks: ConflictHunk[] = [
  hunk,
  { index: 1, ours: ['const y = 1;'], theirs: ['const y = 2;'], oursLabel: 'HEAD', theirsLabel: 'feature/foo' },
];

describe('ConflictHunkViewer', () => {
  it('renders ours and theirs content', () => {
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={vi.fn()} onOpenEditor={vi.fn()} />);
    expect(screen.getByText(/doOurThing/)).toBeTruthy();
    expect(screen.getByText(/doTheirThing/)).toBeTruthy();
  });

  it('shows hunk navigation label', () => {
    render(<ConflictHunkViewer hunks={hunks} currentIndex={0} onNavigate={vi.fn()} onResolve={vi.fn()} onOpenEditor={vi.fn()} />);
    expect(screen.getByText(/hunk 1 of 2/i)).toBeTruthy();
  });

  it('calls onResolve with "ours" when Ours button clicked', () => {
    const onResolve = vi.fn();
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={onResolve} onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByText(/ours/i));
    expect(onResolve).toHaveBeenCalledWith(0, 'ours');
  });

  it('calls onResolve with "theirs" when Theirs button clicked', () => {
    const onResolve = vi.fn();
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={onResolve} onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByText(/theirs/i));
    expect(onResolve).toHaveBeenCalledWith(0, 'theirs');
  });

  it('calls onOpenEditor when Editor button clicked', () => {
    const onOpenEditor = vi.fn();
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={vi.fn()} onOpenEditor={onOpenEditor} />);
    fireEvent.click(screen.getByText(/editor/i));
    expect(onOpenEditor).toHaveBeenCalled();
  });

  it('calls onNavigate(1) when next clicked', () => {
    const onNavigate = vi.fn();
    render(<ConflictHunkViewer hunks={hunks} currentIndex={0} onNavigate={onNavigate} onResolve={vi.fn()} onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByText(/next/i));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });
});
