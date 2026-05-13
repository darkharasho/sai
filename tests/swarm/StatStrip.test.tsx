// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatStrip from '../../src/components/Swarm/StatStrip';

describe('StatStrip', () => {
  it('renders all 5 cards', () => {
    render(<StatStrip active={3} approvals={1} ready={2} queued={4} cap={5} cost={0.42} runtimeSec={134} />);
    expect(screen.getByTestId('stat-active')).toBeInTheDocument();
    expect(screen.getByTestId('stat-approvals')).toBeInTheDocument();
    expect(screen.getByTestId('stat-ready')).toBeInTheDocument();
    expect(screen.getByTestId('stat-queued')).toBeInTheDocument();
    expect(screen.getByTestId('stat-cost-runtime')).toBeInTheDocument();
  });

  it('shows the numeric counts and cap', () => {
    render(<StatStrip active={3} approvals={1} ready={2} queued={4} cap={5} cost={0.42} runtimeSec={134} />);
    expect(screen.getByTestId('stat-active').textContent).toMatch(/3/);
    expect(screen.getByTestId('stat-approvals').textContent).toMatch(/1/);
    expect(screen.getByTestId('stat-ready').textContent).toMatch(/2/);
    expect(screen.getByTestId('stat-queued').textContent).toMatch(/cap: 5/);
    expect(screen.getByTestId('stat-cost-runtime').textContent).toMatch(/\$0\.42/);
    expect(screen.getByTestId('stat-cost-runtime').textContent).toMatch(/02:14/);
  });

  it('mutes the approvals card when count is zero', () => {
    render(<StatStrip active={1} approvals={0} ready={0} queued={0} cap={5} />);
    const card = screen.getByTestId('stat-approvals');
    // muted: opacity < 1
    expect(card.getAttribute('style')).toMatch(/opacity:\s*0\.7/);
  });

  it('renders idle text when no runtime is provided', () => {
    render(<StatStrip active={0} approvals={0} ready={0} queued={0} cap={5} />);
    expect(screen.getByTestId('stat-cost-runtime').textContent).toMatch(/idle/);
  });
});
