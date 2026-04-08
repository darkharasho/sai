import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';

// We mock the module so we control what 'version' resolves to.
// The real package.json version is whatever it is — tests pin it to '1.2.3'.
vi.mock('../../../package.json', () => ({ version: '1.2.3' }));

import { useWhatsNew, compareSemver } from '../../../src/hooks/useWhatsNew';

function makeSettingsGetMock(lastSeenVersion: string | null = null) {
  return vi.fn((_key: string, defaultValue?: unknown) => {
    if (_key === 'lastSeenVersion') return Promise.resolve(lastSeenVersion);
    return Promise.resolve(defaultValue ?? undefined);
  });
}

/** Helper: create a GitHub releases list API response */
function makeReleasesResponse(releases: Array<{ tag: string; body: string; draft?: boolean; prerelease?: boolean }>) {
  return {
    ok: true,
    json: async () => releases.map(r => ({
      tag_name: r.tag,
      body: r.body,
      draft: r.draft ?? false,
      prerelease: r.prerelease ?? false,
    })),
  };
}

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns positive when a > b', () => {
    expect(compareSemver('1.3.0', '1.2.9')).toBeGreaterThan(0);
  });

  it('returns negative when a < b', () => {
    expect(compareSemver('1.2.2', '1.2.3')).toBeLessThan(0);
  });

  it('handles v prefix', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
  });
});

describe('useWhatsNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    const mock = createMockSai();
    installMockSai(mock);
  });

  describe('auto-open on version mismatch', () => {
    it('opens the modal when lastSeenVersion is null (first install)', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([{ tag: 'v1.2.3', body: '## Release notes' }])
      );
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));
    });

    it('opens the modal when lastSeenVersion differs from current version', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.2');
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([
          { tag: 'v1.2.3', body: '## Notes for 1.2.3' },
          { tag: 'v1.2.2', body: '## Notes for 1.2.2' },
        ])
      );
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
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([{ tag: 'v1.2.3', body: 'notes' }])
      );
      installMockSai(mock);

      renderHook(() => useWhatsNew());

      await waitFor(() =>
        expect(mock.settingsSet).toHaveBeenCalledWith('lastSeenVersion', '1.2.3')
      );
    });
  });

  describe('fetch logic', () => {
    it('returns only releases between lastSeen and current version', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.0');
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([
          { tag: 'v1.3.0', body: 'Future release' },
          { tag: 'v1.2.3', body: 'Current release' },
          { tag: 'v1.2.2', body: 'Missed release' },
          { tag: 'v1.2.1', body: 'Another missed release' },
          { tag: 'v1.2.0', body: 'Already seen release' },
          { tag: 'v1.1.0', body: 'Old release' },
        ])
      );
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
      expect(result.current.releases).toHaveLength(3);
      expect(result.current.releases.map(r => r.version)).toEqual(['1.2.3', '1.2.2', '1.2.1']);
    });

    it('excludes draft and prerelease entries', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.0');
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([
          { tag: 'v1.2.3', body: 'Stable', draft: false },
          { tag: 'v1.2.2', body: 'Draft release', draft: true },
          { tag: 'v1.2.1', body: 'Pre-release', prerelease: true },
        ])
      );
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
      expect(result.current.releases).toHaveLength(1);
      expect(result.current.releases[0].version).toBe('1.2.3');
    });

    it('excludes releases with empty body', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.0');
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([
          { tag: 'v1.2.3', body: 'Has notes' },
          { tag: 'v1.2.2', body: '' },
          { tag: 'v1.2.1', body: '  ' },
        ])
      );
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
      expect(result.current.releases).toHaveLength(1);
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
      expect(result.current.releases).toEqual([]);
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

    it('includes all releases when lastSeenVersion is null (first install)', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([
          { tag: 'v1.2.3', body: 'Current' },
          { tag: 'v1.2.2', body: 'Previous' },
          { tag: 'v1.2.1', body: 'Older' },
        ])
      );
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
      // All releases up to current version should be included
      expect(result.current.releases).toHaveLength(3);
    });
  });

  describe('openWhatsNew', () => {
    it('opens the modal and triggers fetch', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.3'); // already seen — no auto-open
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([{ tag: 'v1.2.3', body: 'notes' }])
      );
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

    it('still shows current version notes on manual re-open (lastSeen = current)', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.3'); // already seen
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([
          { tag: 'v1.2.3', body: 'Current version notes' },
          { tag: 'v1.2.2', body: 'Old notes' },
        ])
      );
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await new Promise(r => setTimeout(r, 20));
      result.current.openWhatsNew();

      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
      // Should include current version notes but not older ones already seen
      expect(result.current.releases).toHaveLength(1);
      expect(result.current.releases[0].version).toBe('1.2.3');
    });
  });

  describe('closeWhatsNew', () => {
    it('closes the modal', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReleasesResponse([{ tag: 'v1.2.3', body: 'notes' }])
      );
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));

      result.current.closeWhatsNew();

      await waitFor(() => expect(result.current.isOpen).toBe(false));
    });
  });
});
