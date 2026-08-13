import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSai = {
  codexMcpConfigGet: vi.fn(),
  codexMcpConfigReplace: vi.fn(),
};

Object.defineProperty(window, 'sai', { value: mockSai, writable: true });

import CodexMcpConfigPanel from '../../../../src/components/MCP/CodexMcpConfigPanel';

const snapshot = {
  version: 'version-1', impact: 'global-user-config' as const,
  servers: [{ name: 'filesystem', transport: 'stdio' as const, command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }],
};

describe('CodexMcpConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSai.codexMcpConfigGet.mockResolvedValue({ ok: true, snapshot });
    mockSai.codexMcpConfigReplace.mockResolvedValue({ ok: true, snapshot });
  });

  it('keeps MCP configuration unavailable outside App Server without reading or editing', () => {
    render(<CodexMcpConfigPanel available={false} reason="App Server preview fell back to SDK." />);
    expect(screen.getByText('App Server preview fell back to SDK.')).toBeTruthy();
    expect(screen.queryByText('Add server')).toBeNull();
    expect(mockSai.codexMcpConfigGet).not.toHaveBeenCalled();
  });

  it('stages an added server and requires an explicit redacted-diff confirmation before writing', async () => {
    render(<CodexMcpConfigPanel available />);
    await screen.findByText('filesystem');
    fireEvent.click(screen.getByText('Add server'));
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'docs' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.click(screen.getByText('Stage server'));
    expect(mockSai.codexMcpConfigReplace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Review changes'));
    expect(screen.getByText('Confirm global MCP configuration change')).toBeTruthy();
    expect(screen.getByText(/Added stdio server docs/)).toBeTruthy();
    expect(mockSai.codexMcpConfigReplace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I understand this changes my global Codex MCP configuration'));
    fireEvent.click(screen.getByText('Confirm and save'));
    await waitFor(() => expect(mockSai.codexMcpConfigReplace).toHaveBeenCalledWith({
      expectedVersion: 'version-1',
      servers: expect.arrayContaining([expect.objectContaining({ name: 'docs', command: 'npx', args: [] })]),
      confirmationToken: 'confirm-global-user-mcp-config',
    }));
  });

  it('redacts configuration values in the review and refreshes after a conflict', async () => {
    mockSai.codexMcpConfigReplace.mockResolvedValueOnce({ ok: false, code: 'conflict' });
    mockSai.codexMcpConfigGet.mockResolvedValueOnce({ ok: true, snapshot }).mockResolvedValueOnce({ ok: true, snapshot: { ...snapshot, version: 'version-2' } });
    render(<CodexMcpConfigPanel available />);
    await screen.findByText('filesystem');
    fireEvent.click(screen.getByText('Add server'));
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'docs' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.click(screen.getByText('Stage server'));
    fireEvent.click(screen.getByText('Review changes'));
    expect(screen.queryByText('@modelcontextprotocol/server-filesystem')).toBeNull();
    fireEvent.click(screen.getByLabelText('I understand this changes my global Codex MCP configuration'));
    fireEvent.click(screen.getByText('Confirm and save'));
    await waitFor(() => expect(mockSai.codexMcpConfigGet).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Configuration changed elsewhere. Review the refreshed configuration before saving again.')).toBeTruthy();
    expect(screen.queryByText('Confirm global MCP configuration change')).toBeNull();
  });

  it('stages edits and removals locally without saving them', async () => {
    render(<CodexMcpConfigPanel available />);
    await screen.findByText('filesystem');
    fireEvent.click(screen.getByLabelText('Edit filesystem'));
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'files' } });
    fireEvent.click(screen.getByText('Stage server'));
    expect(screen.getByText('files')).toBeTruthy();
    expect(mockSai.codexMcpConfigReplace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Remove files'));
    expect(screen.queryByText('files')).toBeNull();
    expect(screen.getByText('Review changes')).toBeTruthy();
    expect(mockSai.codexMcpConfigReplace).not.toHaveBeenCalled();
  });
});
