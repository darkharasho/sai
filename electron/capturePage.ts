export interface Rect { x: number; y: number; width: number; height: number; }

export function clampRect(rect: Rect, page: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const maxW = Math.max(1, page.width - x);
  const maxH = Math.max(1, page.height - y);
  const width = Math.min(maxW, Math.max(1, Math.round(rect.width)));
  const height = Math.min(maxH, Math.max(1, Math.round(rect.height)));
  return { x, y, width, height };
}
