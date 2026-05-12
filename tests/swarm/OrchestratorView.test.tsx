// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrchestratorView from '../../src/components/Swarm/OrchestratorView';

const stats = { active: 5, approvals: 1, ready: 1, queued: 0, cap: 5, cost: 0.42, runtimeSec: 134 };

describe('OrchestratorView', () => {
  it('renders header and composer', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} readyTasks={[]} onCommand={vi.fn()}/>);
    expect(screen.getByText(/orchestrator/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('renders non-Claude banner when orchestratorProvider is codex', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} readyTasks={[]} onCommand={vi.fn()} orchestratorProvider="codex"/>);
    expect(screen.getByTestId('orch-non-claude-banner')).toBeInTheDocument();
    expect(screen.getByText(/chat-driven dispatch requires claude/i)).toBeInTheDocument();
  });

  it('does NOT render banner when orchestratorProvider is claude', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} readyTasks={[]} onCommand={vi.fn()} orchestratorProvider="claude"/>);
    expect(screen.queryByTestId('orch-non-claude-banner')).not.toBeInTheDocument();
  });

  it('does NOT render banner when orchestratorProvider is undefined', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} readyTasks={[]} onCommand={vi.fn()}/>);
    expect(screen.queryByTestId('orch-non-claude-banner')).not.toBeInTheDocument();
  });

  it('renders the stat strip and activity ribbon', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} readyTasks={[]} onCommand={vi.fn()}/>);
    expect(screen.getByTestId('orch-stat-strip')).toBeInTheDocument();
    expect(screen.getByTestId('orch-activity-ribbon')).toBeInTheDocument();
  });

  it('burst toggle sends one command per line', () => {
    const onCommand = vi.fn();
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} readyTasks={[]} onCommand={onCommand}/>);
    fireEvent.click(screen.getByLabelText(/burst/i));
    fireEvent.change(screen.getByPlaceholderText(/ask the orchestrator/i), { target: { value: 'a\nb\nc' }});
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onCommand).toHaveBeenCalledWith({ text: 'a\nb\nc', splitLines: true });
  });
});
