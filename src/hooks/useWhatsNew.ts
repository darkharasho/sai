import { useState, useEffect, useCallback } from 'react';
import { version as currentVersion } from '../../package.json';

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseWhatsNewReturn {
  isOpen: boolean;
  version: string;
  releaseNotes: string | null;
  fetchStatus: FetchStatus;
  openWhatsNew: () => void;
  closeWhatsNew: () => void;
}

const RELEASES_URL = `https://api.github.com/repos/darkharasho/sai/releases/tags/v${currentVersion}`;

export function useWhatsNew(): UseWhatsNewReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle');

  const doFetch = useCallback(() => {
    setFetchStatus('loading');
    setReleaseNotes(null);
    fetch(RELEASES_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ body?: string }>;
      })
      .then(data => {
        setReleaseNotes(data.body ?? '');
        setFetchStatus('success');
      })
      .catch(() => setFetchStatus('error'));
  }, []);

  const openWhatsNew = useCallback(() => {
    window.sai.settingsSet('lastSeenVersion', currentVersion);
    setIsOpen(true);
    doFetch();
  }, [doFetch]);

  const closeWhatsNew = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    window.sai.settingsGet('lastSeenVersion', null).then((lastSeen: string | null) => {
      if (lastSeen !== currentVersion) {
        openWhatsNew();
      }
    });
    // Intentionally run once on mount only; openWhatsNew is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOpen, version: currentVersion, releaseNotes, fetchStatus, openWhatsNew, closeWhatsNew };
}
