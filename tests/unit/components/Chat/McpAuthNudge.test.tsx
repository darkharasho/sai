import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import McpAuthNudge from '../../../../src/components/Chat/McpAuthNudge';

let pushCb: ((p: any) => void) | null = null;
const caps = { status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true };
const snap = (servers: any, auth: any = {}, over: any = {}) => ({ projectPath: '/p', scope: 's1', servers, auth, available: true, capabilities: caps, ...over });
const sai = {
  mcpRuntimeStatus: vi.fn(),
  mcpStatus: vi.fn(),
  mcpAuthenticate: vi.fn(),
  mcpAuthCancel: vi.fn().mockResolvedValue(undefined),
  onMcpRuntimeStatus: vi.fn((cb: any) => { pushCb = cb; return () => {}; }),
};
Object.defineProperty(window, 'sai', { value: sai, writable: true });

const CF = 'plugin:cloudflare:cloudflare-api';
const cfServers = (status: string) => ({ [CF]: { name: CF, status } });

describe('McpAuthNudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sai.mcpAuthenticate.mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'https://a' });
  });

  it('renders nothing when no server needs auth, and never spawns a session', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ gh: { name: 'gh', status: 'connected' } }));
    const { container } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    await waitFor(() => expect(sai.mcpRuntimeStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(sai.mcpStatus).not.toHaveBeenCalled();
  });

  it('enabled:false makes no IPC calls', async () => {
    const { container } = render(<McpAuthNudge projectPath="/p" scope="s1" enabled={false} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(sai.mcpRuntimeStatus).not.toHaveBeenCalled();
    expect(sai.onMcpRuntimeStatus).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('single server: Sign in runs auth, waiting state shows, connected hides', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap(cfServers('needs-auth')));
    const { findByText, queryByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    expect(await findByText('cloudflare-api')).toBeTruthy();
    fireEvent.click(await findByText('Sign in'));
    expect(sai.mcpAuthenticate).toHaveBeenCalledWith('/p', 's1', CF);
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: cfServers('needs-auth'), auth: { [CF]: { phase: 'waiting', authUrl: 'https://a' } } }));
    expect(await findByText(/Waiting for browser/)).toBeTruthy();
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: cfServers('connected'), auth: {} }));
    await waitFor(() => expect(queryByText('cloudflare-api')).toBeNull());
  });

  it('a connected server never shows the nudge even with a leftover auth state', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap(cfServers('connected'), { [CF]: { phase: 'error' } }));
    const { container } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    await waitFor(() => expect(sai.mcpRuntimeStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('shows an error when sign-in fails', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap(cfServers('needs-auth')));
    sai.mcpAuthenticate.mockResolvedValue({ ok: false, error: 'boom' });
    const { findByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('Sign in'));
    expect(await findByText(/boom/)).toBeTruthy();
    expect(await findByText('Retry')).toBeTruthy();
  });

  it('refuses a non-http authUrl: cancels and shows an error', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap(cfServers('needs-auth')));
    sai.mcpAuthenticate.mockResolvedValue({ ok: true, state: 'awaiting-browser', authUrl: 'file:///etc/passwd' });
    const { findByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    fireEvent.click(await findByText('Sign in'));
    expect(await findByText(/isn't a web address/)).toBeTruthy();
    expect(sai.mcpAuthCancel).toHaveBeenCalledWith('/p', 's1', CF);
  });

  it('a timed-out sign-in offers Retry', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap(cfServers('needs-auth'), { [CF]: { phase: 'timeout' } }));
    const { findByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    expect(await findByText(/didn't complete/)).toBeTruthy();
    expect(await findByText('Retry')).toBeTruthy();
  });

  it('multiple servers collapse to Review which opens the panel', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ a: { name: 'a', status: 'needs-auth' }, b: { name: 'b', status: 'needs-auth' } }));
    const onOpen = vi.fn();
    const { findByText } = render(<McpAuthNudge projectPath="/p" scope="s1" onOpenMcpPanel={onOpen} />);
    expect(await findByText('2 servers need sign-in')).toBeTruthy();
    fireEvent.click(await findByText('Review'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('dismiss hides until the set of needs-auth servers changes', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ a: { name: 'a', status: 'needs-auth' } }));
    const { findByLabelText, queryByText, findByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    fireEvent.click(await findByLabelText('Dismiss'));
    expect(queryByText('a')).toBeNull();
    act(() => pushCb?.({ projectPath: '/p', scope: 's1', servers: { a: { name: 'a', status: 'needs-auth' }, b: { name: 'b', status: 'needs-auth' } }, auth: {} }));
    expect(await findByText('2 servers need sign-in')).toBeTruthy();
  });

  it('without auth capability shows terminal hint', async () => {
    sai.mcpRuntimeStatus.mockResolvedValue(snap({ a: { name: 'a', status: 'needs-auth' } }, {}, { capabilities: { ...caps, authenticate: false } }));
    const { findByText, queryByText } = render(<McpAuthNudge projectPath="/p" scope="s1" />);
    expect(await findByText(/claude mcp/)).toBeTruthy();
    expect(queryByText('Sign in')).toBeNull();
  });
});
