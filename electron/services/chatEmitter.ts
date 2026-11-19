// Late-bound handle on claude.ts's emitChatMessage, the single choke point
// for `claude:message` events (durable chat log + v1 IPC + remote bus).
// Leaf modules (workspace.ts, gemini.ts, acpProvider.ts) send through this so
// they don't import claude.ts, which itself imports them.
import type { BrowserWindow } from 'electron';

export type ChatEmit = (msg: Record<string, unknown>, target?: BrowserWindow) => void;

let emitter: ChatEmit | null = null;

/** claude.ts registers emitChatMessage here when it loads. */
export function setChatEmitter(fn: ChatEmit | null): void {
  emitter = fn;
}

/**
 * Emit a chat event to `win` through emitChatMessage. Until claude.ts has
 * registered (only in isolated unit tests), fall back to the plain v1 send.
 */
export function emitChat(win: BrowserWindow, msg: Record<string, unknown>): void {
  if (emitter) {
    emitter(msg, win);
    return;
  }
  try {
    if (!win.isDestroyed()) win.webContents.send('claude:message', msg);
  } catch {
    // Window already destroyed.
  }
}
