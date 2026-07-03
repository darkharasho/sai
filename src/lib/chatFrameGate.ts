// Renderer-wide gate closing the focus-swap listener gap.
//
// When a session is selected, App marks it focused BEFORE the ChatPanel for it
// mounts and subscribes its claudeOnMessage listener. Frames arriving in that
// gap used to be lost by both paths: App skipped buffering (focused) and no
// panel was listening. Under the SDK backend, which streams text as delta
// frames, that truncated replies mid-word.
//
// The protocol:
//  - App's claude:message listener buffers assistant content for any non-'chat'
//    scope that has NO registered panel listener (see `hasChatListener`).
//  - ChatPanel, in its subscription effect, synchronously does:
//    registerChatListener(scope) → subscribe IPC → takeBufferedMessages(scope)
//    → reconcile into state. JS is single-threaded, so no frame can land
//    between those statements — the gap is closed exactly.
//
// The message buffer itself lives here (module singleton, same renderer as
// App and ChatPanel) so panels can drain it without prop-drilling.

import type { ChatMessage } from '../types';

const listenerCounts = new Map<string, number>();

/** Per-scope buffer of assistant messages accumulated while no panel listened.
 *  App owns writes (convert + append); panels drain via takeBufferedMessages. */
export const scopeMessageBuffer = new Map<string, ChatMessage[]>();

export function registerChatListener(scope: string): void {
  listenerCounts.set(scope, (listenerCounts.get(scope) ?? 0) + 1);
}

export function unregisterChatListener(scope: string): void {
  const n = (listenerCounts.get(scope) ?? 0) - 1;
  if (n <= 0) listenerCounts.delete(scope);
  else listenerCounts.set(scope, n);
}

export function hasChatListener(scope: string): boolean {
  return (listenerCounts.get(scope) ?? 0) > 0;
}

/** Remove and return the buffered messages for a scope (panel takes ownership). */
export function takeBufferedMessages(scope: string): ChatMessage[] {
  const buf = scopeMessageBuffer.get(scope);
  if (!buf || buf.length === 0) return [];
  scopeMessageBuffer.delete(scope);
  return buf;
}

/**
 * Merge drained buffer messages into a panel's message list.
 *
 * The select-time merge may have already seeded some buffered messages into
 * the panel's initial state (same ids), possibly with SHORTER content (the
 * buffer kept growing after the read). Reconcile by id: an existing id keeps
 * the longer content; unknown ids append. Idempotent.
 */
export function reconcileDrainedMessages(
  prev: ChatMessage[],
  drained: ChatMessage[],
): ChatMessage[] {
  if (drained.length === 0) return prev;
  let next = prev;
  for (const d of drained) {
    const { finalCopy: _finalCopy, ...msg } = d as ChatMessage & { finalCopy?: boolean };
    const idx = next.findIndex(m => m.id === msg.id);
    if (idx >= 0) {
      const cur = next[idx];
      const curLen = typeof cur.content === 'string' ? cur.content.length : 0;
      const newLen = typeof msg.content === 'string' ? msg.content.length : 0;
      if (newLen > curLen) {
        const copy = [...next];
        copy[idx] = { ...cur, content: msg.content };
        next = copy;
      }
    } else {
      next = [...next, msg as ChatMessage];
    }
  }
  return next;
}

/** Test seam. */
export function _resetChatFrameGate(): void {
  listenerCounts.clear();
  scopeMessageBuffer.clear();
}
