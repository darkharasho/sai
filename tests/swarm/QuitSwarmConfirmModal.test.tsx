// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuitSwarmConfirmModal from '../../src/components/Swarm/QuitSwarmConfirmModal';

const tasks = [
  { id: 't1', title: 'migrate users' },
  { id: 't2', title: 'refactor auth' },
];

describe('QuitSwarmConfirmModal', () => {
  it('lists affected task titles', () => {
    render(<QuitSwarmConfirmModal tasks={tasks} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/tasks still running/i)).toBeInTheDocument();
    expect(screen.getByText(/migrate users/)).toBeInTheDocument();
    expect(screen.getByText(/refactor auth/)).toBeInTheDocument();
  });

  it('Cancel button fires onCancel', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<QuitSwarmConfirmModal tasks={tasks} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Quit anyway button fires onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<QuitSwarmConfirmModal tasks={tasks} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /quit anyway/i }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape triggers cancel, Enter triggers confirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<QuitSwarmConfirmModal tasks={tasks} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalled();
  });

  it('truncates long lists with +N more', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `task ${i}` }));
    render(<QuitSwarmConfirmModal tasks={many} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/\+4 more/)).toBeInTheDocument();
  });
});
