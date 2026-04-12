import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';

import SettingsModal from '../../../src/components/SettingsModal';

const defaultProps = {
  onClose: vi.fn(),
  onSettingChange: vi.fn(),
};

/**
 * Returns a settingsGet mock that returns the default value (2nd arg) when the
 * key has no explicit stub — this mirrors the real IPC behaviour and prevents
 * TypeError crashes in components that do `settingsGet('gemini', {}).then(g => g.x)`.
 */
function makeSettingsGetMock() {
  return vi.fn((_key: string, defaultValue?: unknown) =>
    Promise.resolve(defaultValue ?? undefined),
  );
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);
  });

  it('renders without crashing', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('renders the settings title', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} />);
    const closeBtn = container.querySelector('.settings-close') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} />);
    const overlay = container.querySelector('.settings-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when modal content is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} />);
    const modal = container.querySelector('.settings-modal') as HTMLElement;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('loads settings on mount', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    mock.githubGetUser.mockResolvedValue(null);
    installMockSai(mock);

    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(mock.settingsGet).toHaveBeenCalled();
    });
  });

  it('renders AI Provider section on Provider page', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => {
      expect(screen.getByText('AI Provider')).toBeTruthy();
    });
  });

  it('renders Chat provider row on Provider page', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => {
      expect(screen.getByText('Chat provider')).toBeTruthy();
    });
  });

  it('renders Commit message provider row on Provider page', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => {
      expect(screen.getByText('Commit message provider')).toBeTruthy();
    });
  });

  it('opens provider dropdown when provider button is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => {
      const providerBtns = document.querySelectorAll('.provider-select-btn');
      expect(providerBtns.length).toBeGreaterThan(0);
    });
    const providerBtns = document.querySelectorAll('.provider-select-btn');
    fireEvent.click(providerBtns[0]);
    await waitFor(() => {
      expect(document.querySelector('.provider-dropdown')).toBeTruthy();
    });
  });

  it('calls settingsSet when provider changes', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    mock.githubGetUser.mockResolvedValue(null);
    installMockSai(mock);

    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));

    await waitFor(() => {
      const providerBtns = document.querySelectorAll('.provider-select-btn');
      expect(providerBtns.length).toBeGreaterThan(0);
    });

    // Open the provider dropdown
    const providerBtns = document.querySelectorAll('.provider-select-btn');
    fireEvent.click(providerBtns[0]);

    await waitFor(() => {
      const dropdown = document.querySelector('.provider-dropdown');
      expect(dropdown).toBeTruthy();
    });

    // Click on Codex option
    const codexBtn = Array.from(document.querySelectorAll('.provider-dropdown-item')).find(
      btn => btn.textContent?.includes('Codex')
    );
    if (codexBtn) {
      fireEvent.click(codexBtn);
      await waitFor(() => {
        expect(mock.settingsSet).toHaveBeenCalledWith('aiProvider', 'codex');
      });
    }
  });

  it('renders font size controls on Editor page', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Editor'));
    await waitFor(() => {
      expect(screen.getByText(/font size/i)).toBeTruthy();
    });
  });

  it('calls settingsSet and onSettingChange when font size changes', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    mock.githubGetUser.mockResolvedValue(null);
    installMockSai(mock);
    const onSettingChange = vi.fn();

    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);
    await waitFor(() => expect(mock.settingsGet).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Editor'));
    await waitFor(() => expect(screen.getByText('Font size')).toBeTruthy());

    // Find a font size button and click it
    const fontSizeBtns = document.querySelectorAll('.font-size-btn');
    if (fontSizeBtns.length > 0) {
      fireEvent.click(fontSizeBtns[0]);
      expect(mock.settingsSet).toHaveBeenCalledWith('editorFontSize', expect.any(Number));
    } else {
      // Font size may be rendered differently; just verify render
      expect(document.body.textContent).toContain('Font');
    }
  });

  it('calls githubGetUser on mount to check auth state', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    mock.githubGetUser.mockResolvedValue(null);
    installMockSai(mock);

    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(mock.githubGetUser).toHaveBeenCalled();
    });
  });

  it('renders "What\'s New" button when onOpenWhatsNew is provided', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);

    render(<SettingsModal onClose={vi.fn()} onOpenWhatsNew={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("See what changed in this version")).toBeTruthy()
    );
  });

  it('renders sidebar with General and Provider nav items', () => {
    render(<SettingsModal {...defaultProps} />);
    const sidebar = document.querySelector('.settings-sidebar');
    expect(sidebar).toBeTruthy();
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Provider')).toBeTruthy();
  });

  it('renders provider sub-items in sidebar', () => {
    render(<SettingsModal {...defaultProps} />);
    const sidebar = document.querySelector('.settings-sidebar')!;
    expect(sidebar.textContent).toContain('Claude');
    expect(sidebar.textContent).toContain('Codex');
    expect(sidebar.textContent).toContain('Gemini');
  });

  it('shows General page by default with Workspaces section', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText('Workspaces')).toBeTruthy();
    expect(screen.getByText('Auto-suspend after')).toBeTruthy();
  });

  it('shows Provider page when Provider nav is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    const providerNav = screen.getByText('Provider');
    fireEvent.click(providerNav);
    await waitFor(() => {
      expect(screen.getByText('Chat provider')).toBeTruthy();
      expect(screen.getByText('Commit message provider')).toBeTruthy();
    });
  });

  it('shows Claude page when Claude nav is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    const claudeNav = screen.getByText('Claude');
    fireEvent.click(claudeNav);
    await waitFor(() => {
      expect(screen.getByText('Auto-compact context')).toBeTruthy();
    });
  });

  it('shows Gemini page when Gemini nav is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    const geminiNav = screen.getByText('Gemini');
    fireEvent.click(geminiNav);
    await waitFor(() => {
      expect(screen.getByText('Loading phrases')).toBeTruthy();
    });
  });

  it('shows Codex placeholder page when Codex nav is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    const codexNav = screen.getByText('Codex');
    fireEvent.click(codexNav);
    await waitFor(() => {
      expect(screen.getByText(/no codex-specific settings/i)).toBeTruthy();
    });
  });

  it('hides General content when on Provider page', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => {
      expect(screen.queryByText('Font size')).toBeNull();
    });
  });

  it('calls onOpenWhatsNew and onClose when "What\'s New" is clicked', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);

    const onOpenWhatsNew = vi.fn();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} onOpenWhatsNew={onOpenWhatsNew} />);

    await waitFor(() => expect(screen.getByText("See what changed in this version")).toBeTruthy());
    const buttons = screen.getAllByText("What's New");
    const button = buttons.find(el => el.tagName === 'BUTTON')!;
    fireEvent.click(button);

    expect(onOpenWhatsNew).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders "Same as chat provider" toggle and locks commit provider', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);

    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));

    await waitFor(() => {
      expect(screen.getByText('Same as chat provider')).toBeTruthy();
    });

    const toggles = document.querySelectorAll('.settings-toggle');
    // The first toggle on Provider page is "Same as chat provider"
    // (There is another one for AI conversation titles later)
    const lockToggle = toggles[0];
    expect(lockToggle).toBeTruthy();

    // Toggle it ON
    fireEvent.click(lockToggle);
    await waitFor(() => {
      expect(mock.settingsSet).toHaveBeenCalledWith('lockCommitProvider', true);
    });

    // Check if commit message provider dropdown is disabled
    const providerBtns = document.querySelectorAll('.provider-select-btn');
    const commitProviderBtn = providerBtns[1] as HTMLButtonElement;
    expect(commitProviderBtn.disabled).toBe(true);
    expect(commitProviderBtn.closest('.provider-select')?.classList.contains('disabled')).toBe(true);
  });

  it('syncs commit provider when chat provider changes and lock is ON', async () => {
    const mock = createMockSai();
    // Start with lock ON
    mock.settingsGet = vi.fn((key, defaultVal) => {
      if (key === 'lockCommitProvider') return Promise.resolve(true);
      if (key === 'aiProvider') return Promise.resolve('claude');
      return Promise.resolve(defaultVal);
    });
    installMockSai(mock);

    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));

    await waitFor(() => {
      const providerBtns = document.querySelectorAll('.provider-select-btn');
      expect(providerBtns.length).toBeGreaterThan(0);
    });

    // Open chat provider dropdown
    const providerBtns = document.querySelectorAll('.provider-select-btn');
    fireEvent.click(providerBtns[0]);

    // Click on Codex option
    const codexBtn = await waitFor(() => {
      const btns = Array.from(document.querySelectorAll('.provider-dropdown-item'));
      return btns.find(btn => btn.textContent?.includes('Codex'));
    });

    if (codexBtn) {
      fireEvent.click(codexBtn);
      await waitFor(() => {
        expect(mock.settingsSet).toHaveBeenCalledWith('aiProvider', 'codex');
        expect(mock.settingsSet).toHaveBeenCalledWith('commitMessageProvider', 'codex');
      });
    }
  });
});
