// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApprovalTray from '../../src/components/Swarm/ApprovalTray';

const approvals = [{
  id: 'a1', taskId: 't1', taskTitle: 'migrate users',
  toolName: 'bash', command: 'psql -f migrate.sql', createdAt: 1,
}];

describe('ApprovalTray', () => {
  it('renders pending approvals and fires actions', () => {
    const onApprove = vi.fn(); const onDeny = vi.fn();
    render(<ApprovalTray approvals={approvals} onApprove={onApprove} onDeny={onDeny} onApproveAllReads={() => {}} onDenyAll={() => {}}/>);
    expect(screen.getByText(/migrate users/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(onApprove).toHaveBeenCalledWith('a1');
  });

  it('renders nothing when empty', () => {
    const { container } = render(<ApprovalTray approvals={[]} onApprove={() => {}} onDeny={() => {}} onApproveAllReads={() => {}} onDenyAll={() => {}}/>);
    expect(container.firstChild).toBeNull();
  });

  it('shows "approve all reads" for a real Grep tool row', () => {
    const reads = [{
      id: 'r1', taskId: 't1', taskTitle: 'inspect config',
      toolName: 'Grep', command: 'rg foo', createdAt: 1,
    }];
    const onApproveAllReads = vi.fn();
    render(
      <ApprovalTray
        approvals={reads}
        onApprove={() => {}}
        onDeny={() => {}}
        onApproveAllReads={onApproveAllReads}
        onDenyAll={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /approve all reads/i });
    fireEvent.click(btn);
    expect(onApproveAllReads).toHaveBeenCalled();
  });
});
