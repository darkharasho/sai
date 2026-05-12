// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrchestratorView from '../../src/components/Swarm/OrchestratorView';

const stats = { active: 5, approvals: 1, ready: 1, queued: 0, cap: 5, cost: 0.42, runtimeSec: 134 };

describe('OrchestratorView', () => {
  it('renders header', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} />);
    expect(screen.getByText(/orchestrator/i)).toBeInTheDocument();
  });

  it('renders non-Claude banner when orchestratorProvider is codex', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} orchestratorProvider="codex"/>);
    expect(screen.getByTestId('orch-non-claude-banner')).toBeInTheDocument();
    expect(screen.getByText(/chat-driven dispatch requires claude/i)).toBeInTheDocument();
  });

  it('does NOT render banner when orchestratorProvider is claude', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} orchestratorProvider="claude"/>);
    expect(screen.queryByTestId('orch-non-claude-banner')).not.toBeInTheDocument();
  });

  it('does NOT render banner when orchestratorProvider is undefined', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} />);
    expect(screen.queryByTestId('orch-non-claude-banner')).not.toBeInTheDocument();
  });

  it('dashboard is collapsed by default and expands on toggle click', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} />);
    expect(screen.queryByTestId('orch-stat-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('orch-activity-ribbon')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('orch-dashboard-toggle'));
    expect(screen.getByTestId('orch-stat-strip')).toBeInTheDocument();
    expect(screen.getByTestId('orch-activity-ribbon')).toBeInTheDocument();
  });
});
