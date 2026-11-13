// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TaskChip } from '../../../../../src/components/Chat/tasks/TaskChip';

afterEach(cleanup);

describe('TaskChip', () => {
  it('renders title with color class', () => {
    render(<TaskChip title="Alpha task" colorIndex={7} />);
    const chip = screen.getByText('Alpha task');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).toBe('task-chip task-chip--c1');
  });
});
