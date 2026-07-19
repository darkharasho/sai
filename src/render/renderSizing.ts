// Conservative CSS-color charset: hex, rgb()/hsl(), named colors, color-mix().
// Excludes quotes, semicolons, angle brackets, slashes — anything that could
// break out of an inline style attribute it gets interpolated into.
const CSS_COLOR_RE = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/;

/** Validate a user-supplied CSS color before interpolating it into an inline
 *  style attribute. Returns the trimmed value, or null when rejected. */
export function sanitizeCssColor(value: string): string | null {
  const v = value.trim();
  if (!v || !CSS_COLOR_RE.test(v) || /url\s*\(/i.test(v)) return null;
  return v;
}

/** Grow-only width clamp for render regions: never below the requested
 *  minimum, never below the current width, grows to a valid larger report. */
export function nextRenderWidth(current: number, reported: number, min: number): number {
  const floor = Math.max(current, min);
  if (!Number.isFinite(reported) || reported <= 0) return floor;
  return Math.max(floor, Math.ceil(reported));
}

/** Resolve the app's surface color to a concrete value for painting into an
 *  iframe body (the iframe backdrop is opaque white; CSS vars don't cross the
 *  boundary). --sai-surface is defined at :root. */
export function resolveThemedSurface(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sai-surface').trim();
    return (v && sanitizeCssColor(v)) || '#1a1a1a';
  } catch {
    return '#1a1a1a';
  }
}

export const MAX_RENDER_HEIGHT = 4000;

export interface HeightSizerState {
  height: number;
  min: number;
  lastIncrement: number;
  repeatCount: number;
  frozen: boolean;
}

export function createHeightSizer(min: number): HeightSizerState {
  const floor = Math.min(Math.max(Math.ceil(min), 40), MAX_RENDER_HEIGHT);
  return { height: floor, min: floor, lastIncrement: 0, repeatCount: 0, frozen: false };
}

/** Grow-only height for render regions, with a divergence guard: `100vh` plus
 *  fixed-height extras makes each resize raise scrollHeight by the same delta
 *  forever — three consecutive equal positive increments freeze the sizer at
 *  the height already granted. Never shrinks. */
export function nextRenderHeight(state: HeightSizerState, reported: number): HeightSizerState {
  if (state.frozen || !Number.isFinite(reported) || reported <= 0) return state;
  const target = Math.min(Math.max(state.height, state.min, Math.ceil(reported)), MAX_RENDER_HEIGHT);
  const increment = target - state.height;
  if (increment <= 0) return state;
  const repeatCount = increment === state.lastIncrement ? state.repeatCount + 1 : 1;
  if (repeatCount >= 3) {
    return { ...state, frozen: true };
  }
  return { ...state, height: target, lastIncrement: increment, repeatCount };
}
