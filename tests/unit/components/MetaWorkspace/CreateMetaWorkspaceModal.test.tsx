import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateMetaWorkspaceModal } from '../../../../src/components/MetaWorkspace/CreateMetaWorkspaceModal';
import { installMockSai } from '../../../helpers/ipc-mock';
import type { MetaWorkspaceRuntime } from '../../../../src/types';

function fakeRuntime(name = 'My Meta'): MetaWorkspaceRuntime {
  return {
    meta: { id: 'm1', name, projects: [], createdAt: 0, lastActivity: 0 },
    syntheticRoot: '/tmp/.sai/meta/m1',
    projects: [],
  };
}

describe('CreateMetaWorkspaceModal', () => {
  beforeEach(() => {
    installMockSai();
  });

  it('shows the empty-state hint when no projects are added', () => {
    render(
      <CreateMetaWorkspaceModal recentProjects={[]} onClose={vi.fn()} onCreated={vi.fn()} />
    );
    expect(screen.getByText(/No projects added yet/i)).toBeTruthy();
  });

  it('disables Create until both name and at least one project are present', () => {
    render(
      <CreateMetaWorkspaceModal
        recentProjects={['/abs/foo']}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );
    const createBtn = screen.getByRole('button', { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // name only — still disabled
    fireEvent.change(screen.getByPlaceholderText('My workspace'), { target: { value: 'Demo' } });
    expect(createBtn.disabled).toBe(true);

    // add a project from the recent list
    fireEvent.click(screen.getByText('/abs/foo'));
    expect(createBtn.disabled).toBe(false);
  });

  it('adds a recent project, generates a unique linkName, and removes duplicates from recent list', () => {
    render(
      <CreateMetaWorkspaceModal
        recentProjects={['/abs/foo', '/abs/bar']}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('/abs/foo'));
    // draft row created with the basename as the auto-generated link name
    const linkInput = screen.getByDisplayValue('foo') as HTMLInputElement;
    expect(linkInput).toBeTruthy();
    // /abs/foo is no longer offered in the recent list (only the bar button remains)
    const remainingRecentButtons = screen
      .getAllByRole('button')
      .filter(b => b.textContent?.startsWith('/abs/'));
    expect(remainingRecentButtons.map(b => b.textContent)).toEqual(['/abs/bar']);
  });

  it('removes a draft when its remove button is clicked', () => {
    render(
      <CreateMetaWorkspaceModal
        recentProjects={['/abs/foo']}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('/abs/foo'));
    expect(screen.getByDisplayValue('foo')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Remove'));
    expect(screen.queryByDisplayValue('foo')).toBeNull();
    expect(screen.getByText(/No projects added yet/i)).toBeTruthy();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <CreateMetaWorkspaceModal recentProjects={[]} onClose={onClose} onCreated={vi.fn()} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('invokes metaWorkspaceCreate and onCreated with the runtime on success', async () => {
    const runtime = fakeRuntime('Demo');
    const metaWorkspaceCreate = vi.fn().mockResolvedValue(runtime);
    (window as any).sai.metaWorkspaceCreate = metaWorkspaceCreate;
    const onCreated = vi.fn();

    render(
      <CreateMetaWorkspaceModal
        recentProjects={['/abs/foo']}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('My workspace'), { target: { value: 'Demo' } });
    fireEvent.click(screen.getByText('/abs/foo'));
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(metaWorkspaceCreate).toHaveBeenCalledTimes(1));
    expect(metaWorkspaceCreate).toHaveBeenCalledWith({
      name: 'Demo',
      projects: [{ path: '/abs/foo', linkName: 'foo', description: undefined }],
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(runtime));
  });

  it('surfaces the error and stays open when metaWorkspaceCreate rejects', async () => {
    const metaWorkspaceCreate = vi.fn().mockRejectedValue(new Error('boom'));
    (window as any).sai.metaWorkspaceCreate = metaWorkspaceCreate;
    const onCreated = vi.fn();

    render(
      <CreateMetaWorkspaceModal
        recentProjects={['/abs/foo']}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('My workspace'), { target: { value: 'Demo' } });
    fireEvent.click(screen.getByText('/abs/foo'));
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
  });
});
