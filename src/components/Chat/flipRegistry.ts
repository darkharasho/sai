// Pending source rects for user-message FLIP animations, keyed by message id.
// Module-level so ChatPanel (writer) and ChatMessage (reader) don't have to
// thread a ref through props. Mirrors the SEEN_MESSAGES / TYPEWRITER_PROGRESS
// pattern already used in ChatMessage.tsx.
const FLIP_RECTS = new Map<string, DOMRect>();

export function setFlipRect(messageId: string, rect: DOMRect): void {
  FLIP_RECTS.set(messageId, rect);
}

export function consumeFlipRect(messageId: string): DOMRect | undefined {
  const rect = FLIP_RECTS.get(messageId);
  if (rect) FLIP_RECTS.delete(messageId);
  return rect;
}

// Non-destructive check, used at render time to decide whether a message
// "owns" a pending FLIP. Consume happens later in a layout effect — a
// useState initializer can't consume safely because React 18 StrictMode
// double-invokes initializers in dev, which would lose the rect on the
// throwaway first render.
export function hasFlipRect(messageId: string): boolean {
  return FLIP_RECTS.has(messageId);
}

// Test-only. Not exported from any index — keeps prod code from depending on it.
export function _resetFlipRegistry(): void {
  FLIP_RECTS.clear();
}
