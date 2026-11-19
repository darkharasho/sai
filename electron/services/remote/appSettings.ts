// The app settings a paired phone may read (v2 `app.settings`): appearance and
// chat-display keys from settings.json plus the remote permission ceiling.
// Nothing else in settings.json (tokens, paths, integrations) crosses over.
import type { PermMode } from './clamp';

export const REMOTE_APP_SETTING_KEYS = [
  'theme', 'accent', 'highlightTheme', 'messageStampMode', 'toolCallsExpanded',
  'tagMessagesWithTask', 'saiAnimationEnabled', 'autoCompactThreshold',
] as const;

export type RemoteAppSettings = Partial<Record<(typeof REMOTE_APP_SETTING_KEYS)[number], unknown>> & {
  remoteCeiling: PermMode | null;
};

/** The listed keys present in `settings` (unset keys are omitted) plus the remote ceiling. */
export function pickRemoteAppSettings(settings: Record<string, unknown> | null | undefined, remoteCeiling: PermMode | null): RemoteAppSettings {
  const out: RemoteAppSettings = { remoteCeiling };
  const src = settings && typeof settings === 'object' ? settings : {};
  for (const k of REMOTE_APP_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

export type AppSettingsListener = (settings: RemoteAppSettings) => void;

/**
 * Holds the last snapshot. `notify()` (called after any settings write or
 * ceiling change) re-reads it and emits only if a listed key or the ceiling
 * actually changed.
 */
export class AppSettingsFeed {
  private last: string | null = null;
  private readonly listeners = new Set<AppSettingsListener>();

  constructor(private readonly read: () => RemoteAppSettings) {}

  get(): RemoteAppSettings {
    const s = this.read();
    this.last = JSON.stringify(s);
    return s;
  }

  notify(): void {
    if (this.listeners.size === 0) { this.last = null; return; }
    let s: RemoteAppSettings;
    try { s = this.read(); } catch { return; }
    const json = JSON.stringify(s);
    if (json === this.last) return;
    this.last = json;
    for (const cb of this.listeners) {
      try { cb(s); } catch { /* a listener's socket failure must not stop the others */ }
    }
  }

  onChange(cb: AppSettingsListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}
