// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityRibbon from '../../src/components/Swarm/ActivityRibbon';

describe('ActivityRibbon', () => {
  it('renders all segments when all values are present', () => {
    render(<ActivityRibbon active={3} ready={2} approvals={1} cost={0.42} tokRate={47} />);
    expect(screen.getByTestId('ribbon-active')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-ready')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-approvals')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-cost')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-tok')).toBeInTheDocument();
  });

  it('hides zero-count segments', () => {
    render(<ActivityRibbon active={2} ready={0} approvals={0} cost={0.10} />);
    expect(screen.getByTestId('ribbon-active')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-ready')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-approvals')).not.toBeInTheDocument();
    expect(screen.getByTestId('ribbon-cost')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-tok')).not.toBeInTheDocument();
  });

  it('renders idle when nothing is active', () => {
    render(<ActivityRibbon active={0} ready={0} approvals={0} />);
    expect(screen.getByTestId('orch-activity-ribbon').textContent).toMatch(/idle/);
  });

  it('omits tokRate when undefined', () => {
    render(<ActivityRibbon active={1} ready={0} approvals={0} />);
    expect(screen.queryByTestId('ribbon-tok')).not.toBeInTheDocument();
  });
});
