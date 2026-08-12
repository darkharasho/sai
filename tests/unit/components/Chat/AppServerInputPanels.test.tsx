import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UserInputRequestPanel from '../../../../src/components/Chat/UserInputRequestPanel';
import McpElicitationPanel from '../../../../src/components/Chat/McpElicitationPanel';

describe('UserInputRequestPanel', () => {
  it('submits selected structured options and keeps a supplied countdown visible', () => {
    const onSubmit = vi.fn();
    render(
      <UserInputRequestPanel
        request={{ requestHandle: 'question-1', questions: [{ id: 'style', prompt: 'Choose style', options: [{ id: 'brief', label: 'Brief' }, { id: 'detailed', label: 'Detailed' }] }], autoResolutionMs: 60_000 }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Input needed')).toBeTruthy();
    expect(screen.getByText(/resolves automatically/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Brief'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith({ style: ['brief'] });
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
