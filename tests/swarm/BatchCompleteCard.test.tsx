// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchCompleteCard from '../../src/components/Swarm/cards/BatchCompleteCard';
import type { ToolCall } from '../../src/types';

function tc(input: any): ToolCall {
  return {
    type: 'other',
    name: 'mcp__swarm__batch_complete',
    input: JSON.stringify(input),
  };
}

describe('BatchCompleteCard', () => {
  it('renders summary fields', () => {
    render(
      <BatchCompleteCard
        toolCall={tc({
          totalTasks: 5,
          landed: 3,
          discarded: 1,
          failed: 1,
          totalCost: 0.42,
          durationMs: 65_000,
          completionBuckets: [0, 1, 0, 2, 1, 0, 1, 0, 0, 0, 0, 0],
        })}
      />,
    );
    const card = screen.getByTestId('swarm-batch-complete-card');
    expect(card.textContent).toMatch(/Batch complete/i);
    expect(card.textContent).toMatch(/5/);
    expect(card.textContent).toMatch(/3/);
    expect(card.textContent).toMatch(/\$0\.42/);
    expect(card.textContent).toMatch(/1m 5s/);
  });

  it('renders sparkline when completion buckets have non-zero values', () => {
    render(
      <BatchCompleteCard
        toolCall={tc({
          totalTasks: 3,
          landed: 3,
          discarded: 0,
          failed: 0,
          completionBuckets: [0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
        })}
      />,
    );
    expect(screen.getByTestId('swarm-batch-complete-sparkline')).toBeInTheDocument();
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });

  it('omits sparkline when all buckets are zero', () => {
    render(
      <BatchCompleteCard
        toolCall={tc({ totalTasks: 2, landed: 0, discarded: 2, failed: 0, completionBuckets: [0, 0, 0] })}
      />,
    );
    expect(screen.queryByTestId('swarm-batch-complete-sparkline')).toBeNull();
  });

  it('fires onLandAll when "Land all green" is clicked', () => {
    const onLandAll = vi.fn();
    render(
      <BatchCompleteCard
        toolCall={tc({ totalTasks: 2, landed: 1, discarded: 0, failed: 0 })}
        onLandAll={onLandAll}
        hasLandable
      />,
    );
    fireEvent.click(screen.getByText(/Land all green/i));
    expect(onLandAll).toHaveBeenCalled();
  });
});
