export type PermMode = 'auto' | 'auto-read' | 'always-ask';

const ORDER: Record<PermMode, number> = {
  'auto': 2,        // most permissive
  'auto-read': 1,
  'always-ask': 0,  // least permissive
};

/**
 * Returns the stricter of two permission modes. The ceiling is the cap;
 * if ceiling is null, no clamp is applied. Undefined desktop returns the ceiling.
 */
export function clamp(desktop: PermMode | undefined, ceiling: PermMode | null): PermMode | undefined {
  if (ceiling == null) return desktop;
  if (desktop == null) return ceiling;
  return ORDER[desktop] < ORDER[ceiling] ? desktop : ceiling;
}
