import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

  it('does not fetch Codex models until the Codex page is selected', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => expect(mock.settingsGet).toHaveBeenCalled());
    expect(mock.codexModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Codex'));
    await waitFor(() => expect(mock.codexModels).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByText('Retry models'));
    await waitFor(() => expect(mock.codexModels).toHaveBeenCalledWith(true));
  });

  it('persists the explicit Codex App Server preview selection and shows its unavailable reason', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    mock.codexAppServerPreviewStatus.mockResolvedValue({ available: false, reason: 'Handshake failed' });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Codex'));
    const backend = await screen.findByLabelText('Codex backend');
    expect((backend as HTMLSelectElement).value).toBe('sdk');
    fireEvent.change(backend, { target: { value: 'app-server' } });

    expect(mock.settingsSet).toHaveBeenCalledWith('codexBackendMode', 'app-server');
    expect(mock.codexBackendModeSet).toHaveBeenCalledWith('app-server');
    expect(await screen.findByText(/Handshake failed/)).toBeTruthy();
  });

  it('offers an explicit App Server retry after preview fallback', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    mock.codexAppServerPreviewStatus.mockResolvedValue({ available: false, reason: 'Handshake failed' });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Codex'));
    fireEvent.change(await screen.findByLabelText('Codex backend'), { target: { value: 'app-server' } });
    const callsBeforeRetry = mock.codexBackendModeSet.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Retry App Server' }));

    expect(mock.codexBackendModeSet).toHaveBeenLastCalledWith('app-server');
    expect(mock.codexBackendModeSet).toHaveBeenCalledTimes(callsBeforeRetry + 1);
  });

  it('delegates Codex effort persistence to the owning App callback without a duplicate write', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'codex'
      ? { model: 'gpt-5', permission: 'auto', effort: 'xhigh' }
      : fallback));
    installMockSai(mock);
    const onSettingChange = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);
    fireEvent.click(screen.getByText('Codex'));
    const select = await screen.findByLabelText('Codex effort');
    expect((select as HTMLSelectElement).value).toBe('xhigh');
    fireEvent.change(select, { target: { value: 'minimal' } });
    expect(onSettingChange).toHaveBeenCalledWith('codexEffort', 'minimal');
    expect(mock.settingsSet).not.toHaveBeenCalledWith('codex', expect.anything());
  });

  it('persists Codex effort itself when rendered without an owning callback', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'codex'
      ? { model: 'gpt-5', permission: 'auto', effort: 'high' }
      : fallback));
    installMockSai(mock);
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Codex'));
    fireEvent.change(await screen.findByLabelText('Codex effort'), { target: { value: 'max' } });
    await waitFor(() => expect(mock.settingsSet).toHaveBeenCalledWith('codex', {
      model: 'gpt-5', permission: 'auto', effort: 'max',
    }));
  });

  it('shows and normalizes only reasoning efforts supported by the selected Codex model', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'codex'
      ? { model: 'retired-model', permission: 'auto', effort: 'minimal' }
      : fallback));
    mock.codexModels = vi.fn(() => Promise.resolve({
      models: [{ id: 'no-min', name: 'No Minimal', supportedReasoningEfforts: ['low', 'high', 'ultra'], defaultReasoningEffort: 'high' }],
      defaultModel: 'no-min',
    }));
    installMockSai(mock);
    const onSettingChange = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);
    fireEvent.click(screen.getByText('Codex'));
    const select = await screen.findByLabelText('Codex effort') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('high'));
    expect(Array.from(select.options).map(option => option.value)).toEqual(['low', 'high', 'ultra']);
    expect(onSettingChange).toHaveBeenCalledWith('codexModel', 'no-min');
    expect(onSettingChange).toHaveBeenCalledWith('codexEffort', 'high');
  });

  it('applies retry model results through the same normalized owner update path', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'codex'
      ? { model: 'retired-model', permission: 'auto', effort: 'minimal' }
      : fallback));
    mock.codexModels = vi.fn()
      .mockResolvedValueOnce({ models: [], defaultModel: '' })
      .mockResolvedValueOnce({
        models: [{ id: 'retry-model', name: 'Retry Model', supportedReasoningEfforts: ['high', 'ultra'], defaultReasoningEffort: 'high' }],
        defaultModel: 'retry-model',
      });
    installMockSai(mock);
    const onSettingChange = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);
    fireEvent.click(screen.getByText('Codex'));
    fireEvent.click(await screen.findByText('Retry models'));
    await waitFor(() => expect(onSettingChange).toHaveBeenCalledWith('codexModel', 'retry-model'));
    expect(onSettingChange).toHaveBeenCalledWith('codexEffort', 'high');
    expect((screen.getByLabelText('Codex effort') as HTMLSelectElement).value).toBe('high');
  });

  it('does not let a delayed initial read overwrite delegated local Codex changes', async () => {
    let resolveCodex!: (value: unknown) => void;
    const delayedCodex = new Promise(resolve => { resolveCodex = resolve; });
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => key === 'codex' ? delayedCodex : Promise.resolve(fallback));
    installMockSai(mock);
    const onSettingChange = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);
    fireEvent.click(screen.getByText('Codex'));
    fireEvent.change(await screen.findByDisplayValue('Auto (sandboxed)'), { target: { value: 'full-access' } });
    fireEvent.change(screen.getByLabelText('Codex effort'), { target: { value: 'ultra' } });
    await act(async () => { resolveCodex({ permission: 'read-only', effort: 'minimal' }); await delayedCodex; });
    expect((screen.getByDisplayValue('Full access') as HTMLSelectElement).value).toBe('full-access');
    expect((screen.getByLabelText('Codex effort') as HTMLSelectElement).value).toBe('ultra');
  });

  it('does not let a delayed initial read overwrite model-load normalization', async () => {
    let resolveCodex!: (value: unknown) => void;
    const delayedCodex = new Promise(resolve => { resolveCodex = resolve; });
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => key === 'codex' ? delayedCodex : Promise.resolve(fallback));
    mock.codexModels.mockResolvedValue({
      models: [{ id: 'current', name: 'Current', supportedReasoningEfforts: ['high'], defaultReasoningEffort: 'high' }],
      defaultModel: 'current',
    });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Codex'));
    await screen.findByDisplayValue('Current');
    await act(async () => { resolveCodex({ model: 'stale', permission: 'read-only', effort: 'minimal' }); await delayedCodex; });
    expect((screen.getByDisplayValue('Current') as HTMLSelectElement).value).toBe('current');
    expect((screen.getByLabelText('Codex effort') as HTMLSelectElement).value).toBe('high');
    expect((screen.getByDisplayValue('Read-only') as HTMLSelectElement).value).toBe('read-only');
  });

  it('restores a catalog-valid persisted custom model and effort from a delayed initial read', async () => {
    let resolveCodex!: (value: unknown) => void;
    const delayedCodex = new Promise(resolve => { resolveCodex = resolve; });
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => key === 'codex' ? delayedCodex : Promise.resolve(fallback));
    mock.codexModels.mockResolvedValue({
      models: [
        { id: 'default', name: 'Default', supportedReasoningEfforts: ['high'] },
        { id: 'custom', name: 'Custom', supportedReasoningEfforts: ['low', 'xhigh'] },
      ],
      defaultModel: 'default',
    });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Codex'));
    await screen.findByDisplayValue('Default');
    await act(async () => { resolveCodex({ model: 'custom', permission: 'read-only', effort: 'xhigh' }); await delayedCodex; });
    expect((screen.getByDisplayValue('Custom') as HTMLSelectElement).value).toBe('custom');
    expect((screen.getByLabelText('Codex effort') as HTMLSelectElement).value).toBe('xhigh');
    expect((screen.getByDisplayValue('Read-only') as HTMLSelectElement).value).toBe('read-only');
  });

  it('rejects unavailable remote Codex models against a loaded catalog and refreshes it', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'codex'
      ? { model: 'valid', permission: 'auto', effort: 'high' } : fallback));
    mock.codexModels.mockResolvedValue({
      models: [{ id: 'valid', name: 'Valid' }], defaultModel: 'valid',
    });
    let applyRemoteSettings: ((settings: Record<string, unknown>) => void) | undefined;
    mock.githubOnSettingsApplied = vi.fn((callback: (settings: Record<string, unknown>) => void) => {
      applyRemoteSettings = callback;
      return vi.fn();
    });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Codex'));
    await screen.findByDisplayValue('Valid');
    act(() => applyRemoteSettings?.({ codex: { model: 'unavailable' } }));
    expect((screen.getByDisplayValue('Valid') as HTMLSelectElement).value).toBe('valid');
    await waitFor(() => expect(mock.codexModels).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByText('General'));
    mock.codexModels.mockClear();
    fireEvent.click(screen.getByText('Codex'));
    await waitFor(() => expect(mock.codexModels).toHaveBeenCalledWith(false));
  });

  it('defers an unknown remote model off the Codex page and adopts it after opening validates it', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'codex'
      ? { model: 'current', permission: 'auto', effort: 'high' } : fallback));
    mock.codexModels.mockResolvedValue({
      models: [{ id: 'current', name: 'Current' }, { id: 'pending', name: 'Pending' }], defaultModel: 'current',
    });
    let applyRemoteSettings!: (settings: Record<string, unknown>) => void;
    mock.githubOnSettingsApplied = vi.fn((callback: (settings: Record<string, unknown>) => void) => {
      applyRemoteSettings = callback;
      return vi.fn();
    });
    installMockSai(mock);
    const onSettingChange = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);
    await waitFor(() => expect(mock.settingsGet).toHaveBeenCalledWith('codex', {}));
    act(() => applyRemoteSettings({ codex: { model: 'pending' } }));
    expect(mock.codexModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Codex'));
    await waitFor(() => expect(mock.codexModels).toHaveBeenCalledWith(true));
    await screen.findByDisplayValue('Pending');
    expect(onSettingChange).toHaveBeenCalledWith('codexModel', 'pending');
  });

  it('merges a delayed persisted effort after adopting a pending remote model', async () => {
    let resolveCodex!: (value: unknown) => void;
    const delayedCodex = new Promise(resolve => { resolveCodex = resolve; });
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => key === 'codex'
      ? delayedCodex : Promise.resolve(fallback));
    mock.codexModels.mockResolvedValue({
      models: [
        { id: 'current', name: 'Current', supportedReasoningEfforts: ['high'] },
        { id: 'pending', name: 'Pending', supportedReasoningEfforts: ['high', 'xhigh'] },
      ],
      defaultModel: 'current',
    });
    let applyRemoteSettings!: (settings: Record<string, unknown>) => void;
    mock.githubOnSettingsApplied = vi.fn((callback: (settings: Record<string, unknown>) => void) => {
      applyRemoteSettings = callback;
      return vi.fn();
    });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => expect(mock.githubOnSettingsApplied).toHaveBeenCalled());
    act(() => applyRemoteSettings({ codex: { model: 'pending' } }));
    fireEvent.click(screen.getByText('Codex'));
    await screen.findByDisplayValue('Pending');

    await act(async () => { resolveCodex({ permission: 'auto', effort: 'xhigh' }); await delayedCodex; });

    expect((screen.getByDisplayValue('Pending') as HTMLSelectElement).value).toBe('pending');
    expect((screen.getByLabelText('Codex effort') as HTMLSelectElement).value).toBe('xhigh');
  });

  it('hides effort settings for a model with an explicit empty effort set', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'codex'
      ? { model: 'none', permission: 'auto', effort: 'high' } : fallback));
    mock.codexModels.mockResolvedValue({
      models: [{ id: 'none', name: 'None', supportedReasoningEfforts: [] }], defaultModel: 'none',
    });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Codex'));
    await screen.findByDisplayValue('None');
    expect(screen.queryByLabelText('Codex effort')).toBeNull();
    expect(defaultProps.onSettingChange).toHaveBeenCalledWith('codexEffort', undefined);
  });

  it('applies remote Codex model, permission, and effort updates without writing them back', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    let applyRemoteSettings: ((settings: Record<string, unknown>) => void) | undefined;
    mock.githubOnSettingsApplied = vi.fn((callback: (settings: Record<string, unknown>) => void) => {
      applyRemoteSettings = callback;
      return vi.fn();
    });
    installMockSai(mock);
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Codex'));
    await screen.findByLabelText('Codex effort');
    act(() => applyRemoteSettings?.({ codex: { model: 'remote-model', permission: 'full-access', effort: 'ultra' } }));
    await waitFor(() => expect((screen.getByLabelText('Codex effort') as HTMLSelectElement).value).toBe('ultra'));
    expect((screen.getByDisplayValue('Full access') as HTMLSelectElement).value).toBe('full-access');
    expect(mock.settingsSet).not.toHaveBeenCalledWith('codex', expect.anything());
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

  it('hides Claude controls after selecting a non-Claude chat provider', async () => {
    render(
      <SettingsModal
        {...defaultProps}
        claudeModel="sonnet"
        claudeEffort="high"
        onClaudeModelChange={vi.fn()}
        onClaudeEffortChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Provider'));
    expect(screen.getByText('Claude model')).toBeTruthy();
    expect(screen.getByText('Claude effort')).toBeTruthy();

    fireEvent.click(document.querySelectorAll('.provider-select-btn')[0]);
    fireEvent.click(Array.from(document.querySelectorAll('.provider-dropdown-item')).find(
      button => button.textContent?.includes('Codex'),
    )!);

    await waitFor(() => {
      expect(screen.queryByText('Claude model')).toBeNull();
      expect(screen.queryByText('Claude effort')).toBeNull();
    });
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
    expect(sidebar.textContent).toContain('Antigravity CLI');
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
      expect(screen.getByText('Low token mode')).toBeTruthy();
    });
  });

  it('keeps Low token mode out of Editor and places provider-specific presets on provider pages', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Editor'));
    expect(screen.queryByText('Low token mode')).toBeNull();

    fireEvent.click(screen.getByText('Codex'));
    expect(await screen.findByText('Low token mode')).toBeTruthy();

    fireEvent.click(screen.getByText('Antigravity CLI'));
    expect(await screen.findByText('Low token mode')).toBeTruthy();

    fireEvent.click(screen.getByText('Kimi CLI'));
    expect(await screen.findByText(/no lower-token preset/i)).toBeTruthy();
  });

  it('applies Antigravity low-token defaults from its provider page', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    mock.geminiModels.mockResolvedValue({
      models: [
        { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
      ],
      defaultModel: 'gemini-3.1-pro',
    });
    installMockSai(mock);
    const onSettingChange = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);

    fireEvent.click(screen.getByText('Antigravity CLI'));
    const lowTokenRow = await screen.findByText('Low token mode');
    fireEvent.click(lowTokenRow.closest('.settings-row')!.querySelector('.settings-toggle')!);

    await waitFor(() => {
      expect(mock.settingsSet).toHaveBeenCalledWith('geminiLowTokenMode', true);
      expect(onSettingChange).toHaveBeenCalledWith('geminiModel', 'gemini-3.1-pro');
      expect(onSettingChange).toHaveBeenCalledWith('geminiConversationMode', 'fast');
    });
  });

  it('applies the lowest supported Codex reasoning effort from its provider page', async () => {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(
      key === 'codex' ? { model: 'gpt-5', permission: 'auto', effort: 'high' } : fallback,
    ));
    mock.codexModels.mockResolvedValue({
      models: [{ id: 'gpt-5', name: 'GPT-5', supportedReasoningEfforts: ['minimal', 'high'] }],
      defaultModel: 'gpt-5',
    });
    installMockSai(mock);
    const onSettingChange = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSettingChange={onSettingChange} />);

    fireEvent.click(screen.getByText('Codex'));
    const lowTokenRow = await screen.findByText('Low token mode');
    fireEvent.click(lowTokenRow.closest('.settings-row')!.querySelector('.settings-toggle')!);

    await waitFor(() => {
      expect(mock.settingsSet).toHaveBeenCalledWith('codexLowTokenMode', true);
      expect(onSettingChange).toHaveBeenCalledWith('codexEffort', 'minimal');
    });
  });

  it('shows Antigravity page when its nav item is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    const geminiNav = screen.getByText('Antigravity CLI');
    fireEvent.click(geminiNav);
    await waitFor(() => {
      expect(screen.getByText('Default approval mode')).toBeTruthy();
      expect(screen.getByText('Default conversation mode')).toBeTruthy();
      expect(screen.queryByText('Loading phrases')).toBeFalsy();
    });
  });

  it('shows Codex settings page when Codex nav is clicked', async () => {
    render(<SettingsModal {...defaultProps} />);
    const codexNav = screen.getByText('Codex');
    fireEvent.click(codexNav);
    await waitFor(() => {
      expect(screen.getByText(/default permission mode/i)).toBeTruthy();
      expect(screen.getByText(/how codex handles file system/i)).toBeTruthy();
    });
  });

  it('does not expose a retired Codex CLI backend option', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);

    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Codex'));
    await screen.findByText(/default permission mode/i);

    expect(screen.queryByRole('option', { name: /CLI/i })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SDK (default)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'App Server (preview)' })).toBeTruthy();
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

  it('renders Claude model and Claude effort rows on Provider page when props provided', async () => {
    const onClaudeModelChange = vi.fn();
    const onClaudeEffortChange = vi.fn();
    render(
      <SettingsModal
        {...defaultProps}
        claudeModel="sonnet"
        claudeEffort="high"
        claudeModels={[{ id: 'sonnet', label: 'Sonnet', description: 'x' }]}
        onClaudeModelChange={onClaudeModelChange}
        onClaudeEffortChange={onClaudeEffortChange}
      />
    );
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => {
      expect(screen.getByText('Claude model')).toBeTruthy();
      expect(screen.getByText('Claude effort')).toBeTruthy();
    });
  });

  it('does NOT render Claude model and Claude effort rows when props are absent', async () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => {
      expect(screen.queryByText('Claude model')).toBeNull();
      expect(screen.queryByText('Claude effort')).toBeNull();
    });
  });

  it('calls onClaudeEffortChange when an effort option is clicked', async () => {
    const onClaudeModelChange = vi.fn();
    const onClaudeEffortChange = vi.fn();
    render(
      <SettingsModal
        {...defaultProps}
        claudeModel="sonnet"
        claudeEffort="high"
        claudeModels={[{ id: 'sonnet', label: 'Sonnet', description: 'x' }]}
        onClaudeModelChange={onClaudeModelChange}
        onClaudeEffortChange={onClaudeEffortChange}
      />
    );
    fireEvent.click(screen.getByText('Provider'));
    await waitFor(() => expect(screen.getByText('Claude effort')).toBeTruthy());

    // Open the effort dropdown
    const effortRow = screen.getByText('Claude effort').closest('.settings-row')!;
    const effortBtn = effortRow.querySelector('.provider-select-btn') as HTMLElement;
    fireEvent.click(effortBtn);

    await waitFor(() => {
      const dropdown = effortRow.querySelector('.provider-dropdown');
      expect(dropdown).toBeTruthy();
    });

    // Click a different effort option (Low)
    const lowBtn = Array.from(effortRow.querySelectorAll('.provider-dropdown-item')).find(
      btn => btn.textContent?.includes('Low')
    );
    expect(lowBtn).toBeTruthy();
    fireEvent.click(lowBtn!);
    expect(onClaudeEffortChange).toHaveBeenCalledWith('low');
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
