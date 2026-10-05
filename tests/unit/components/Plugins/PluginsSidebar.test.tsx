import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen, within } from '@testing-library/react';
import type { Plugin, PluginInventory, RegistryPlugin } from '../../../../src/types';

const empty: PluginInventory = { skills: [], commands: [], agents: [], hooks: [], mcpServers: [], lspServers: [] };

function plugin(over: Partial<Plugin>): Plugin {
  return {
    id: 'github@official', name: 'github', marketplace: 'official', description: 'GitHub integration', version: '1.0.0',
    enabled: true, scopes: ['user'], activeScope: 'user', installPath: '/p', inventory: empty, updateAvailable: false, ...over,
  };
}

function reg(over: Partial<RegistryPlugin>): RegistryPlugin {
  return { id: 'asana@official', name: 'asana', marketplace: 'official', description: 'Tasks', installed: false, ...over };
}

const mockSai = {
  pluginsList: vi.fn(),
  pluginsRegistryList: vi.fn(),
  pluginsRegistryInventory: vi.fn(),
  pluginsInstall: vi.fn(),
  pluginsUninstall: vi.fn(),
  pluginsSetEnabled: vi.fn(),
  pluginsUpdate: vi.fn(),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

import PluginsSidebar from '../../../../src/components/Plugins/PluginsSidebar';

describe('PluginsSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSai.pluginsList.mockResolvedValue([]);
    mockSai.pluginsRegistryList.mockResolvedValue([]);
    mockSai.pluginsRegistryInventory.mockResolvedValue(null);
    for (const fn of [mockSai.pluginsInstall, mockSai.pluginsUninstall, mockSai.pluginsSetEnabled, mockSai.pluginsUpdate]) {
      fn.mockResolvedValue({ success: true });
    }
  });

  it('lists installed plugins grouped by marketplace for the project', async () => {
    mockSai.pluginsList.mockResolvedValue([
      plugin({}),
      plugin({ id: 'warp@warp', name: 'warp', marketplace: 'warp', enabled: false }),
    ]);
    render(<PluginsSidebar projectPath="/proj" />);
    await screen.findByText('github');
    expect(mockSai.pluginsList).toHaveBeenCalledWith('/proj');
    expect(screen.getByText('official')).toBeTruthy();
    expect(screen.getByText('warp', { selector: '.plg-grp span' })).toBeTruthy();
    expect(screen.getByText('disabled')).toBeTruthy();
  });

  it('shows the update badge and runs an update from the detail view', async () => {
    mockSai.pluginsList.mockResolvedValue([plugin({ updateAvailable: true, latestVersion: '1.1.0' })]);
    render(<PluginsSidebar projectPath="/proj" />);
    expect(await screen.findByText('update')).toBeTruthy();
    fireEvent.click(screen.getByText('github'));
    fireEvent.click(screen.getByText(/Update to 1.1.0/));
    await waitFor(() => expect(mockSai.pluginsUpdate).toHaveBeenCalledWith('github@official', '/proj'));
    expect(await screen.findByText(/Changes apply to new chats/)).toBeTruthy();
  });

  it('toggles enabled through the CLI and reloads', async () => {
    mockSai.pluginsList.mockResolvedValue([plugin({})]);
    render(<PluginsSidebar projectPath="/proj" />);
    fireEvent.click(await screen.findByText('github'));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(mockSai.pluginsSetEnabled).toHaveBeenCalledWith('github@official', false, '/proj'));
    await waitFor(() => expect(mockSai.pluginsList).toHaveBeenCalledTimes(2));
  });

  it('asks for confirmation before uninstalling, then returns to the list', async () => {
    mockSai.pluginsList.mockResolvedValue([plugin({})]);
    render(<PluginsSidebar projectPath="/proj" />);
    fireEvent.click(await screen.findByText('github'));
    fireEvent.click(screen.getByText('Uninstall'));
    expect(mockSai.pluginsUninstall).not.toHaveBeenCalled();
    mockSai.pluginsList.mockResolvedValue([]);
    fireEvent.click(screen.getByText(/Confirm uninstall/));
    await waitFor(() => expect(mockSai.pluginsUninstall).toHaveBeenCalledWith('github@official', '/proj'));
    expect(await screen.findByText('No plugins installed')).toBeTruthy();
  });

  it('surfaces CLI errors in the detail view', async () => {
    mockSai.pluginsList.mockResolvedValue([plugin({})]);
    mockSai.pluginsSetEnabled.mockResolvedValue({ error: 'Plugin is locked' });
    render(<PluginsSidebar />);
    fireEvent.click(await screen.findByText('github'));
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Plugin is locked');
    expect(screen.queryByText(/Changes apply to new chats/)).toBeNull();
  });

  it('browses every marketplace with category filters and inline install errors', async () => {
    mockSai.pluginsRegistryList.mockResolvedValue([
      reg({ category: 'productivity' }),
      reg({ id: 'lint@official', name: 'lint', description: 'Linter', category: 'development' }),
      reg({ id: 'warp@warp', name: 'warp', marketplace: 'warp', installed: true }),
    ]);
    mockSai.pluginsInstall.mockResolvedValue({ error: 'not found' });
    render(<PluginsSidebar />);
    fireEvent.click(screen.getByRole('tab', { name: /Browse/ }));
    await screen.findByText('asana');
    expect(screen.getByText('Installed', { selector: '.plg-muted' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'development' }));
    expect(screen.queryByText('asana')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    const row = screen.getByText('asana').closest('.plg-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Install asana' }));
    await waitFor(() => expect(mockSai.pluginsInstall).toHaveBeenCalledWith('asana@official'));
    expect(await within(row).findByText('Install failed: not found')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Retry installing asana' })).toBeTruthy();
  });

  it('marks a registry plugin installed after a successful install', async () => {
    mockSai.pluginsRegistryList.mockResolvedValue([reg({})]);
    render(<PluginsSidebar />);
    fireEvent.click(screen.getByRole('tab', { name: /Browse/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install asana' }));
    expect(await screen.findByText('Installed', { selector: '.plg-muted' })).toBeTruthy();
  });

  it('filters installed plugins by search', async () => {
    mockSai.pluginsList.mockResolvedValue([plugin({}), plugin({ id: 'a@official', name: 'alpha', description: 'other' })]);
    render(<PluginsSidebar />);
    await screen.findByText('github');
    fireEvent.change(screen.getByPlaceholderText('Search installed…'), { target: { value: 'alp' } });
    expect(screen.queryByText('github')).toBeNull();
    expect(screen.getByText('alpha')).toBeTruthy();
  });
});
