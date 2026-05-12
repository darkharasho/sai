// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrchestratorView from '../../src/components/Swarm/OrchestratorView';

const stats = { active: 5, approvals: 1, ready: 1, cost: 0.42, runtimeSec: 134 };

describe('OrchestratorView', () => {
  it('renders header and composer', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} approvals={[]} readyTasks={[]} onCommand={vi.fn()}/>);
    expect(screen.getByText(/orchestrator/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('split-lines toggle sends one command per line', () => {
    const onCommand = vi.fn();
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} approvals={[]} readyTasks={[]} onCommand={onCommand}/>);
    fireEvent.click(screen.getByLabelText(/split lines/i));
    fireEvent.change(screen.getByPlaceholderText(/ask the orchestrator/i), { target: { value: 'a\nb\nc' }});
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onCommand).toHaveBeenCalledWith({ text: 'a\nb\nc', splitLines: true });
  });
});
