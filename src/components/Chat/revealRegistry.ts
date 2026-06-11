// Once-per-renderer-session registry of message ids whose word-reveal
// animation has already played. Module-level (not per-component) so remounts
// from workspace/chat swaps never replay the animation — only the first
// appearance of a message in an active list animates.

const revealed = new Set<string>();

export function hasRevealed(id: string): boolean {
  return revealed.has(id);
}

export function markRevealed(id: string): void {
  revealed.add(id);
}

export function _resetRevealRegistry(): void {
  revealed.clear();
}
