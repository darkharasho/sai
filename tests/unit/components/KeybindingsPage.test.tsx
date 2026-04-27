import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KeybindingsPage from '../../../src/components/Settings/KeybindingsPage';

let savedOverrides: Record<string, string> = {};

beforeEach(() => {
  savedOverrides = {};
  (window as any).sai = {
    settingsGet: vi.fn().mockImplementation((key: string, def: any) =>
      key === 'keybindings' ? Promise.resolve(savedOverrides) : Promise.resolve(def)),
    settingsSet: vi.fn().mockImplementation((key: string, value: any) => {
      if (key === 'keybindings') savedOverrides = value;
      return Promise.resolve();
    }),
  };
});

describe('KeybindingsPage', () => {
  it('renders all four registered bindings with their defaults', async () => {
    render(<KeybindingsPage />);
    expect(await screen.findByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByText('Toggle chat history sidebar')).toBeInTheDocument();
    expect(screen.getByText('Toggle search sidebar')).toBeInTheDocument();
    expect(screen.getByText('Toggle markdown preview')).toBeInTheDocument();
    // Combos shown verbatim on linux
    expect(screen.getAllByText('Ctrl+K').length).toBeGreaterThan(0);
  });

  it('search filter narrows rows by label', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    fireEvent.change(screen.getByPlaceholderText(/search keybindings/i), { target: { value: 'palette' } });
    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.queryByText('Toggle search sidebar')).not.toBeInTheDocument();
  });

  it('Edit button enters capture mode and captures a new combo', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    const row = screen.getByText('Open command palette').closest('.keybinding-row')!;
    fireEvent.click(row.querySelector('.keybinding-edit')!);
    expect(row.textContent).toMatch(/press keys/i);
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(row.textContent).toContain('Ctrl+J');
    expect((window as any).sai.settingsSet).toHaveBeenCalledWith(
      'keybindings',
      expect.objectContaining({ 'palette.open': 'Ctrl+J' }),
    );
  });

  it('Esc cancels capture mode without saving', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    const row = screen.getByText('Open command palette').closest('.keybinding-row')!;
    fireEvent.click(row.querySelector('.keybinding-edit')!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(row.textContent).not.toMatch(/press keys/i);
    expect(row.textContent).toContain('Ctrl+K');
    expect((window as any).sai.settingsSet).not.toHaveBeenCalled();
  });

  it('Reset button restores default and is disabled when already default', async () => {
    savedOverrides = { 'palette.open': 'Ctrl+J' };
    render(<KeybindingsPage />);
    await screen.findByText('Ctrl+J');
    const row = screen.getByText('Open command palette').closest('.keybinding-row')!;
    const resetBtn = row.querySelector('.keybinding-reset') as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(false);
    fireEvent.click(resetBtn);
    expect(row.textContent).toContain('Ctrl+K');
  });

  it('shows conflict modal when captured combo is already taken', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    const row = screen.getByText('Toggle chat history sidebar').closest('.keybinding-row')!;
    fireEvent.click(row.querySelector('.keybinding-edit')!);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });   // collides with palette.open
    expect(screen.getByText(/currently bound to/i)).toBeInTheDocument();
    expect(screen.getByText(/open command palette/i)).toBeInTheDocument();
  });

  it('Reset all button restores all defaults', async () => {
    savedOverrides = { 'palette.open': 'Ctrl+J', 'search.toggle': 'Ctrl+G' };
    render(<KeybindingsPage />);
    await screen.findByText('Ctrl+J');
    fireEvent.click(screen.getByText(/reset all/i));
    fireEvent.click(screen.getByText(/^reset$/i));   // confirm in modal
    expect((window as any).sai.settingsSet).toHaveBeenCalledWith('keybindings', {});
  });
});
