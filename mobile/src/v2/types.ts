// Shared types for the phone's protocol-v2 client and its window.sai shim.
// Frame shapes mirror electron/services/remote/chat-v2.ts (the server).
import type { ChatLogEntry, ChatMeta, ChatState } from '../../../src/lib/chat/types';

/**
 * The phone's view of one desktop connection:
 * - connecting: socket opening or auth in flight
 * - open: authenticated and every chat subscription is live
 * - catching_up: authenticated, a chat.subscribe still awaits its chat.entries
 * - offline: no socket (a reconnect is scheduled unless close() was called)
 * - unpaired: the desktop refused the token (4001) or revoked it (1008); no reconnects
 */
export type ConnState = 'connecting' | 'open' | 'catching_up' | 'offline' | 'unpaired';

/** Minimal browser-style WebSocket surface the client uses (browser WebSocket, `ws`, or a native bridge). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** A constructor compatible with `new WebSocket(url)`. */
export type SocketCtor = new (url: string) => SocketLike;

export interface V2ClientOpts {
  /** ws://host:port/ws */
  url: string;
  /** The paired device token. */
  token: string;
  /** Defaults to globalThis.WebSocket. Injectable so a native socket can replace it (mixed-content fallback). */
  WebSocketImpl?: SocketCtor | typeof WebSocket;
  /** Clock for heartbeat liveness (default Date.now). */
  now?: () => number;
  /** Jitter source for the reconnect backoff (default Math.random). */
  random?: () => number;
}

/** Native capabilities the shim needs (Capacitor plugins in the app, fakes in tests). */
export interface NativeApi {
  /** Opens a URL outside the app (Capacitor Browser). */
  openUrl(url: string): Promise<void> | void;
  /** Copies text (Capacitor Clipboard). */
  copyText(text: string): Promise<void> | void;
  /** Shows a short informational toast. */
  toast(message: string): void;
}

/** Wire frames the shim consumes. */
export interface ChatSnapshotFrame { type: 'chat.snapshot'; chatId: string; seq: number; state: ChatState; olderCount?: number }
export interface ChatEntriesFrame { type: 'chat.entries'; chatId: string; entries: ChatLogEntry[] }
export interface ChatEntryFrame { type: 'chat.entry'; chatId: string; entry: ChatLogEntry }
export interface ChatErrorFrame { type: 'chat.error'; reqId?: unknown; chatId?: string; code: string; message: string }
export interface ChatsListFrame { type: 'chats.list.result' | 'chats.changed'; reqId?: unknown; projectPath?: string; chats: ChatMeta[] }

/** Error a request() rejects with: a chat.error reply, a timeout or a lost connection. */
export class V2Error extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'V2Error';
  }
}

/** The chat.error message the server sends for every chat frame while main's chat log isn't built yet. */
export const CHAT_LOG_UNAVAILABLE_MESSAGE = 'chat log is not available';
