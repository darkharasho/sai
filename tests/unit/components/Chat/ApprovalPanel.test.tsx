import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApprovalPanel from '../../../../src/components/Chat/ApprovalPanel';
import type { PendingApproval } from '../../../../src/types';

function makeApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    toolName: 'Bash',
    toolUseId: 'tu-1',
    command: 'ls -la',
    description: 'List directory contents',
    input: {},
    ...overrides,
  };
}

describe('ApprovalPanel', () => {
  it('renders without crashing', () => {
    const approval = makeApproval();
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('Bash')).toBeTruthy();
  });

  it('shows the tool name', () => {
    const approval = makeApproval({ toolName: 'Edit' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('shows correct label for Bash tool', () => {
    const approval = makeApproval({ toolName: 'Bash' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('wants to run a command')).toBeTruthy();
  });

  it('shows correct label for Edit tool', () => {
    const approval = makeApproval({ toolName: 'Edit', command: 'some file edit' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('wants to edit a file')).toBeTruthy();
  });

  it('shows correct label for Write tool', () => {
    const approval = makeApproval({ toolName: 'Write', command: 'some content' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('wants to write a file')).toBeTruthy();
  });

  it('shows generic label for unknown tool', () => {
    const approval = makeApproval({ toolName: 'CustomTool', command: 'something' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('wants to use CustomTool')).toBeTruthy();
  });

  it('renders command in textarea for Bash tool', () => {
    const approval = makeApproval({ toolName: 'Bash', command: 'ls -la' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('ls -la');
  });

  it('renders command in div for non-Bash tool', () => {
    const approval = makeApproval({ toolName: 'Edit', command: 'file content here' });
    const { container } = render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(container.textContent).toContain('file content here');
  });

  it('calls onApprove when Approve button is clicked', () => {
    const onApprove = vi.fn();
    const approval = makeApproval();
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={onApprove}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Approve'));
    expect(onApprove).toHaveBeenCalledTimes(1);
    // No modification → called with undefined
    expect(onApprove).toHaveBeenCalledWith(undefined);
  });

  it('calls onApprove with modified command when command was changed', () => {
    const onApprove = vi.fn();
    const approval = makeApproval({ command: 'ls -la' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={onApprove}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'ls -lah' } });
    fireEvent.click(screen.getByText('Approve'));
    expect(onApprove).toHaveBeenCalledWith('ls -lah');
  });

  it('calls onDeny when Deny button is clicked', () => {
    const onDeny = vi.fn();
    const approval = makeApproval();
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={onDeny}
        onAlwaysAllow={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Deny'));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('calls onAlwaysAllow when Always Allow button is clicked', () => {
    const onAlwaysAllow = vi.fn();
    const approval = makeApproval();
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={onAlwaysAllow}
      />
    );
    fireEvent.click(screen.getByText('Always Allow'));
    expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
  });

  it('pressing Enter calls onApprove for Bash tool', () => {
    const onApprove = vi.fn();
    const approval = makeApproval({ toolName: 'Bash' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={onApprove}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('pressing Escape calls onDeny for Bash tool', () => {
    const onDeny = vi.fn();
    const approval = makeApproval({ toolName: 'Bash' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={onDeny}
        onAlwaysAllow={vi.fn()}
      />
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('shows description when provided', () => {
    const approval = makeApproval({ description: 'Checking files in dir' });
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('Checking files in dir')).toBeTruthy();
  });
});
