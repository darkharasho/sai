// Per-chat composer settings (model, permission, effort, approval and
// conversation mode) live in main's chat log as state.settings. The pickers
// show the chat's own values; the workspace defaults (App's preferences) fill
// any gap and seed a chat that has none yet.
import type { ChatSettings } from './types';

type Key = keyof ChatSettings;

/** What the composer shows: the chat's own values for the current provider, else the workspace defaults. */
export function effectiveChatSettings(chat: ChatSettings | null | undefined, defaults: ChatSettings): ChatSettings {
  if (!chat || chat.provider !== defaults.provider) return defaults;
  const out: ChatSettings = { ...defaults };
  for (const k of Object.keys(defaults) as Key[]) {
    const v = chat[k];
    if (v !== undefined) (out as unknown as Record<Key, unknown>)[k] = v;
  }
  return out;
}

/**
 * The settings a chat still needs from the workspace defaults before it can
 * dispatch: everything when it is new or on another provider, else only the
 * keys it has never logged. Null when nothing is missing. Always carries the
 * provider, so a seed can create the chat in the log.
 */
export function settingsSeed(chat: ChatSettings | null | undefined, defaults: ChatSettings): Partial<ChatSettings> | null {
  if (!chat || chat.provider !== defaults.provider) return { ...defaults };
  const missing: Partial<ChatSettings> = {};
  for (const k of Object.keys(defaults) as Key[]) {
    if (k !== 'provider' && chat[k] === undefined && defaults[k] !== undefined) {
      (missing as Record<Key, unknown>)[k] = defaults[k];
    }
  }
  return Object.keys(missing).length > 0 ? { provider: defaults.provider, ...missing } : null;
}
