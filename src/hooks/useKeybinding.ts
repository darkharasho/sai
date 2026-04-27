import { useEffect } from 'react';
import {
  KEYBINDINGS,
  type KeybindingId,
  type KeyCombo,
  eventToCombo,
  mergeWithDefaults,
} from '../utils/keybindings';

// Module-level state — one shared dispatcher serves every useKeybinding caller.
const handlers = new Map<KeybindingId, (e: KeyboardEvent) => void>();
let activeBindings: Record<KeybindingId, KeyCombo> = mergeWithDefaults({});
let listenerAttached = false;

async function loadOverrides(): Promise<void> {
  try {
    const stored = await (window as any).sai?.settingsGet?.('keybindings', {});
    activeBindings = mergeWithDefaults(stored ?? {});
  } catch {
    activeBindings = mergeWithDefaults({});
  }
}

function dispatch(e: KeyboardEvent): void {
  const combo = eventToCombo(e);
  if (!combo) return;
  // Iterate KEYBINDINGS in declaration order so duplicates resolve deterministically.
  for (const def of KEYBINDINGS) {
    if (activeBindings[def.id] === combo) {
      const handler = handlers.get(def.id);
      if (handler) handler(e);
      return;
    }
  }
}

function ensureListener(): void {
  if (listenerAttached) return;
  window.addEventListener('keydown', dispatch);
  window.addEventListener('sai:keybindings-changed', () => { void loadOverrides(); });
  listenerAttached = true;
}

/**
 * Subscribe a handler to the user-configured combo for `id`.
 * Re-binds automatically when the user changes keybindings in Settings
 * (callers anywhere can dispatch the `sai:keybindings-changed` event).
 */
export function useKeybinding(id: KeybindingId, handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    ensureListener();
    handlers.set(id, handler);
    void loadOverrides();
    return () => {
      if (handlers.get(id) === handler) handlers.delete(id);
    };
  }, [id, handler]);
}
