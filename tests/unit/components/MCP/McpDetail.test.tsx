import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import McpDetail from '../../../../src/components/MCP/McpDetail';
import { buildMcpRows, needsAttention } from '../../../../src/components/MCP/mcpView';

Object.defineProperty(window, 'sai', { value: { clipboardWrite: vi.fn(), openExternal: vi.fn() }, writable: true });

const caps = { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true };
const handlers = () => ({
  onBack: vi.fn(), onReconnect: vi.fn(), onToggle: vi.fn(), onSignIn: vi.fn(), onCancelAuth: vi.fn(),
  onSubmitCallbackUrl: vi.fn(), onSignOut: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(),
});
const rowOf = (server: any, live?: any, auth?: any) =>
  buildMcpRows([server], live ? { [server.name]: live } : {}, auth ? { [server.name]: auth } : {})[0];

describe('McpDetail', () => {
  let h: ReturnType<typeof handlers>;
  beforeEach(() => { h = handlers(); vi.clearAllMocks(); });

  it('connected: pill shows serverInfo, tools listed, all actions for user http server', () => {
    const row = rowOf(
      { name: 'gh', transport: 'streamable-http', url: 'https://gh', headers: { Authorization: 'secret-token' }, enabled: true, source: 'user' },
      { name: 'gh', status: 'connected', serverInfo: { name: 'GitHub MCP', version: '0.9' }, tools: [{ name: 'search_code', description: 'Search' }] },
    );
    const { getByText, queryByText, container } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Connected · GitHub MCP v0.9')).toBeTruthy();
    expect(getByText('search_code')).toBeTruthy();
    for (const label of ['Reconnect', 'Disable', 'Sign out', 'Edit', 'Remove']) expect(getByText(label)).toBeTruthy();
    expect(container.textContent).not.toContain('secret-token');
    fireEvent.click(getByText('Edit'));
    expect(h.onEdit).toHaveBeenCalledWith(row);
    expect(queryByText('Sign in')).toBeNull();
  });

  it('plugin stdio server: no Edit/Remove/Sign out, shows terminal hint', () => {
    const row = rowOf({ name: 'plugin:pw:browser', transport: 'stdio', command: 'npx', enabled: true, source: 'plugin' }, { name: 'plugin:pw:browser', status: 'connected' });
    const { queryByText, getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(queryByText('Edit')).toBeNull();
    expect(queryByText('Remove')).toBeNull();
    expect(queryByText('Sign out')).toBeNull();
    expect(getByText('Manage this server from a terminal with `claude mcp`.')).toBeTruthy();
  });

  it('needs-auth shows Sign in button in header actions', () => {
    const row = rowOf({ name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Needs sign-in')).toBeTruthy();
    fireEvent.click(getByText('Sign in'));
    expect(h.onSignIn).toHaveBeenCalledWith(row);
  });

  it('waiting: auth card with Open again / Copy link / Cancel and callback paste', () => {
    const row = rowOf({ name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'waiting', authUrl: 'https://auth/x' });
    const { getByText, getByPlaceholderText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Finish signing in in your browser')).toBeTruthy();
    expect(getByText('https://auth/x')).toBeTruthy();
    fireEvent.click(getByText('Copy link'));
    expect((window as any).sai.clipboardWrite).toHaveBeenCalledWith('https://auth/x');
    fireEvent.click(getByText('Cancel'));
    expect(h.onCancelAuth).toHaveBeenCalledWith(row);
    fireEvent.click(getByText('Paste redirect URL'));
    fireEvent.change(getByPlaceholderText('http://localhost:…/callback?code=…'), { target: { value: 'http://localhost:1/cb?code=1' } });
    fireEvent.click(getByText('Submit'));
    expect(h.onSubmitCallbackUrl).toHaveBeenCalledWith(row, 'http://localhost:1/cb?code=1');
  });

  it('auth status text is a polite live region', () => {
    const row = rowOf({ name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'waiting', authUrl: 'https://auth/x' });
    const { container } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(container.querySelector('.mcp-auth [aria-live="polite"]')?.textContent).toContain('Finish signing in in your browser');
  });

  it('non-http authUrl: error state, URL not shown, no copy link', () => {
    const row = rowOf({ name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'waiting', authUrl: 'javascript:alert(1)' });
    const { getByText, queryByText, container } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Sign-in failed')).toBeTruthy();
    expect(container.textContent).not.toContain('javascript:');
    expect(queryByText('Copy link')).toBeNull();
    expect(container.querySelector('.mcp-auth.bad')).toBeTruthy();
  });

  it('timeout: shows retry message', () => {
    const row = rowOf({ name: 'cf', transport: 'sse', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'timeout', authUrl: 'https://a' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText("Sign-in didn't complete")).toBeTruthy();
  });

  it('failed: pill shows the error', () => {
    const row = rowOf({ name: 'db', transport: 'stdio', command: 'x', enabled: true, source: 'user' }, { name: 'db', status: 'failed', error: 'spawn ENOENT' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Failed — spawn ENOENT')).toBeTruthy();
  });

  it('unavailable: Sign in, Retry and Reconnect disabled, Edit still enabled', () => {
    const row = rowOf({ name: 'gh', transport: 'stdio', command: 'x', enabled: true, source: 'user' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available={false} busy={false} error={null} {...h} />);
    expect((getByText('Reconnect').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((getByText('Edit').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('unavailable: Sign in and auth-card Retry are disabled', () => {
    const a = rowOf({ name: 'cf', transport: 'streamable-http', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' });
    const r1 = render(<McpDetail row={a} capabilities={caps} available={false} busy={false} error={null} {...h} />);
    expect((r1.getByText('Sign in') as HTMLButtonElement).disabled).toBe(true);
    r1.unmount();
    const b = rowOf({ name: 'cf', transport: 'sse', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'timeout', authUrl: 'https://a' });
    const r2 = render(<McpDetail row={b} capabilities={caps} available={false} busy={false} error={null} {...h} />);
    expect((r2.getByText('Retry') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the error prop', () => {
    const row = rowOf({ name: 'gh', transport: 'stdio', command: 'x', enabled: true, source: 'user' });
    const { getByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error="boom" {...h} />);
    expect(getByText('boom')).toBeTruthy();
  });

  it('connected beats a stale timeout auth: no card, Connected pill, no attention', () => {
    const row = rowOf({ name: 'cf', transport: 'sse', enabled: true, source: 'user' }, { name: 'cf', status: 'connected' }, { phase: 'timeout', authUrl: 'https://a' });
    const { getByText, queryByText, container } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(getByText('Connected')).toBeTruthy();
    expect(queryByText("Sign-in didn't complete")).toBeNull();
    expect(container.querySelector('.mcp-auth')).toBeNull();
    expect(row.fix).toBeUndefined();
    expect(needsAttention(row)).toBe(false);
  });

  it('bad-link waiting: pill does not claim to wait for the browser', () => {
    const row = rowOf({ name: 'cf', transport: 'sse', enabled: true, source: 'user' }, { name: 'cf', status: 'needs-auth' }, { phase: 'waiting', authUrl: 'file:///x' });
    const { queryByText } = render(<McpDetail row={row} capabilities={caps} available busy={false} error={null} {...h} />);
    expect(queryByText('Waiting for browser sign-in…')).toBeNull();
  });
});
