import type { SwarmTask } from '../types';

/**
 * Resolves a task reference (either an id, an exact id prefix, or an exact
 * title prefix) to a unique task. Returns null if not found or ambiguous.
 */
export function resolveTaskRef(tasks: readonly SwarmTask[], ref: string): SwarmTask | null {
  if (!ref) return null;
  const exact = tasks.find(t => t.id === ref);
  if (exact) return exact;
  const idMatches = tasks.filter(t => t.id.startsWith(ref));
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) return null;
  const titleMatches = tasks.filter(t => t.title.startsWith(ref));
  if (titleMatches.length === 1) return titleMatches[0];
  return null;
}
