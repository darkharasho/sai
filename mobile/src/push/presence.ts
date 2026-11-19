// phone.presence {chatId, foreground}: which chat the phone shows and whether
// the app is in front, so the desktop skips pushes for a chat being read.
// The desktop keeps it per socket and forgets it with the socket, so it is
// re-sent on every auth_ok; while offline nothing is queued.
import type { V2Client } from '../v2/client';

// Mirrors chat-v2.ts chatIdOf: anything else is sent as null (the desktop drops it otherwise).
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const chatIdOf = (v: string | null): string | null =>
  (v !== null && CHAT_ID.test(v) && !(v in Object.prototype) ? v : null);

export interface Presence {
  /** The chat on screen (null: none, e.g. the machine list). */
  setChat(chatId: string | null): void;
  setForeground(foreground: boolean): void;
  /** Sends to `client` now and after each of its auth_oks; returns the detach. */
  attach(client: V2Client | null): () => void;
  readonly state: { chatId: string | null; foreground: boolean };
}

export function createPresence(initial: { chatId?: string | null; foreground?: boolean } = {}): Presence {
  let chatId = chatIdOf(initial.chatId ?? null);
  let foreground = initial.foreground ?? true;
  let client: V2Client | null = null;
  let offAuth: (() => void) | null = null;

  const send = () => {
    if (client?.connected) client.send({ type: 'phone.presence', chatId, foreground });
  };

  return {
    setChat(next) {
      const c = chatIdOf(next);
      if (c === chatId) return;
      chatId = c;
      send();
    },
    setForeground(next) {
      if (next === foreground) return;
      foreground = next;
      send();
    },
    attach(next) {
      offAuth?.();
      offAuth = null;
      client = next;
      if (next) {
        const off = next.onAuth(send);
        offAuth = off;
        send();
      }
      return () => {
        if (client !== next) return;
        offAuth?.();
        offAuth = null;
        client = null;
      };
    },
    get state() { return { chatId, foreground }; },
  };
}

let shared: Presence | null = null;
/** The app-wide presence. */
export function getPresence(): Presence {
  return (shared ??= createPresence());
}
