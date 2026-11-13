/** Best-effort removal of the legacy swarm IndexedDB. Always resolves. */
export function dropLegacySwarmData(): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase('sai-swarm');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
