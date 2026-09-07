/**
 * V8 heap occupancy, for stamping onto crash diagnostics.
 *
 * The renderer keeps every message of every transcript mounted (chat
 * virtualization was removed), so heap pressure is a standing suspect whenever
 * the tree dies. Recording occupancy at the moment of the failure is what makes
 * that testable instead of a hunch — an error arriving with usedJSHeapSize
 * pinned against jsHeapSizeLimit says something very different from the same
 * error at 200MB.
 *
 * `performance.memory` is Chromium-only and absent under test DOMs, hence the
 * empty-object fallback rather than zeroes, which would read as real readings.
 */
export function heapStats(): Record<string, number> {
  const m = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  if (!m) return {};
  return {
    heapUsedMb: Math.round(m.usedJSHeapSize / 1048576),
    heapTotalMb: Math.round(m.totalJSHeapSize / 1048576),
    heapLimitMb: Math.round(m.jsHeapSizeLimit / 1048576),
  };
}
