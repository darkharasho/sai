import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mockSai = {
  mcpList: vi.fn().mockResolvedValue([]),
  mcpRegistryList: vi.fn().mockResolvedValue([]),
  mcpAdd: vi.fn().mockResolvedValue({ success: true }),
  mcpRemove: vi.fn().mockResolvedValue({ success: true }),
  mcpUpdate: vi.fn().mockResolvedValue({ success: true }),
  mcpGetTools: vi.fn().mockResolvedValue([]),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

import McpSidebar from '../../../../src/components/MCP/McpSidebar';

describe('McpSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<McpSidebar />);
    expect(container.querySelector('.mcp-sidebar')).toBeTruthy();
  });

  it('renders Installed and Browse tabs', () => {
    const { getByText } = render(<McpSidebar />);
    expect(getByText('Installed')).toBeTruthy();
    expect(getByText('Browse')).toBeTruthy();
  });

  it('renders search input and Add button', () => {
    const { container, getByText } = render(<McpSidebar />);
    expect(container.querySelector('.sidebar-search')).toBeTruthy();
    expect(getByText('Add')).toBeTruthy();
  });

  it('shows installed servers after loading', async () => {
    mockSai.mcpList.mockResolvedValue([
      { name: 'brave-search', transport: 'stdio', command: 'npx', enabled: true },
    ]);
    const { getByText } = render(<McpSidebar />);
    await waitFor(() => {
      expect(getByText('brave-search')).toBeTruthy();
    });
  });

  it('shows add server form when Add button is clicked', () => {
    const { getByText } = render(<McpSidebar />);
    fireEvent.click(getByText('Add'));
    expect(getByText('Add MCP Server')).toBeTruthy();
  });
});
