import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';
import SettingsModal from '../../../src/components/SettingsModal';

describe('SettingsModal after swarm removal', () => {
  it('opens on the General page with no Swarm nav item, even if a stale "swarm" page was persisted', () => {
    const mock = createMockSai();
    // Any page-like setting comes back as the legacy 'swarm' page.
    mock.settingsGet = vi.fn((key: string, d?: unknown) =>
      Promise.resolve(/page/i.test(key) ? 'swarm' : d ?? undefined));
    installMockSai(mock);
    const { container } = render(<SettingsModal onClose={vi.fn()} onSettingChange={vi.fn()} />);

    const active = container.querySelector('.settings-nav-item.active');
    expect(active?.textContent).toBe('General');
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    const navLabels = Array.from(container.querySelectorAll('.settings-sidebar button')).map(b => b.textContent);
    expect(navLabels).not.toContain('Swarm');
  });
});

describe('SettingsModal low token mode snapshot', () => {
  async function turnOffWith(snapshot: unknown[]) {
    const mock = createMockSai();
    mock.settingsGet = vi.fn((key: string, d?: unknown) => Promise.resolve(
      key === 'lowTokenMode' ? true : key === 'lowTokenModeSnapshot' ? snapshot : d ?? undefined));
    installMockSai(mock);
    render(<SettingsModal onClose={vi.fn()} onSettingChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Claude$/ }));
    const toggle = () => screen.getByText('Low token mode').closest('.settings-row')!
      .querySelector('button[role="switch"]') as HTMLButtonElement;
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle());
    await waitFor(() => expect(mock.settingsSet).toHaveBeenCalledWith('lowTokenMode', false));
    return mock;
  }

  it('restores the budget from a current 5-entry snapshot', async () => {
    const mock = await turnOffWith([{ model: 'opus' }, true, true, 0, 7]);
    expect(mock.settingsSet).toHaveBeenCalledWith('claudeMaxBudgetUsd', 7);
    expect(mock.settingsSet).not.toHaveBeenCalledWith(expect.stringMatching(/^swarm\./), expect.anything());
  });

  it('still restores a legacy 8-entry snapshot, ignoring its swarm entries', async () => {
    const mock = await turnOffWith([{ model: 'opus' }, true, true, 0, 5, 'opus', 'opus', 9]);
    expect(mock.settingsSet).toHaveBeenCalledWith('claudeMaxBudgetUsd', 9);
    expect(mock.settingsSet).toHaveBeenCalledWith('autoCompactThreshold', 0);
    expect(mock.settingsSet).not.toHaveBeenCalledWith(expect.stringMatching(/^swarm\./), expect.anything());
  });
});
