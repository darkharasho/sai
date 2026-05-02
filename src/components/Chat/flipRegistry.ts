// Pending source rect for the most recent user-message FLIP animation.
// Module-level so ChatPanel (writer) and ChatMessage (reader) don't have to
// thread a ref through props. Mirrors the SEEN_MESSAGES / TYPEWRITER_PROGRESS
// pattern already used in ChatMessage.tsx.
//
// Reads are non-destructive — React 18 StrictMode mounts components twice in
// dev, and a destructive consume would silently disable the animation in dev
// (first mount consumes, second mount finds nothing). The Map is bounded by
// clearing on every `setFlipRect`, so only the latest send's rect is retained.
const FLIP_RECTS = new Map<string, DOMRect>();

export function setFlipRect(messageId: string, rect: DOMRect): void {
  FLIP_RECTS.clear();
  FLIP_RECTS.set(messageId, rect);
}

export function readFlipRect(messageId: string): DOMRect | undefined {
  return FLIP_RECTS.get(messageId);
}

export function hasFlipRect(messageId: string): boolean {
  return FLIP_RECTS.has(messageId);
}

// Test-only. Not exported from any index — keeps prod code from depending on it.
export function _resetFlipRegistry(): void {
  FLIP_RECTS.clear();
}
