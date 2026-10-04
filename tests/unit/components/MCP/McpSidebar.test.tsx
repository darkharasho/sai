import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mockSai = {
  mcpList: vi.fn().mockResolvedValue([]),
  mcpRegistryList: vi.fn().mockResolvedValue([]),
  mcpAdd: vi.fn().mockResolvedValue({ success: true }),
  mcpRemove: vi.fn().mockResolvedValue({ success: true }),
  mcpUpdate: vi.fn().mockResolvedValue({ success: true }),
  mcpGetTools: vi.fn().mockResolvedValue([]),
  mcpStatus: vi.fn(),
  mcpRuntimeStatus: vi.fn(),
  mcpAuthenticate: vi.fn().mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'https://a' }),
  mcpReconnect: vi.fn().mockResolvedValue({ ok: true }),
  onMcpRuntimeStatus: vi.fn(() => () => {}),
  codexMcpRuntimeStatus: vi.fn().mockResolvedValue({ available: true, servers: [] }),
  codexMcpConfigGet: vi.fn().mockResolvedValue({ ok: true, snapshot: { version: 'v1', impact: 'global-user-config', servers: [] } }),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

const liveSnap = (servers: Record<string, any> = {}, over: any = {}) => ({
  projectPath: '/p', scope: 's1', servers, auth: {}, available: true,
  capabilities: { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true },
  ...over,
});

import McpSidebar from '../../../../src/components/MCP/McpSidebar';

describe('McpSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSai.mcpList.mockResolvedValue([]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap());
    mockSai.mcpAuthenticate.mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'https://a' });
    mockSai.mcpReconnect.mockResolvedValue({ ok: true });
    mockSai.onMcpRuntimeStatus.mockImplementation(() => () => {});
    mockSai.mcpRegistryList.mockResolvedValue([]);
    mockSai.codexMcpRuntimeStatus.mockResolvedValue({ available: true, servers: [] });
    mockSai.codexMcpConfigGet.mockResolvedValue({ ok: true, snapshot: { version: 'v1', impact: 'global-user-config', servers: [] } });
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
    expect(mockSai.mcpRegistryList).not.toHaveBeenCalled();
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
    expect(mockSai.mcpRegistryList).not.toHaveBeenCalled();
    expect(mockSai.codexMcpConfigGet).not.toHaveBeenCalled();
  });

  it('offers the isolated global Codex editor only when App Server MCP runtime is available', async () => {
    const { getByText } = render(<McpSidebar provider="codex" projectPath="/repo" scope="chat-1" />);
    await waitFor(() => expect(getByText('Global MCP configuration')).toBeTruthy());
    await waitFor(() => expect(mockSai.codexMcpConfigGet).toHaveBeenCalledTimes(1));
  });

  it('does not load Claude MCP data when a persisted browse tab becomes Codex', async () => {
    const { getByText, rerender } = render(
      <McpSidebar provider="claude" projectPath="/repo" scope="chat-1" />,
    );

    fireEvent.click(getByText('Browse'));
    await waitFor(() => expect(mockSai.mcpRegistryList).toHaveBeenCalledTimes(1));
    vi.clearAllMocks();

    rerender(<McpSidebar provider="codex" projectPath="/repo" scope="chat-1" />);

    await waitFor(() => expect(mockSai.codexMcpRuntimeStatus).toHaveBeenCalledWith('/repo', 'chat-1'));
    expect(mockSai.mcpList).not.toHaveBeenCalled();
    expect(mockSai.mcpRegistryList).not.toHaveBeenCalled();
  });

  it('keeps the Claude installed and browse management flow unchanged', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'claude-server', transport: 'stdio', enabled: true }]);
    const { getByText } = render(<McpSidebar provider="claude" projectPath="/repo" scope="chat-1" />);

    await waitFor(() => expect(getByText('claude-server')).toBeTruthy());
    expect(getByText('Browse')).toBeTruthy();
    expect(getByText('Add')).toBeTruthy();
    expect(mockSai.codexMcpRuntimeStatus).not.toHaveBeenCalled();
  });

  it('shows Needs attention with Sign in and badge count, and groups the rest', async () => {
    mockSai.mcpList.mockResolvedValue([
      { name: 'gh', transport: 'streamable-http', enabled: true, source: 'user' },
      { name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' },
    ]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({
      gh: { name: 'gh', status: 'connected', tools: [{ name: 't' }] },
      cf: { name: 'cf', status: 'needs-auth' },
    }));
    const { findByText, getByText, container } = render(<McpSidebar projectPath="/p" scope="s1" />);
    expect(await findByText('Needs attention')).toBeTruthy();
    expect(getByText('Global')).toBeTruthy();
    expect(container.querySelector('.sidebar-tab .tab-badge')?.textContent).toBe('1');
    fireEvent.click(getByText('Sign in'));
    await waitFor(() => expect(mockSai.mcpAuthenticate).toHaveBeenCalledWith('/p', 's1', 'cf'));
  });

  it('passes projectPath to mcpList', async () => {
    render(<McpSidebar projectPath="/p" scope="s1" />);
    await waitFor(() => expect(mockSai.mcpList).toHaveBeenCalledWith('/p'));
  });

  it('shows live-unavailable note when no session', async () => {
    mockSai.mcpStatus.mockResolvedValue(liveSnap({}, { available: false }));
    const { findByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    expect(await findByText(/Live status unavailable/)).toBeTruthy();
  });

  it('disables Retry when live status is unavailable', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'x', transport: 'stdio', enabled: true, source: 'user' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ x: { name: 'x', status: 'failed', error: 'boom' } }, { available: false }));
    const { findByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    expect(((await findByText('Retry')) as HTMLButtonElement).disabled).toBe(true);
  });

  it('without auth capability shows a terminal hint instead of Sign in', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'cf', transport: 'sse', enabled: true, source: 'user' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ cf: { name: 'cf', status: 'needs-auth' } }, {
      capabilities: { status: true, reconnect: true, toggle: true, authenticate: false, clearAuth: false, submitCallbackUrl: false },
    }));
    const { findByTitle, queryByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    expect(await findByTitle('Manage this server from a terminal with `claude mcp`.')).toBeTruthy();
    expect(queryByText('Sign in')).toBeNull();
  });
});
