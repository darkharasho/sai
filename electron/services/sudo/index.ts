// App-wide sudo service wiring. The only sudo file that touches electron.
// claude.ts's spawnEnv() imports from here, so this module must not import
// claude.ts — main.ts injects the chat-event emitter at init instead.

import { app } from 'electron';
import * as path from 'node:path';
import { createFileAskpass, realSudoRunner, SudoSession } from './sudoSession';
import { SudoBroker } from './sudoBroker';

export { commandRequiresSudo } from './sudoSession';
export { buildSudoPreToolUseHook, SUDO_DENY_REASON } from './sudoHook';
export type { SudoPromptArgs } from './sudoBroker';

let askpass: ReturnType<typeof createFileAskpass> | null = null;
let session: SudoSession | null = null;
let broker: SudoBroker | null = null;

/**
 * Initialize once after app-ready. `emit` broadcasts payloads on the
 * `claude:message` stream (pass emitChatMessage). No-op on Windows and on
 * repeat calls; on askpass-setup failure the service stays disabled (sudo
 * commands then fail fast on their own — never crash the app for this).
 */
export function initSudoService(emit: (payload: Record<string, unknown>) => void): void {
  if (process.platform === 'win32' || session) return;
  const dir = path.join(app.getPath('userData'), 'sudo');
  const files = createFileAskpass(dir, console);
  try {
    files.init(); // writes helper script, deletes any stale pw file from a crash
  } catch (err) {
    console.warn('[sudo] askpass init failed, sudo elevation disabled:', err);
    return;
  }
  askpass = files;
  session = new SudoSession({
    askpass: files,
    runner: realSudoRunner,
    logger: console,
    // App-global state, so projectPath/scope are placeholders: every
    // ChatPanel filters them out, but the TitleBar listens unfiltered.
    onStateChange: (unlocked) => emit({ type: 'sudo-state', unlocked, projectPath: '', scope: 'chat' }),
  });
  broker = new SudoBroker(session, emit);
}

export function getSudoBroker(): SudoBroker | null {
  return broker;
}

export function getSudoSession(): SudoSession | null {
  return session;
}

/** Stable askpass helper path for spawnEnv, or null when disabled. */
export function getSudoAskpassHelperPath(): string | null {
  return session && askpass ? askpass.helperPath : null;
}

/** Wipe the credential (manual lock, app quit). Safe when already locked. */
export function lockSudo(): void {
  session?.clear();
}
