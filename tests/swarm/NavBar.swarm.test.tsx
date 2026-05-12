// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NavBar from '@/components/NavBar';

describe('NavBar swarm button', () => {
  it('shows ⚡ Swarm button and toggles', () => {
    const onToggle = vi.fn();
    render(<NavBar activeSidebar={null} onToggle={onToggle} swarmApprovalCount={0} />);
    fireEvent.click(screen.getByLabelText(/swarm/i));
    expect(onToggle).toHaveBeenCalledWith('swarm');
  });
  it('renders the approval badge when count > 0', () => {
    render(<NavBar activeSidebar={null} onToggle={() => {}} swarmApprovalCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
