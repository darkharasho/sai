/// <reference types="vite/client" />

interface SaiRemoteApi {
  setEnabled: (enabled: boolean) => Promise<void>;
  status: () => Promise<{ running: boolean; url: string | null; reason: string | null; pairedCount: number; enabled: boolean }>;
  mintPairCode: () => Promise<{ code: string; url: string; expiresAt: number }>;
  listDevices: () => Promise<Array<{ id: string; label: string; pairedAt: number; lastSeenAt: number | null; revokedAt: number | null }>>;
  revoke: (deviceId: string) => Promise<void>;
  setCeiling: (ceiling: 'auto' | 'auto-read' | 'always-ask' | null) => Promise<void>;
  getCeiling: () => Promise<'auto' | 'auto-read' | 'always-ask' | null>;
}

declare global {
  interface Window {
    sai: Window['sai'] & {
      remote: SaiRemoteApi;
    };
  }
}
