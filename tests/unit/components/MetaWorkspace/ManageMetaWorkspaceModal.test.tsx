import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManageMetaWorkspaceModal } from '../../../../src/components/MetaWorkspace/ManageMetaWorkspaceModal';
import { installMockSai } from '../../../helpers/ipc-mock';
import type { MetaWorkspace, MetaWorkspaceRuntime } from '../../../../src/types';

const baseMeta: MetaWorkspace = {
  id: 'meta-1',
  name: 'My Meta',
  projects: [
    { path: '/abs/foo', linkName: 'foo', description: 'first' },
    { path: '/abs/bar', linkName: 'bar' },
  ],
  createdAt: 0,
  lastActivity: 0,
};

function fakeRuntime(): MetaWorkspaceRuntime {
  return {
    meta: baseMeta,
    syntheticRoot: '/tmp/.sai/meta/meta-1',
    projects: baseMeta.projects.map(p => ({ ...p, status: 'ok' as const })),
  };
}

describe('ManageMetaWorkspaceModal', () => {
  beforeEach(() => {
    installMockSai();
  });

  it('seeds the form with the existing meta name and projects', () => {
    render(
      <ManageMetaWorkspaceModal
        meta={baseMeta}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    expect(screen.getByDisplayValue('My Meta')).toBeTruthy();
    expect(screen.getByDisplayValue('foo')).toBeTruthy();
    expect(screen.getByDisplayValue('bar')).toBeTruthy();
    expect(screen.getByDisplayValue('first')).toBeTruthy();
  });

  it('disables Save when name is blank or no projects remain', () => {
    render(
      <ManageMetaWorkspaceModal
        meta={baseMeta}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    const save = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement;
    const nameInput = screen.getByDisplayValue('My Meta') as HTMLInputElement;
    expect(save.disabled).toBe(false);

    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    expect(save.disabled).toBe(false);

    // remove both projects
    fireEvent.click(screen.getAllByTitle('Remove project')[0]);
    fireEvent.click(screen.getAllByTitle('Remove project')[0]);
    expect((screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls metaWorkspaceUpdate, onUpdated, and onClose on save', async () => {
    const runtime = fakeRuntime();
    const metaWorkspaceUpdate = vi.fn().mockResolvedValue(runtime);
    (window as any).sai.metaWorkspaceUpdate = metaWorkspaceUpdate;
    const onUpdated = vi.fn();
    const onClose = vi.fn();

    render(
      <ManageMetaWorkspaceModal
        meta={baseMeta}
        onClose={onClose}
        onUpdated={onUpdated}
        onDeleted={vi.fn()}
      />
    );
    fireEvent.change(screen.getByDisplayValue('My Meta'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(metaWorkspaceUpdate).toHaveBeenCalledTimes(1));
    expect(metaWorkspaceUpdate).toHaveBeenCalledWith('meta-1', {
      name: 'Renamed',
      projects: [
        { path: '/abs/foo', linkName: 'foo', description: 'first' },
        { path: '/abs/bar', linkName: 'bar', description: undefined },
      ],
    });
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(runtime));
    expect(onClose).toHaveBeenCalled();
  });

  it('reveals two-step delete confirmation and invokes metaWorkspaceDelete + onDeleted', async () => {
    const metaWorkspaceDelete = vi.fn().mockResolvedValue(undefined);
    (window as any).sai.metaWorkspaceDelete = metaWorkspaceDelete;
    const onDeleted = vi.fn();

    render(
      <ManageMetaWorkspaceModal
        meta={baseMeta}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={onDeleted}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /delete meta workspace/i }));
    expect(screen.getByText(/Real project folders are not touched/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));

    await waitFor(() => expect(metaWorkspaceDelete).toHaveBeenCalledWith('meta-1'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('meta-1'));
  });

  it('cancel during delete confirmation returns to the regular delete button', () => {
    render(
      <ManageMetaWorkspaceModal
        meta={baseMeta}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /delete meta workspace/i }));
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeTruthy();
    // 2 Cancels exist now: inline confirm Cancel (DOM-first) and footer Cancel — click the inline one
    const cancelButtons = screen.getAllByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelButtons[0]);
    expect(screen.queryByRole('button', { name: /confirm delete/i })).toBeNull();
    expect(screen.getByRole('button', { name: /delete meta workspace/i })).toBeTruthy();
  });

  it('shows error message when update rejects', async () => {
    (window as any).sai.metaWorkspaceUpdate = vi.fn().mockRejectedValue(new Error('nope'));
    render(
      <ManageMetaWorkspaceModal
        meta={baseMeta}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
  });
});
