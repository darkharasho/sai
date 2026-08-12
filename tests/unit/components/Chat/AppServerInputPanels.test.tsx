import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UserInputRequestPanel from '../../../../src/components/Chat/UserInputRequestPanel';
import McpElicitationPanel from '../../../../src/components/Chat/McpElicitationPanel';

describe('UserInputRequestPanel', () => {
  it('submits selected structured options and keeps a supplied countdown visible', () => {
    const onSubmit = vi.fn();
    render(
      <UserInputRequestPanel
        request={{ requestHandle: 'question-1', questions: [{ id: 'style', header: 'Response style', prompt: 'Choose style', options: [{ id: 'brief', label: 'Brief' }, { id: 'detailed', label: 'Detailed' }] }], autoResolutionMs: 60_000 }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Input needed')).toBeTruthy();
    expect(screen.getByText(/resolves automatically/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Brief'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith({ style: { answers: ['brief'] } });
  });

  it('shows a bounded App Server header and masks secret free-form answers', () => {
    const onSubmit = vi.fn();
    render(
      <UserInputRequestPanel
        request={{ requestHandle: 'secret-1', questions: [{ id: 'token', header: 'Access token', prompt: 'Paste token', isSecret: true }] }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Access token')).toBeTruthy();
    const input = screen.getByLabelText('Paste token');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith({ token: { answers: ['secret-value'] } });
  });
});

describe('McpElicitationPanel', () => {
  it('submits form content and exposes decline and cancel actions', () => {
    const onResolve = vi.fn();
    render(
      <McpElicitationPanel
        request={{ requestHandle: 'mcp-1', mode: 'form', serverName: 'Calendar', message: 'Choose a city', requestedSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }}
        onResolve={onResolve}
      />,
    );

    fireEvent.change(screen.getByLabelText('city'), { target: { value: 'Portland' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onResolve).toHaveBeenCalledWith({ action: 'accept', content: { city: 'Portland' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onResolve).toHaveBeenLastCalledWith({ action: 'decline' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResolve).toHaveBeenLastCalledWith({ action: 'cancel' });
  });

  it('visibly requires every required primitive form field before submission', () => {
    const onResolve = vi.fn();
    render(
      <McpElicitationPanel
        request={{ requestHandle: 'mcp-required', mode: 'form', serverName: 'Calendar', message: 'Choose details', requestedSchema: {
          type: 'object', properties: { city: { type: 'string' }, days: { type: 'integer' } }, required: ['city', 'days'],
        } }}
        onResolve={onResolve}
      />,
    );

    expect(screen.getAllByText('Required')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('city'), { target: { value: 'Portland' } });
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('days'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onResolve).toHaveBeenCalledWith({ action: 'accept', content: { city: 'Portland', days: 3 } });
  });

  it('shows URL elicitation details without launching the URL', () => {
    render(
      <McpElicitationPanel
        request={{ requestHandle: 'mcp-url', mode: 'url', serverName: 'Login server', message: 'Complete sign in', url: 'https://example.test/login', elicitationId: 'login-1' }}
        onResolve={vi.fn()}
      />,
    );

    expect(screen.getByText('Login server')).toBeTruthy();
    expect(screen.getByText('https://example.test/login')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
