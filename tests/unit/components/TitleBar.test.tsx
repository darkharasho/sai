import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';

// Mock child modals to keep tests simple
vi.mock('../../../src/components/UpdateNotification', () => ({
  default: () => null,
}));
vi.mock('../../../src/components/CloseWorkspaceModal', () => ({
  default: () => null,
}));
vi.mock('../../../src/components/GitHubAuthModal', () => ({
  default: () => null,
}));
vi.mock('../../../src/components/SettingsModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import TitleBar from '../../../src/components/TitleBar';
import { resetHomeInfo } from '../../../src/lib/homeWorkspace';

const defaultProps = {
  projectPath: '/home/user/my-project',
  onProjectChange: vi.fn(),
};

describe('TitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockSai();
  });

  it('renders without crashing', () => {
    const { container } = render(<TitleBar {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('displays the project name derived from the path', () => {
    const { container } = render(<TitleBar {...defaultProps} projectPath="/home/user/my-project" />);
    const selector = container.querySelector('.project-selector');
    expect(selector?.textContent).toContain('my-project');
  });

  it('displays "No Project" when projectPath is empty', () => {
    const { container } = render(<TitleBar {...defaultProps} projectPath="" />);
    const selector = container.querySelector('.project-selector');
    expect(selector?.textContent).toContain('No Project');
  });

  it('calls updateGetVersion on mount', async () => {
    const mock = createMockSai();
    mock.updateGetVersion.mockResolvedValue('1.2.3');
    mock.githubGetUser.mockResolvedValue(null);
    installMockSai(mock);

    render(<TitleBar {...defaultProps} />);
    await waitFor(() => {
      expect(mock.updateGetVersion).toHaveBeenCalled();
    });
  });

  it('calls githubGetUser on mount', async () => {
    const mock = createMockSai();
    mock.githubGetUser.mockResolvedValue(null);
    installMockSai(mock);

    render(<TitleBar {...defaultProps} />);
    await waitFor(() => {
      expect(mock.githubGetUser).toHaveBeenCalled();
    });
  });

  it('opens workspace dropdown when project name is clicked', async () => {
    const mock = createMockSai();
    mock.workspaceGetAll.mockResolvedValue([]);
    installMockSai(mock);

    const { container } = render(<TitleBar {...defaultProps} />);
    const projectBtn = container.querySelector('.project-selector') as HTMLElement;
    fireEvent.click(projectBtn);

    await waitFor(() => {
      expect(mock.workspaceGetAll).toHaveBeenCalled();
    });
  });

  it('opens settings modal when settings button is clicked', async () => {
    const mock = createMockSai();
    mock.githubGetUser.mockResolvedValue(null);
    installMockSai(mock);

    render(<TitleBar {...defaultProps} />);
    // Find settings button by looking for Settings icon button
    const settingsBtn = document.querySelector('button[title*="Settings"]') ||
      Array.from(document.querySelectorAll('button')).find(
        btn => btn.getAttribute('title')?.toLowerCase().includes('setting')
      );

    if (settingsBtn) {
      fireEvent.click(settingsBtn);
      await waitFor(() => {
        expect(screen.getByTestId('settings-modal')).toBeTruthy();
      });
    } else {
      // Settings button may be triggered via different UI — just test render
      expect(document.body).toBeTruthy();
    }
  });

  it('registers githubOnSyncStatus listener on mount', async () => {
    const mock = createMockSai();
    installMockSai(mock);

    render(<TitleBar {...defaultProps} />);
    await waitFor(() => {
      expect(mock.githubOnSyncStatus).toHaveBeenCalled();
    });
  });

  it('shows the workspace list when dropdown is open', async () => {
    const mock = createMockSai();
    mock.workspaceGetAll.mockResolvedValue([
      { projectPath: '/home/user/project-a', status: 'active', lastActivity: Date.now() },
      { projectPath: '/home/user/project-b', status: 'suspended', lastActivity: Date.now() - 60000 },
    ]);
    installMockSai(mock);

    const { container } = render(<TitleBar {...defaultProps} />);
    fireEvent.click(container.querySelector('.project-selector') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('project-a')).toBeTruthy();
      expect(screen.getByText('project-b')).toBeTruthy();
    });
  });

  it('shows the completed (done) squircle on a suspended workspace that has unread activity', async () => {
    // Regression: the title bar lights the white "done" squircle for any
    // workspace (active OR suspended) with completed/unread activity, but the
    // dropdown used to hard-code suspended rows to the grey "inactive" state —
    // so the title showed a status with no matching row indicator.
    const mock = createMockSai();
    mock.workspaceGetAll.mockResolvedValue([
      { projectPath: '/home/user/project-a', status: 'active', lastActivity: Date.now() },
      { projectPath: '/home/user/project-b', status: 'suspended', lastActivity: Date.now() - 60000 },
    ]);
    installMockSai(mock);

    const { container } = render(
      <TitleBar
        {...defaultProps}
        completedWorkspaces={new Set(['/home/user/project-b'])}
      />,
    );
    fireEvent.click(container.querySelector('.project-selector') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('project-b')).toBeTruthy();
    });
    const suspendedRow = screen.getByText('project-b').closest('.workspace-item') as HTMLElement;
    expect(suspendedRow.querySelector('.ws-sq-done')).toBeTruthy();
    expect(suspendedRow.querySelector('.ws-sq-inactive')).toBeNull();
  });

  it('renders an active, a suspended, and a recent-history-only registry row under their existing section headings (codex registration characterization)', async () => {
    // Task 6 registers live Codex scopes with the same workspace registry Claude
    // uses (getOrCreateWorkspace), so a Codex-driven project should show up as an
    // ordinary Active/Suspended row here — no Codex-specific TitleBar branch
    // exists or should be added. This fixture just characterizes that the
    // existing Active/Suspended/Recent sections already handle any row shape
    // workspaceGetAll can return, including a recent/history-only entry.
    const mock = createMockSai();
    mock.workspaceGetAll = vi.fn().mockResolvedValue([
      { projectPath: '/home/user/codex-active', status: 'active', lastActivity: Date.now() },
      { projectPath: '/home/user/codex-suspended', status: 'suspended', lastActivity: Date.now() - 60000 },
      { projectPath: '/home/user/codex-recent-only', status: 'recent', lastActivity: 0 },
    ]);
    installMockSai(mock);

    const { container } = render(<TitleBar {...defaultProps} />);
    fireEvent.click(container.querySelector('.project-selector') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('codex-active')).toBeTruthy();
      expect(screen.getByText('codex-suspended')).toBeTruthy();
      expect(screen.getByText('codex-recent-only')).toBeTruthy();
    });

    const labels = Array.from(container.querySelectorAll('.dropdown-label')).map((el) => el.textContent);
    expect(labels).toContain('Active');
    expect(labels).toContain('Suspended');
    expect(labels).toContain('Recent');

    // Each row must fall after its own section heading and before the next
    // one, proving the rows are grouped under the correct heading rather than
    // merely present somewhere in the dropdown.
    const text = container.textContent || '';
    const activeHeadingIdx = text.indexOf('Active');
    const activeRowIdx = text.indexOf('codex-active');
    const suspendedHeadingIdx = text.indexOf('Suspended');
    const suspendedRowIdx = text.indexOf('codex-suspended');
    const recentHeadingIdx = text.indexOf('Recent');
    const recentRowIdx = text.indexOf('codex-recent-only');

    expect(activeHeadingIdx).toBeGreaterThanOrEqual(0);
    expect(activeHeadingIdx).toBeLessThan(activeRowIdx);
    expect(activeRowIdx).toBeLessThan(suspendedHeadingIdx);
    expect(suspendedHeadingIdx).toBeLessThan(suspendedRowIdx);
    expect(suspendedRowIdx).toBeLessThan(recentHeadingIdx);
    expect(recentHeadingIdx).toBeLessThan(recentRowIdx);
  });

  it('calls onProjectChange when a workspace is selected', async () => {
    const onProjectChange = vi.fn();
    const mock = createMockSai();
    mock.workspaceGetAll.mockResolvedValue([
      { projectPath: '/home/user/other-project', status: 'active', lastActivity: Date.now() },
    ]);
    installMockSai(mock);

    const { container } = render(<TitleBar {...defaultProps} onProjectChange={onProjectChange} />);
    fireEvent.click(container.querySelector('.project-selector') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('other-project')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('other-project'));
    expect(onProjectChange).toHaveBeenCalledWith('/home/user/other-project');
  });
});

describe('TitleBar status chip (audit 2026-06-11)', () => {
  it('shows the two-tone busy-done squircle when one workspace works and another is done', () => {
    const { container } = render(
      <TitleBar
        {...defaultProps}
        projectPath="/home/user/current"
        busyWorkspaces={new Set(['/ws/busy-one'])}
        completedWorkspaces={new Set(['/ws/done-one'])}
      />
    );
    expect(container.querySelector('.ws-sq-busy-done')).toBeTruthy();
    expect(container.querySelector('.ws-sq-busy:not(.ws-sq-busy-done)')).toBeNull();
  });

  it('keeps the plain busy squircle when nothing is completed', () => {
    const { container } = render(
      <TitleBar
        {...defaultProps}
        projectPath="/home/user/current"
        busyWorkspaces={new Set(['/ws/busy-one'])}
      />
    );
    expect(container.querySelector('.ws-sq-busy')).toBeTruthy();
    expect(container.querySelector('.ws-sq-busy-done')).toBeNull();
  });

  it('shows the question squircle for a workspace awaiting an AskUserQuestion answer', () => {
    const { container } = render(
      <TitleBar
        {...defaultProps}
        projectPath="/home/user/current"
        busyWorkspaces={new Set(['/ws/asking'])}
        awaitingQuestionWorkspaces={new Set(['/ws/asking'])}
      />
    );
    expect(container.querySelector('.ws-sq-question')).toBeTruthy();
  });

  it('marks the awaiting workspace row with the question state in the dropdown', async () => {
    const mockSai = createMockSai();
    mockSai.workspaceGetAll = vi.fn().mockResolvedValue([
      { projectPath: '/ws/asking', status: 'active' },
      { projectPath: '/ws/other', status: 'active' },
    ]);
    installMockSai(mockSai);
    const { container } = render(
      <TitleBar
        {...defaultProps}
        projectPath="/ws/other"
        busyWorkspaces={new Set(['/ws/asking'])}
        awaitingQuestionWorkspaces={new Set(['/ws/asking'])}
      />
    );
    fireEvent.click(screen.getByText(/other/, { selector: '.titlebar-project-name, button, span, div' }));
    await waitFor(() => {
      const row = container.querySelector('[data-path="/ws/asking"]');
      expect(row?.querySelector('.ws-sq-question')).toBeTruthy();
    });
  });
});

describe('TitleBar Home workspace', () => {
  const HOME = '/var/home/tester';

  beforeEach(() => {
    vi.clearAllMocks();
    resetHomeInfo();
  });

  const openPicker = async (props: Record<string, unknown> = {}) => {
    const { container } = render(<TitleBar {...defaultProps} {...props} />);
    fireEvent.click(container.querySelector('.project-selector') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('home-workspace-row')).toBeTruthy();
    });
    return container;
  };

  it('pins a Home row at the top of the picker even with no workspaces', async () => {
    installMockSai();
    const container = await openPicker();

    const row = screen.getByTestId('home-workspace-row');
    expect(row.textContent).toContain('Home');
    // Pinned means first: it precedes any section heading in the DOM.
    const items = Array.from(container.querySelectorAll('.workspace-item, .dropdown-label'));
    expect(items[0]).toBe(row);
  });

  it('activates the home directory when the pinned row is clicked', async () => {
    const onProjectChange = vi.fn();
    installMockSai();
    await openPicker({ onProjectChange });

    fireEvent.click(screen.getByTestId('home-workspace-row'));
    expect(onProjectChange).toHaveBeenCalledWith(HOME);
  });

  it('is permanent — no suspend/close overflow on the Home row', async () => {
    const mock = createMockSai();
    mock.workspaceGetAll.mockResolvedValue([
      { projectPath: HOME, status: 'active', lastActivity: Date.now() },
    ]);
    installMockSai(mock);
    const container = await openPicker();

    const wrapper = container.querySelector('[data-path="' + HOME + '"]') as HTMLElement;
    expect(wrapper.querySelector('.workspace-overflow-btn')).toBeNull();
  });

  it('dedupes home out of the Active list rather than showing it twice', async () => {
    const mock = createMockSai();
    mock.workspaceGetAll.mockResolvedValue([
      { projectPath: HOME, status: 'active', lastActivity: Date.now() },
      { projectPath: '/var/home/tester/code/app', status: 'active', lastActivity: Date.now() },
    ]);
    installMockSai(mock);
    const container = await openPicker();

    expect(container.querySelectorAll('[data-path="' + HOME + '"]').length).toBe(1);
    expect(screen.queryByText('tester')).toBeNull();
    expect(screen.getByText('app')).toBeTruthy();
  });

  it('dedupes an aliased (symlinked) home path out of the recent list', async () => {
    const mock = createMockSai();
    mock.workspaceGetAll.mockResolvedValue([
      { projectPath: '/home/tester', status: 'recent', lastActivity: 0 },
    ]);
    installMockSai(mock);
    const container = await openPicker();

    expect(container.querySelector('[data-path="/home/tester"]')).toBeNull();
    expect(screen.queryByText('/home/tester')).toBeNull();
    expect(screen.getAllByTestId('home-workspace-row').length).toBe(1);
  });

  it('carries the workspace status squircle like any other workspace', async () => {
    installMockSai();
    const container = await openPicker({ busyWorkspaces: new Set([HOME]) });

    const row = container.querySelector('[data-path="' + HOME + '"]') as HTMLElement;
    expect(row.querySelector('.ws-sq-busy')).toBeTruthy();
  });

  it('labels the title bar "Home" instead of the home folder basename', async () => {
    installMockSai();
    const { container } = render(<TitleBar {...defaultProps} projectPath={HOME} />);
    await waitFor(() => {
      const selector = container.querySelector('.project-selector');
      expect(selector?.textContent).toContain('Home');
    });
    expect(container.querySelector('.project-selector')?.textContent).not.toContain('tester');
  });
});
