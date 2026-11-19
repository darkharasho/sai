// The process-wide chat log trio, set by main once initChatLog has built it.
// The remote bridge reads it here instead of importing main.ts (import cycle).
import type { ChatCommands } from './commands';
import type { ChatLogService } from './service';
import type { ChatLogStore } from './store';

export interface ChatSync {
  store: ChatLogStore;
  service: ChatLogService;
  commands: ChatCommands;
}

let current: ChatSync | null = null;

export function setChatSync(sync: ChatSync | null): void {
  current = sync;
}

/** null until main has initialised the chat log (or when it failed to). */
export function getChatSync(): ChatSync | null {
  return current;
}
