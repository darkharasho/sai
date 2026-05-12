// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SwarmToolCardSelector from '../../src/components/Swarm/cards/SwarmToolCardSelector';
import SpawnTaskCard from '../../src/components/Swarm/cards/SpawnTaskCard';
import QueryStatusCard from '../../src/components/Swarm/cards/QueryStatusCard';
import LandCard from '../../src/components/Swarm/cards/LandCard';
import DiscardCard from '../../src/components/Swarm/cards/DiscardCard';
import PauseResumeCard from '../../src/components/Swarm/cards/PauseResumeCard';
import ApprovalActionCard from '../../src/components/Swarm/cards/ApprovalActionCard';
import InlineApprovalCard from '../../src/components/Swarm/cards/InlineApprovalCard';
import type { ToolCall, SwarmTask, SwarmApproval, ApprovalChatMeta } from '../../src/types';

function tc(name: string, input: any, output?: any): ToolCall {
  return {
    type: 'other',
    name,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    output: output == null ? undefined : (typeof output === 'string' ? output : JSON.stringify(output)),
  };
}

const baseTask: SwarmTask = {
  id: 't1', workspaceId: '/p', sessionId: 's1', title: 'migrate users',
  prompt: 'migrate users to v2', provider: 'claude', model: 'opus',
  approvalPolicy: 'auto-read', status: 'streaming',
  branch: 'sai/t1', baseBranch: 'main', worktreePath: null,
  createdAt: 0, lastActivityAt: 0, costEstimate: 0, toolCallCount: 0,
};

describe('SwarmToolCardSelector', () => {
  it('returns null for non-swarm tools', () => {
    const { container } = render(<SwarmToolCardSelector toolCall={tc('Bash', { command: 'ls' })} />);
    expect(container.firstChild).toBeNull();
  });
  it('dispatches to SpawnTaskCard', () => {
    render(<SwarmToolCardSelector toolCall={tc('mcp__swarm__spawn_task', { prompt: 'do thing', title: 'do thing' })} />);
    expect(screen.getByTestId('swarm-spawn-card')).toBeInTheDocument();
  });
  it('dispatches to LandCard', () => {
    render(<SwarmToolCardSelector toolCall={tc('mcp__swarm__land', { taskRef: 't1' }, { ok: true, branch: 'b', baseBranch: 'main' })} />);
    expect(screen.getByTestId('swarm-land-card')).toBeInTheDocument();
  });
});

describe('SpawnTaskCard', () => {
  it('renders header with task count', () => {
    render(<SpawnTaskCard toolCall={tc('mcp__swarm__spawn_tasks', { prompts: ['a', 'b', 'c'] })} />);
    expect(screen.getByText(/Spawned 3 tasks/i)).toBeInTheDocument();
  });
  it('shows live status pill from tasks prop', () => {
    render(<SpawnTaskCard
      toolCall={tc('mcp__swarm__spawn_task', { prompt: 'migrate users to v2', title: 'migrate users' })}
      tasks={[baseTask]}
    />);
    expect(screen.getAllByTestId('swarm-status-pill')[0].textContent).toMatch(/streaming/i);
  });
  it('fires onFocusTask when matched task row clicked', () => {
    const onFocus = vi.fn();
    render(<SpawnTaskCard
      toolCall={tc('mcp__swarm__spawn_task', { prompt: 'migrate users to v2', title: 'migrate users' })}
      tasks={[baseTask]}
      onFocusTask={onFocus}
    />);
    fireEvent.click(screen.getByRole('button', { name: /migrate users/i }));
    expect(onFocus).toHaveBeenCalledWith('t1');
  });
});

describe('QueryStatusCard', () => {
  it('renders snapshot summary', () => {
    render(<QueryStatusCard toolCall={tc('mcp__swarm__query_status', {}, { active: 2, approvals: 1, ready: 0, tasks: [] })} />);
    expect(screen.getByText(/active/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
  it('expands task list on click', () => {
    render(<QueryStatusCard toolCall={tc('mcp__swarm__query_status', {}, {
      active: 1, approvals: 0, ready: 0,
      tasks: [{ id: 't1', title: 'foo', status: 'streaming' }],
    })} />);
    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(screen.getByText('foo')).toBeInTheDocument();
  });
});

describe('LandCard', () => {
  it('renders success state with diff stats', () => {
    render(<LandCard toolCall={tc('mcp__swarm__land', { taskRef: 't1' }, {
      ok: true, branch: 'feat/x', baseBranch: 'main', additions: 10, deletions: 3,
    })} />);
    expect(screen.getByText(/Landed/)).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getByText('−3')).toBeInTheDocument();
  });
  it('renders failure with rebase retry button', () => {
    const onRetry = vi.fn();
    render(<LandCard
      toolCall={tc('mcp__swarm__land', { taskRef: 't1' }, { ok: false, reason: 'conflict' })}
      onRebaseRetry={onRetry}
    />);
    expect(screen.getByText(/Rebase needed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /rebase \+ retry/i }));
    expect(onRetry).toHaveBeenCalledWith('t1');
  });
});

describe('DiscardCard', () => {
  it('renders discarded branch', () => {
    render(<DiscardCard toolCall={tc('mcp__swarm__discard', { branch: 'feat/y' })} />);
    expect(screen.getByText(/Discarded/)).toBeInTheDocument();
    expect(screen.getByText('feat/y')).toBeInTheDocument();
  });
});

describe('PauseResumeCard', () => {
  it('renders paused with task title', () => {
    render(<PauseResumeCard toolCall={tc('mcp__swarm__pause_task', { taskRef: 't1' })} tasks={[baseTask]} />);
    expect(screen.getByTestId('swarm-pause-card')).toHaveTextContent(/paused/i);
    expect(screen.getByTestId('swarm-pause-card')).toHaveTextContent(/migrate users/);
  });
  it('renders resumed', () => {
    render(<PauseResumeCard toolCall={tc('mcp__swarm__resume_task', { taskRef: 't1' })} tasks={[baseTask]} />);
    expect(screen.getByTestId('swarm-resume-card')).toHaveTextContent(/resumed/i);
  });
});

describe('ApprovalActionCard', () => {
  const approval: SwarmApproval = {
    id: 'a1', taskId: 't1', workspaceId: '/p',
    toolName: 'Bash', toolUseId: 'tu1', command: 'ls', createdAt: 0,
  };
  it('renders approve action', () => {
    render(<ApprovalActionCard
      toolCall={tc('mcp__swarm__approve_tool_call', { approvalId: 'a1' })}
      approvals={[approval]}
      tasks={[baseTask]}
    />);
    const card = screen.getByTestId('swarm-approve-action-card');
    expect(card).toHaveTextContent(/approved/i);
    expect(card).toHaveTextContent(/Bash/);
    expect(card).toHaveTextContent(/migrate users/);
  });
  it('renders deny action', () => {
    render(<ApprovalActionCard
      toolCall={tc('mcp__swarm__deny_tool_call', { approvalId: 'a1' })}
      approvals={[approval]}
      tasks={[baseTask]}
    />);
    expect(screen.getByTestId('swarm-deny-action-card')).toHaveTextContent(/denied/i);
  });
});

describe('InlineApprovalCard', () => {
  const meta: ApprovalChatMeta = {
    type: 'approval', approvalId: 'a1', taskId: 't1', taskTitle: 'migrate users',
    toolName: 'Bash', command: 'rm -rf /tmp/foo', branch: 'sai/t1', createdAt: Date.now(),
  };

  it('renders pending state with command and buttons', () => {
    render(<InlineApprovalCard meta={meta} onApprove={() => {}} onDeny={() => {}} />);
    expect(screen.getByText(/Approval needed/i)).toBeInTheDocument();
    expect(screen.getByText(/migrate users/)).toBeInTheDocument();
    expect(screen.getByText(/rm -rf/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('fires onApprove with id', () => {
    const onApprove = vi.fn();
    render(<InlineApprovalCard meta={meta} onApprove={onApprove} onDeny={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith('a1');
  });

  it('collapses to summary line when resolved', () => {
    render(<InlineApprovalCard meta={{ ...meta, resolved: 'approved' }} />);
    const card = screen.getByTestId('swarm-inline-approval-card');
    expect(card.getAttribute('data-resolved')).toBe('approved');
    expect(card).toHaveTextContent(/Approved/);
    // No buttons in resolved state
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });
});
