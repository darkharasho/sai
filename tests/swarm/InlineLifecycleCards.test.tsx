// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskStartedCard from '../../src/components/Swarm/cards/TaskStartedCard';
import AutoApprovedCard from '../../src/components/Swarm/cards/AutoApprovedCard';
import SwarmToolCardSelector from '../../src/components/Swarm/cards/SwarmToolCardSelector';
import type { ToolCall } from '../../src/types';

function tc(name: string, input: any): ToolCall {
  return {
    type: 'other',
    name,
    input: typeof input === 'string' ? input : JSON.stringify(input),
  };
}

describe('TaskStartedCard', () => {
  it('renders title and branch', () => {
    render(
      <TaskStartedCard
        toolCall={tc('mcp__swarm__task_started', { taskId: 't1', title: 'refactor auth', branch: 'sai/t1' })}
      />
    );
    const el = screen.getByTestId('swarm-task-started-card');
    expect(el.textContent).toMatch(/Task started/);
    expect(el.textContent).toMatch(/refactor auth/);
    expect(el.textContent).toMatch(/sai\/t1/);
  });

  it('falls back to "task" when no title', () => {
    render(<TaskStartedCard toolCall={tc('mcp__swarm__task_started', {})} />);
    expect(screen.getByTestId('swarm-task-started-card').textContent).toMatch(/task/);
  });
});

describe('AutoApprovedCard', () => {
  it('renders the tool name and task title', () => {
    render(
      <AutoApprovedCard
        toolCall={tc('mcp__swarm__auto_approved', { taskTitle: 'migrate users', toolName: 'Read', branch: 'sai/m' })}
      />
    );
    const el = screen.getByTestId('swarm-auto-approved-card');
    expect(el.textContent).toMatch(/auto-approved/);
    expect(el.textContent).toMatch(/Read/);
    expect(el.textContent).toMatch(/migrate users/);
  });
});

describe('SwarmToolCardSelector wires lifecycle cards', () => {
  it('dispatches to TaskStartedCard', () => {
    render(<SwarmToolCardSelector toolCall={tc('mcp__swarm__task_started', { title: 'x' })} />);
    expect(screen.getByTestId('swarm-task-started-card')).toBeInTheDocument();
  });
  it('dispatches to AutoApprovedCard', () => {
    render(<SwarmToolCardSelector toolCall={tc('mcp__swarm__auto_approved', { toolName: 'Read' })} />);
    expect(screen.getByTestId('swarm-auto-approved-card')).toBeInTheDocument();
  });
});
