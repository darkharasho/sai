// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReadyToLandTray from '../../src/components/Swarm/ReadyToLandTray';

const tasks = [{ id: 't', title: 'fix flaky test', branch: 'swarm/fix-x', additions: 18, deletions: 7 }];

describe('ReadyToLandTray', () => {
  it('lists ready tasks with land/discard/diff', () => {
    const onLand = vi.fn(); const onDiscard = vi.fn(); const onDiff = vi.fn();
    render(<ReadyToLandTray tasks={tasks as any} onLand={onLand} onDiscard={onDiscard} onDiff={onDiff} onLandAll={() => {}}/>);
    expect(screen.getByText(/fix flaky test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^land$/i }));
    expect(onLand).toHaveBeenCalledWith('t');
  });

  it('renders nothing when empty', () => {
    const { container } = render(<ReadyToLandTray tasks={[]} onLand={() => {}} onDiscard={() => {}} onDiff={() => {}} onLandAll={() => {}}/>);
    expect(container.firstChild).toBeNull();
  });
});
