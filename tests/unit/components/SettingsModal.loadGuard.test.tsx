import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';
import SettingsModal from '../../../src/components/SettingsModal';

const PROTECT = 'Protect my PC from overload';
const STOP = "Stop SAI's heavy processes when needed";

function setup(platform = 'linux') {
  const mock = createMockSai();
  mock.settingsGet = vi.fn((_k: string, d?: unknown) => Promise.resolve(d ?? undefined));
  (mock as any).platform = platform;
  installMockSai(mock);
  render(<SettingsModal onClose={vi.fn()} onSettingChange={vi.fn()} />);
  return mock;
}

const toggle = (name: string) =>
  screen.getByText(name).closest('.settings-row')!.querySelector('button[role="switch"]') as HTMLButtonElement;

describe('SettingsModal load guard toggles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders both toggles checked by default', async () => {
    setup();
    await waitFor(() => expect(toggle(PROTECT).getAttribute('aria-checked')).toBe('true'));
    expect(toggle(STOP).getAttribute('aria-checked')).toBe('true');
    expect(toggle(STOP).disabled).toBe(false);
  });

  it('unchecking the first saves the setting and disables the second', async () => {
    const mock = setup();
    await waitFor(() => expect(toggle(PROTECT).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle(PROTECT));
    expect(mock.settingsSet).toHaveBeenCalledWith('loadGuardEnabled', false);
    expect(toggle(PROTECT).getAttribute('aria-checked')).toBe('false');
    expect(toggle(STOP).disabled).toBe(true);
  });

  it('saves the auto-kill toggle', async () => {
    const mock = setup();
    await waitFor(() => expect(toggle(STOP).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle(STOP));
    expect(mock.settingsSet).toHaveBeenCalledWith('loadGuardAutoKill', false);
  });

  it('hides both toggles off Linux', () => {
    setup('darwin');
    expect(screen.queryByText(PROTECT)).toBeNull();
    expect(screen.queryByText(STOP)).toBeNull();
  });
});
