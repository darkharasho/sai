import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import McpServerForm, { joinArgs, parseArgs } from '../../../../src/components/MCP/McpServerForm';

describe('McpServerForm', () => {
  it('add http server with headers to the project file', () => {
    const onSubmit = vi.fn();
    const { getByText, getByPlaceholderText, getAllByPlaceholderText } = render(
      <McpServerForm mode="add" hasProject onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'cf' } });
    fireEvent.click(getByText('HTTP'));
    fireEvent.change(getByPlaceholderText('https://example.com/mcp'), { target: { value: 'https://cf/mcp' } });
    fireEvent.click(getByText('Add header'));
    fireEvent.change(getAllByPlaceholderText('Header')[0], { target: { value: 'Authorization' } });
    fireEvent.change(getAllByPlaceholderText('value')[0], { target: { value: 'Bearer x' } });
    fireEvent.click(getByText('This project'));
    fireEvent.click(getByText('Add Server'));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'cf', transport: 'streamable-http', url: 'https://cf/mcp', headers: { Authorization: 'Bearer x' }, source: 'project',
    });
  });

  it('edit mode prefills, locks name, hides target, keeps source', () => {
    const onSubmit = vi.fn();
    const { getByDisplayValue, getByText, queryByText } = render(
      <McpServerForm mode="edit" hasProject
        initial={{ name: 'gh', transport: 'streamable-http', url: 'https://gh', headers: { A: 'b' }, enabled: true, source: 'project' }}
        onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    expect((getByDisplayValue('gh') as HTMLInputElement).readOnly).toBe(true);
    expect(getByDisplayValue('A')).toBeTruthy();
    expect(queryByText('This project')).toBeNull();
    expect(getByText('Edit MCP Server')).toBeTruthy();
    fireEvent.click(getByText('Save'));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'gh', transport: 'streamable-http', url: 'https://gh', headers: { A: 'b' }, source: 'project' });
  });

  it('stdio has no headers section', () => {
    const { queryByText } = render(<McpServerForm mode="add" hasProject={false} onBack={vi.fn()} onSubmit={vi.fn()} />);
    expect(queryByText('Add header')).toBeNull();
    expect(queryByText('This project')).toBeNull();
  });

  it('shows inline accessible errors and does not submit an empty form', () => {
    const onSubmit = vi.fn();
    const { getByText, getAllByRole, getByPlaceholderText } = render(
      <McpServerForm mode="add" hasProject={false} onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.click(getByText('Add Server'));
    expect(onSubmit).not.toHaveBeenCalled();
    const alerts = getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(['Name is required.', 'Command is required.']);
    const name = getByPlaceholderText('my-server');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBe('Name is required.');
  });

  it('rejects a non-http URL and an empty header name', () => {
    const onSubmit = vi.fn();
    const { getByText, getByPlaceholderText, getAllByPlaceholderText, getAllByRole } = render(
      <McpServerForm mode="add" hasProject={false} onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'x' } });
    fireEvent.click(getByText('SSE'));
    fireEvent.change(getByPlaceholderText('https://example.com/mcp'), { target: { value: 'ftp://x' } });
    fireEvent.click(getByText('Add header'));
    fireEvent.change(getAllByPlaceholderText('value')[0], { target: { value: 'secret-token' } });
    fireEvent.click(getByText('Add Server'));
    expect(onSubmit).not.toHaveBeenCalled();
    const alerts = getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(['URL must start with http:// or https://.', 'Header name is required.']);
    expect(alerts.join()).not.toContain('secret-token');
  });

  const stdioInit = { name: 's', transport: 'stdio' as const, command: 'sh', args: ['-c', 'echo hi'], enabled: true, source: 'user' as const };

  it('edit then Save with unchanged stdio args submits them verbatim', () => {
    const onSubmit = vi.fn();
    const { getByText } = render(<McpServerForm mode="edit" hasProject initial={stdioInit} onBack={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(getByText('Save'));
    expect(onSubmit.mock.calls[0][0].args).toEqual(['-c', 'echo hi']);
  });

  it('typed quoted args parse to the same array and join/parse round-trip', () => {
    const onSubmit = vi.fn();
    const { getByText, getByDisplayValue } = render(<McpServerForm mode="edit" hasProject initial={stdioInit} onBack={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(getByDisplayValue('-c "echo hi"'), { target: { value: `-c "echo hi" 'a b'` } });
    fireEvent.click(getByText('Save'));
    expect(onSubmit.mock.calls[0][0].args).toEqual(['-c', 'echo hi', 'a b']);
    for (const a of [['x', ''], ['a"b', "c'd e"], ['back\\slash', 'q" \\']]) expect(parseArgs(joinArgs(a))).toEqual(a);
  });

  it('add mode rejects a name that exists in the same target only', () => {
    const onSubmit = vi.fn();
    const { getByText, getByPlaceholderText, getByRole } = render(
      <McpServerForm mode="add" hasProject existing={[{ name: 'dup', source: 'user' }]} onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'dup' } });
    fireEvent.change(getByPlaceholderText('npx'), { target: { value: 'run' } });
    fireEvent.click(getByText('Add Server'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(getByRole('alert').textContent).toBe('A server named dup already exists — open it to edit.');
    fireEvent.click(getByText('This project'));
    fireEvent.click(getByText('Add Server'));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('rejects duplicate header names', () => {
    const onSubmit = vi.fn();
    const { getByText, getByPlaceholderText, getAllByPlaceholderText, getByRole } = render(
      <McpServerForm mode="add" hasProject={false} onBack={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(getByPlaceholderText('my-server'), { target: { value: 'x' } });
    fireEvent.click(getByText('HTTP'));
    fireEvent.change(getByPlaceholderText('https://example.com/mcp'), { target: { value: 'https://x' } });
    fireEvent.click(getByText('Add header'));
    fireEvent.click(getByText('Add header'));
    const keys = getAllByPlaceholderText('Header');
    fireEvent.change(keys[0], { target: { value: 'A' } });
    fireEvent.change(keys[1], { target: { value: 'a' } });
    fireEvent.click(getByText('Add Server'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(getByRole('alert').textContent).toBe('Header names must be unique.');
  });
});
