import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';

// We mock the module so we control what 'version' resolves to.
// The real package.json version is whatever it is — tests pin it to '1.2.3'.
vi.mock('../../../package.json', () => ({ version: '1.2.3' }));

import { useWhatsNew } from '../../../src/hooks/useWhatsNew';

function makeSettingsGetMock(lastSeenVersion: string | null = null) {
  return vi.fn((_key: string, defaultValue?: unknown) => {
    if (_key === 'lastSeenVersion') return Promise.resolve(lastSeenVersion);
    return Promise.resolve(defaultValue ?? undefined);
  });
}

describe('useWhatsNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    global.fetch = vi.fn();
    const mock = createMockSai();
    installMockSai(mock);
  });

  describe('auto-open on version mismatch', () => {
    it('opens the modal when lastSeenVersion is null (first install)', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      // Fetch returns a release body
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: '## Release notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));
    });

    it('opens the modal when lastSeenVersion differs from current version', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.2');
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: '## Notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));
    });

    it('does NOT open the modal when lastSeenVersion matches current version', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.3');
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      // Give async operations time to settle
      await new Promise(r => setTimeout(r, 50));
      expect(result.current.isOpen).toBe(false);
    });

    it('writes lastSeenVersion to settings when auto-opening', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: 'notes' }),
      });
      installMockSai(mock);

      renderHook(() => useWhatsNew());

      await waitFor(() =>
        expect(mock.settingsSet).toHaveBeenCalledWith('lastSeenVersion', '1.2.3')
      );
    });
  });

  describe('fetch logic', () => {
    it('sets fetchStatus to "success" and releaseNotes on successful fetch', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: '## What is new' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
      expect(result.current.releaseNotes).toBe('## What is new');
    });

    it('sets fetchStatus to "error" on non-OK HTTP response', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('error'));
      expect(result.current.releaseNotes).toBeNull();
    });

    it('sets fetchStatus to "error" on network failure', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('error'));
    });
  });

  describe('openWhatsNew', () => {
    it('opens the modal and triggers fetch', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.3'); // already seen — no auto-open
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: 'notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      // Initially closed
      await new Promise(r => setTimeout(r, 20));
      expect(result.current.isOpen).toBe(false);

      // Manually open
      result.current.openWhatsNew();

      await waitFor(() => expect(result.current.isOpen).toBe(true));
      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
    });
  });

  describe('closeWhatsNew', () => {
    it('closes the modal', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: 'notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));

      result.current.closeWhatsNew();

      await waitFor(() => expect(result.current.isOpen).toBe(false));
    });
  });
});
