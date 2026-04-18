import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import ConflictSection from '../../../../src/components/Git/ConflictSection';
import type { ConflictHunk } from '../../../../src/types';

const hunk: ConflictHunk = {
  index: 0,
  ours: ['const x = 1;'],
  theirs: ['const x = 2;'],
  oursLabel: 'HEAD',
  theirsLabel: 'feature/foo',
};

describe('ConflictSection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders nothing when no conflict files', () => {
    installMockSai();
    const { container } = render(
      <ConflictSection projectPath="/proj" conflictFiles={[]} onRefresh={vi.fn()} onOpenEditor={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders banner when conflict files exist', () => {
    installMockSai();
    render(
      <ConflictSection projectPath="/proj" conflictFiles={['src/index.ts']} onRefresh={vi.fn()} onOpenEditor={vi.fn()} />
    );
    expect(screen.getByText(/merge conflicts/i)).toBeTruthy();
    expect(screen.getByText('src/index.ts')).toBeTruthy();
  });

  it('expands hunk viewer when file row clicked', async () => {
    const mock = createMockSai();
    mock.gitConflictHunks.mockResolvedValue([hunk]);
    installMockSai(mock);

    render(
      <ConflictSection projectPath="/proj" conflictFiles={['src/index.ts']} onRefresh={vi.fn()} onOpenEditor={vi.fn()} />
    );
    fireEvent.click(screen.getByText('src/index.ts'));
    await waitFor(() => {
      expect(screen.getByText(/const x = 1/)).toBeTruthy();
    });
  });

  it('collapses file when all hunks resolved', async () => {
    const mock = createMockSai();
    // First call returns a hunk, second call (after resolve) returns empty
    mock.gitConflictHunks
      .mockResolvedValueOnce([hunk])
      .mockResolvedValueOnce([]);
    installMockSai(mock);

    render(
      <ConflictSection projectPath="/proj" conflictFiles={['src/index.ts']} onRefresh={vi.fn()} onOpenEditor={vi.fn()} />
    );
    // Expand the file
    fireEvent.click(screen.getByText('src/index.ts'));
    await waitFor(() => screen.getByText(/const x = 1/));

    // Click "Accept Ours" to resolve
    fireEvent.click(screen.getByRole('button', { name: /accept ours/i }));
    await waitFor(() => {
      // Hunk viewer should be gone
      expect(screen.queryByText(/const x = 1/)).toBeNull();
    });
  });

  it('calls gitResolveAllConflicts and onRefresh when Accept All Ours clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(
      <ConflictSection projectPath="/proj" conflictFiles={['src/index.ts']} onRefresh={onRefresh} onOpenEditor={vi.fn()} />
    );
    fireEvent.click(screen.getByText(/accept all ours/i));
    await waitFor(() => {
      expect(mock.gitResolveAllConflicts).toHaveBeenCalledWith('/proj', 'ours');
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});
