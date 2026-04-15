import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mockSai = {
  pluginsList: vi.fn().mockResolvedValue([]),
  pluginsRegistryList: vi.fn().mockResolvedValue([]),
  pluginsInstall: vi.fn().mockResolvedValue({ success: true }),
  pluginsUninstall: vi.fn().mockResolvedValue({ success: true }),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

import PluginsSidebar from '../../../../src/components/Plugins/PluginsSidebar';

describe('PluginsSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<PluginsSidebar />);
    expect(container.querySelector('.plugins-sidebar')).toBeTruthy();
  });

  it('renders Installed and Browse tabs', () => {
    const { getByText } = render(<PluginsSidebar />);
    expect(getByText('Installed')).toBeTruthy();
    expect(getByText('Browse')).toBeTruthy();
  });

  it('renders search input', () => {
    const { container } = render(<PluginsSidebar />);
    expect(container.querySelector('.sidebar-search')).toBeTruthy();
  });

  it('shows installed plugins after loading', async () => {
    mockSai.pluginsList.mockResolvedValue([
      { name: 'github', description: 'GitHub integration', version: '1.0.0', source: 'test', enabled: true, skills: [] },
    ]);
    const { getByText } = render(<PluginsSidebar />);
    await waitFor(() => {
      expect(getByText('github')).toBeTruthy();
    });
  });

  it('switches to Browse tab on click', async () => {
    const { getByText } = render(<PluginsSidebar />);
    fireEvent.click(getByText('Browse'));
    await waitFor(() => {
      expect(mockSai.pluginsRegistryList).toHaveBeenCalled();
    });
  });
});
