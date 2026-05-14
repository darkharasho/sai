/** Return the first path segment under syntheticRoot ("link name"), or null if absPath is not under root. */
export function owningLink(absPath: string, syntheticRoot: string): string | null {
  if (!absPath.startsWith(syntheticRoot)) return null;
  const rel = absPath.slice(syntheticRoot.length).replace(/^[\\/]+/, '');
  if (!rel) return null;
  return rel.split(/[\\/]/)[0] || null;
}

export function isCrossProjectMove(src: string, dst: string, root: string): boolean {
  const a = owningLink(src, root);
  const b = owningLink(dst, root);
  return !!(a && b && a !== b);
}
