import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ApprovalBlock from '../../../../src/components/TerminalMode/ApprovalBlock';
import type { ApprovalBlock as ApprovalBlockType } from '../../../../src/components/TerminalMode/types';

const pendingBlock: ApprovalBlockType = {
  type: 'approval',
  id: '3',
  command: "sed -i 's/a + b + 1/a + b/' src/utils.ts",
  parentBlockId: '2',
  status: 'pending',
};

describe('ApprovalBlock', () => {
  it('renders the suggested command', () => {
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    expect(container.textContent).toContain("sed -i 's/a + b + 1/a + b/' src/utils.ts");
  });

  it('shows approve and reject buttons when pending', () => {
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    expect(container.textContent).toContain('approve');
    expect(container.textContent).toContain('reject');
  });

  it('calls onApprove when approve is clicked', () => {
    const onApprove = vi.fn();
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    const approveBtn = container.querySelector('[title="Approve"]') as HTMLElement;
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledWith(pendingBlock);
  });

  it('calls onReject when reject is clicked', () => {
    const onReject = vi.fn();
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={onReject} onEdit={vi.fn()} />
    );
    const rejectBtn = container.querySelector('[title="Reject"]') as HTMLElement;
    fireEvent.click(rejectBtn);
    expect(onReject).toHaveBeenCalledWith(pendingBlock);
  });

  it('calls onEdit when edit icon is clicked', () => {
    const onEdit = vi.fn();
    const { container } = render(
      <ApprovalBlock block={pendingBlock} onApprove={vi.fn()} onReject={vi.fn()} onEdit={onEdit} />
    );
    const editBtn = container.querySelector('[title="Edit"]') as HTMLElement;
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(pendingBlock);
  });

  it('hides approve/reject buttons when not pending', () => {
    const approved = { ...pendingBlock, status: 'approved' as const };
    const { container } = render(
      <ApprovalBlock block={approved} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} />
    );
    expect(container.querySelector('[title="Approve"]')).toBeNull();
  });
});
