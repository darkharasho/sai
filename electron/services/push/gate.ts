// Whether pushes may go out at all: Mobile Remote must be on (the bridge the
// phone pairs and registers through) and the pushNotifications setting must
// not be off (missing means on).

export function pushGate(readSettings: () => unknown, remoteEnabled: () => boolean): () => boolean {
  return () => {
    if (!remoteEnabled()) return false;
    let settings: unknown;
    try { settings = readSettings(); } catch { return true; }
    return !(settings && typeof settings === 'object' && (settings as { pushNotifications?: unknown }).pushNotifications === false);
  };
}
