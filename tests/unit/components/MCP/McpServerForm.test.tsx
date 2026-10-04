import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import McpServerForm from '../../../../src/components/MCP/McpServerForm';

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
});
