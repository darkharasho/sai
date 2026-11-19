import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';
import RemoteSettings from '../../../src/components/Settings/RemoteSettings';

function mount(stored: unknown) {
  const mock = createMockSai() as any;
  mock.settingsGet = vi.fn((key: string, fallback: unknown) => Promise.resolve(key === 'pushNotifications' ? stored : fallback));
  mock.remote = {
    status: vi.fn().mockResolvedValue({ running: false, url: null, reason: null, pairedCount: 0, enabled: false }),
    listDevices: vi.fn().mockResolvedValue([]),
    getCeiling: vi.fn().mockResolvedValue(null),
  };
  installMockSai(mock);
  render(<RemoteSettings />);
  return mock;
}

describe('Remote settings: push notifications', () => {
  it('defaults on and toggles the pushNotifications setting', async () => {
    const mock = mount(true);
    const toggle = screen.getByRole('switch', { name: 'Send notifications to paired phones' });
    expect(screen.getByText('Send notifications to paired phones')).toBeTruthy();
    await waitFor(() => expect(mock.settingsGet).toHaveBeenCalledWith('pushNotifications', true));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(mock.settingsSet).toHaveBeenCalledWith('pushNotifications', false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('shows off when the stored setting is false', async () => {
    mount(false);
    const toggle = screen.getByRole('switch', { name: 'Send notifications to paired phones' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });
});
