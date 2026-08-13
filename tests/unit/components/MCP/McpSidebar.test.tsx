import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mockSai = {
  mcpList: vi.fn().mockResolvedValue([]),
  mcpRegistryList: vi.fn().mockResolvedValue([]),
  mcpAdd: vi.fn().mockResolvedValue({ success: true }),
  mcpRemove: vi.fn().mockResolvedValue({ success: true }),
  mcpUpdate: vi.fn().mockResolvedValue({ success: true }),
  mcpGetTools: vi.fn().mockResolvedValue([]),
  codexMcpRuntimeStatus: vi.fn().mockResolvedValue({ available: true, servers: [] }),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

import McpSidebar from '../../../../src/components/MCP/McpSidebar';

describe('McpSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSai.mcpList.mockResolvedValue([]);
    mockSai.mcpRegistryList.mockResolvedValue([]);
    mockSai.codexMcpRuntimeStatus.mockResolvedValue({ available: true, servers: [] });
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

  it('shows only provider-labelled read-only runtime status for a Codex workspace', async () => {
    mockSai.codexMcpRuntimeStatus.mockResolvedValue({
      available: true,
      servers: [{ name: 'linear', lifecycle: 'running', authentication: 'authenticated', toolCount: 4 }],
    });

    const { container, getByText, queryByText } = render(
      <McpSidebar provider="codex" projectPath="/repo" scope="chat-1" />,
    );

    await waitFor(() => expect(getByText('Codex App Server MCP')).toBeTruthy());
    expect(getByText('linear')).toBeTruthy();
    expect(container.textContent).toContain('4 tools');
    expect(queryByText('Browse')).toBeNull();
    expect(queryByText('Add')).toBeNull();
    expect(mockSai.codexMcpRuntimeStatus).toHaveBeenCalledWith('/repo', 'chat-1');
    expect(mockSai.mcpList).not.toHaveBeenCalled();
  });

  it('renders a concise unavailable explanation for Codex without stale Claude servers', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'claude-only', transport: 'stdio', enabled: true }]);
    mockSai.codexMcpRuntimeStatus.mockResolvedValue({
      available: false,
      reason: 'Codex MCP runtime status is unavailable on the SDK backend.',
      servers: [],
    });

    const { getByText, queryByText } = render(
      <McpSidebar provider="codex" projectPath="/repo" scope="chat-1" />,
    );

    await waitFor(() => expect(getByText('Codex MCP runtime status is unavailable on the SDK backend.')).toBeTruthy());
    expect(queryByText('claude-only')).toBeNull();
    expect(mockSai.mcpList).not.toHaveBeenCalled();
  });

  it('keeps the Claude installed and browse management flow unchanged', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'claude-server', transport: 'stdio', enabled: true }]);
    const { getByText } = render(<McpSidebar provider="claude" projectPath="/repo" scope="chat-1" />);

    await waitFor(() => expect(getByText('claude-server')).toBeTruthy());
    expect(getByText('Browse')).toBeTruthy();
    expect(getByText('Add')).toBeTruthy();
    expect(mockSai.codexMcpRuntimeStatus).not.toHaveBeenCalled();
  });
});
