import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncludedProjectsControl } from '../../../../src/components/MetaWorkspace/IncludedProjectsControl';
import type { MetaWorkspaceRuntime, MetaWorkspaceRuntimeProject } from '../../../../src/types';

function makeRuntime(projects: MetaWorkspaceRuntimeProject[]): MetaWorkspaceRuntime {
  return {
    meta: {
      id: 'meta-1',
      name: 'Test Meta',
      projects: projects.map(({ status: _s, ...p }) => p),
      createdAt: 0,
      lastActivity: 0,
    },
    syntheticRoot: '/tmp/.sai/meta/meta-1',
    projects,
  };
}

const okProject = (linkName: string, path = `/abs/${linkName}`): MetaWorkspaceRuntimeProject => ({
  linkName,
  path,
  status: 'ok',
});

describe('IncludedProjectsControl', () => {
  describe('inline chips (≤3 projects)', () => {
    it('renders one chip per project with @-prefixed link name', () => {
      const runtime = makeRuntime([okProject('alpha'), okProject('beta')]);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={vi.fn()} />);
      expect(screen.getByText('@alpha')).toBeTruthy();
      expect(screen.getByText('@beta')).toBeTruthy();
    });

    it('calls onMentionInsert with the link name when a chip is clicked', () => {
      const onMentionInsert = vi.fn();
      const runtime = makeRuntime([okProject('alpha'), okProject('beta')]);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={onMentionInsert} />);
      fireEvent.click(screen.getByText('@beta'));
      expect(onMentionInsert).toHaveBeenCalledWith('beta');
    });

    it('disables chips for unavailable projects and does not invoke onMentionInsert', () => {
      const onMentionInsert = vi.fn();
      const runtime = makeRuntime([
        okProject('alpha'),
        { linkName: 'gone', path: '/abs/gone', status: 'unavailable' },
      ]);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={onMentionInsert} />);
      const chip = screen.getByText('@gone') as HTMLButtonElement;
      expect(chip.disabled).toBe(true);
      fireEvent.click(chip);
      expect(onMentionInsert).not.toHaveBeenCalled();
    });
  });

  describe('dropdown (>3 projects)', () => {
    const fourProjects = [
      okProject('alpha'),
      okProject('beta'),
      okProject('gamma'),
      okProject('delta'),
    ];

    beforeEach(() => {
      // ensure clean DOM for outside-click tests
      document.body.innerHTML = '';
    });

    it('renders a Projects (N) toggle instead of chips', () => {
      const runtime = makeRuntime(fourProjects);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={vi.fn()} />);
      expect(screen.getByTitle('Included projects').textContent).toContain('Projects (4)');
      expect(screen.queryByText('@alpha')).toBeNull();
    });

    it('opens the popover and shows all project rows on toggle click', () => {
      const runtime = makeRuntime(fourProjects);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={vi.fn()} />);
      fireEvent.click(screen.getByTitle('Included projects'));
      expect(screen.getByText('@alpha')).toBeTruthy();
      expect(screen.getByText('@delta')).toBeTruthy();
    });

    it('selecting a row calls onMentionInsert and closes the popover', () => {
      const onMentionInsert = vi.fn();
      const runtime = makeRuntime(fourProjects);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={onMentionInsert} />);
      fireEvent.click(screen.getByTitle('Included projects'));
      fireEvent.click(screen.getByText('@gamma'));
      expect(onMentionInsert).toHaveBeenCalledWith('gamma');
      expect(screen.queryByText('@alpha')).toBeNull();
    });

    it('Escape closes the popover', () => {
      const runtime = makeRuntime(fourProjects);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={vi.fn()} />);
      fireEvent.click(screen.getByTitle('Included projects'));
      expect(screen.getByText('@alpha')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('@alpha')).toBeNull();
    });

    it('marks unavailable rows with (missing) and prevents selection', () => {
      const onMentionInsert = vi.fn();
      const runtime = makeRuntime([
        ...fourProjects.slice(0, 3),
        { linkName: 'gone', path: '/abs/gone', status: 'unavailable' },
      ]);
      render(<IncludedProjectsControl runtime={runtime} onMentionInsert={onMentionInsert} />);
      fireEvent.click(screen.getByTitle('Included projects'));
      expect(screen.getByText('(missing)')).toBeTruthy();
      const goneRow = screen.getByText('@gone').closest('button') as HTMLButtonElement;
      expect(goneRow.disabled).toBe(true);
      fireEvent.click(goneRow);
      expect(onMentionInsert).not.toHaveBeenCalled();
    });
  });
});
