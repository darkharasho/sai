import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mockSai = {
  mcpList: vi.fn().mockResolvedValue([]),
  mcpRegistryList: vi.fn().mockResolvedValue([]),
  mcpAdd: vi.fn().mockResolvedValue({ success: true }),
  mcpRemove: vi.fn().mockResolvedValue({ success: true }),
  mcpStatus: vi.fn(),
  mcpRuntimeStatus: vi.fn(),
  mcpAuthenticate: vi.fn().mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'https://a' }),
  mcpReconnect: vi.fn().mockResolvedValue({ ok: true }),
  mcpAuthCancel: vi.fn().mockResolvedValue(undefined),
  mcpSubmitCallbackUrl: vi.fn().mockResolvedValue({ ok: true }),
  mcpSignOut: vi.fn().mockResolvedValue({ ok: true }),
  openExternal: vi.fn(),
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
    mockSai.mcpAuthCancel.mockResolvedValue(undefined);
    mockSai.mcpSubmitCallbackUrl.mockResolvedValue({ ok: true });
    mockSai.mcpSignOut.mockResolvedValue({ ok: true });
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

  it('pressing Enter on Sign in does not open the detail view', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'cf', transport: 'sse', enabled: true, source: 'user' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ cf: { name: 'cf', status: 'needs-auth' } }));
    const { findByLabelText, container } = render(<McpSidebar projectPath="/p" scope="s1" />);
    const btn = await findByLabelText('Sign in to cf');
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(container.querySelector('.mcp-detail')).toBeNull();
    expect(container.querySelector('.mcp-sidebar')).toBeTruthy();
  });

  it('shows the error when sign-in rejects', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'cf', transport: 'sse', enabled: true, source: 'user' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ cf: { name: 'cf', status: 'needs-auth' } }));
    mockSai.mcpAuthenticate.mockRejectedValue(new Error('ipc down'));
    const { findByLabelText, findByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByLabelText('Sign in to cf'));
    expect(await findByText('ipc down')).toBeTruthy();
  });

  it('detail: cancel, submit callback and sign out pass controlName with projectPath and scope', async () => {
    // Plugin config names map to a different live name, so controlName !== name.
    mockSai.mcpList.mockResolvedValue([{ name: 'plugin:pw:browser', transport: 'sse', enabled: true, source: 'plugin' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ browser: { name: 'browser', status: 'needs-auth' } }, { auth: { browser: { phase: 'waiting', authUrl: 'https://a/x' } } }));
    const { findByText, getByText, getByPlaceholderText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('browser'));
    fireEvent.click(getByText('Cancel'));
    expect(mockSai.mcpAuthCancel).toHaveBeenCalledWith('/p', 's1', 'browser');
    fireEvent.click(getByText('Paste redirect URL'));
    fireEvent.change(getByPlaceholderText('http://localhost:…/callback?code=…'), { target: { value: 'http://localhost:1/cb?code=1' } });
    fireEvent.click(getByText('Submit'));
    await waitFor(() => expect(mockSai.mcpSubmitCallbackUrl).toHaveBeenCalledWith('/p', 's1', 'browser', 'http://localhost:1/cb?code=1'));
  });

  it('detail: sign out passes controlName', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'plugin:pw:browser', transport: 'sse', enabled: true, source: 'plugin' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ browser: { name: 'browser', status: 'connected' } }));
    const { findByText, getByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('browser'));
    fireEvent.click(getByText('Sign out'));
    await waitFor(() => expect(mockSai.mcpSignOut).toHaveBeenCalledWith('/p', 's1', 'browser'));
  });

  it('sign-in returning a non-http authUrl cancels, shows the error and opens nothing', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'plugin:pw:browser', transport: 'sse', enabled: true, source: 'plugin' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ browser: { name: 'browser', status: 'needs-auth' } }));
    mockSai.mcpAuthenticate.mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'javascript:alert(1)' });
    const { findByLabelText, findByText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByLabelText('Sign in to browser'));
    expect(await findByText(/isn't a web address/)).toBeTruthy();
    expect(mockSai.mcpAuthenticate).toHaveBeenCalledWith('/p', 's1', 'browser');
    expect(mockSai.mcpAuthCancel).toHaveBeenCalledWith('/p', 's1', 'browser');
    expect(mockSai.openExternal).not.toHaveBeenCalled();
  });

  it('an action error in a non-list view does not remount it (typed input survives)', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'cf', transport: 'sse', enabled: true, source: 'user' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ cf: { name: 'cf', status: 'needs-auth' } }, { auth: { cf: { phase: 'waiting', authUrl: 'https://a/x' } } }));
    mockSai.mcpReconnect.mockRejectedValue(new Error('reconnect down'));
    const { findByText, getByText, getByPlaceholderText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('cf'));
    fireEvent.click(getByText('Paste redirect URL'));
    const input = getByPlaceholderText('http://localhost:…/callback?code=…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'http://localhost:1/cb?code=1' } });
    fireEvent.click(getByText('Reconnect'));
    expect(await findByText('reconnect down')).toBeTruthy();
    expect((getByPlaceholderText('http://localhost:…/callback?code=…') as HTMLInputElement).value).toBe('http://localhost:1/cb?code=1');
  });

  it('add form saves with the panel project and scope, then returns to the list', async () => {
    const { findByText, getByText, getByPlaceholderText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('Add'));
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'srv' } });
    fireEvent.change(getByPlaceholderText('npx'), { target: { value: 'run' } });
    fireEvent.click(getByText('Add Server'));
    await waitFor(() => expect(mockSai.mcpAdd).toHaveBeenCalledWith(
      { name: 'srv', transport: 'stdio', command: 'run', source: 'user' }, '/p', 's1'));
    expect(await findByText('Installed')).toBeTruthy();
  });

  it('a save {error} is surfaced and the form keeps its input', async () => {
    mockSai.mcpAdd.mockResolvedValueOnce({ error: 'config unreadable' });
    const { findByText, getByText, getByPlaceholderText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('Add'));
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'srv' } });
    fireEvent.change(getByPlaceholderText('npx'), { target: { value: 'run' } });
    fireEvent.click(getByText('Add Server'));
    expect(await findByText('config unreadable')).toBeTruthy();
    expect((getByPlaceholderText('my-server') as HTMLInputElement).value).toBe('srv');
  });

  it('a rejected save is surfaced and the form stays open', async () => {
    mockSai.mcpAdd.mockRejectedValueOnce(new Error('ipc down'));
    const { findByText, getByText, getByPlaceholderText } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('Add'));
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'srv' } });
    fireEvent.change(getByPlaceholderText('npx'), { target: { value: 'run' } });
    fireEvent.click(getByText('Add Server'));
    expect(await findByText('ipc down')).toBeTruthy();
    expect(getByText('Add MCP Server')).toBeTruthy();
  });

  it('edit saves in place and returns to the detail view', async () => {
    mockSai.mcpList.mockResolvedValue([{ name: 'gh', transport: 'sse', url: 'https://gh/sse', enabled: true, source: 'user' }]);
    mockSai.mcpStatus.mockResolvedValue(liveSnap({ gh: { name: 'gh', status: 'connected' } }));
    const { findByText, getByText, getByDisplayValue } = render(<McpSidebar projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('gh'));
    fireEvent.click(getByText('Edit'));
    expect((getByDisplayValue('gh') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(getByDisplayValue('https://gh/sse'), { target: { value: 'https://gh/new' } });
    fireEvent.click(getByText('Save'));
    await waitFor(() => expect(mockSai.mcpAdd).toHaveBeenCalledWith(
      { name: 'gh', transport: 'sse', url: 'https://gh/new', source: 'user' }, '/p', 's1'));
    expect(await findByText('Servers')).toBeTruthy();
  });
});
