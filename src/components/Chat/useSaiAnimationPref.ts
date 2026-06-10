import { useState, useEffect } from 'react';

// Live preference cached at module scope; SettingsModal broadcasts updates via the
// `sai-pref-sai-animation` window event.
let cachedPref = true;
if (typeof window !== 'undefined' && (window as any).sai?.settingsGet) {
  (window as any).sai.settingsGet('saiAnimationEnabled', true)
    .then((v: boolean) => { cachedPref = v !== false; });
}

export function useSaiAnimationPref(): boolean {
  const [enabled, setEnabled] = useState(cachedPref);
  useEffect(() => {
    const onPref = (e: Event) => setEnabled(!!(e as CustomEvent).detail);
    window.addEventListener('sai-pref-sai-animation', onPref);
    return () => window.removeEventListener('sai-pref-sai-animation', onPref);
  }, []);
  return enabled;
}
